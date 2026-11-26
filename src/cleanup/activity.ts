/** Activity Log bulk tools. Facebook owns the row checkboxes and the Remove flow. */
import { blockedDialog, labelOf, MAIN_SELECTOR, normalize, visible, visibleDialogs, visibleMenus, waitFor } from './dom';
import type { ActOutcome } from './runner';
import type { PageAdapter } from './toolbar';

type Category = 'reactions' | 'comments';

const HEADINGS = {
  reactions: ['lượt thích và cảm xúc', 'likes and reactions'],
  comments: ['bình luận', 'comments'],
} satisfies Record<Category, readonly string[]>;
const REMOVE = ['gỡ', 'remove'];
const CONFIRM = {
  reactions: REMOVE,
  comments: [...REMOVE, 'xóa', 'xoá', 'delete'],
} satisfies Record<Category, readonly string[]>;
const ROW_LABELS = ['chọn bài viết từ ', 'chọn bình luận từ ', 'select post from ', 'select comment from '];
const ROW_MENU_LABELS = ['lựa chọn khác cho ', 'more options for '];
const ALL = ['tất cả', 'all'];
const HEADING = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
const INPUT_CHECK = 'input[type="checkbox"]';
const CHECK = `${INPUT_CHECK}, [role="checkbox"]`;
const BUTTON = 'button, [role="button"]';
const DIALOG = '[role="dialog"], [role="alertdialog"], dialog[open]';
const WAIT_MS = 4_000;
const VERIFY_MS = 8_000;

const hasLabel = (table: readonly string[], value: string): boolean => table.includes(normalize(value));
const hasPrefix = (table: readonly string[], value: string): boolean => table.some((prefix) => value.startsWith(prefix));

export function activityCategory(headings: readonly string[]): Category | null {
  const matches = (['reactions', 'comments'] as const).filter((category) =>
    headings.some((heading) => hasLabel(HEADINGS[category], heading)));
  return matches.length === 1 ? matches[0]! : null;
}

export const isActivityPath = (path: string): boolean => /^\/(?:[^/]+\/)?allactivity\/?$/.test(path);

export const isRemoveLabel = (value: string): boolean => hasLabel(REMOVE, value);

export const isConfirmLabel = (category: Category, value: string): boolean => hasLabel(CONFIRM[category], value);

export function readActivityCategory(main: HTMLElement): Category | null {
  return activityCategory([...main.querySelectorAll<HTMLElement>(HEADING)]
    .map((heading) => heading.textContent ?? ''));
}

interface ActivityRow {
  key: string;
  title: string;
  box: HTMLElement;
  checkbox: HTMLElement;
  options: HTMLElement;
  label: string;
}

function checkState(el: HTMLElement): boolean | 'mixed' | null {
  const aria = el.getAttribute('aria-checked');
  if (el.matches(INPUT_CHECK)) {
    const input = el as HTMLInputElement;
    const state = input.indeterminate ? 'mixed' : input.checked;
    return aria === null || aria === String(state) ? state : null;
  }
  if (aria === 'mixed') return aria;
  return aria === 'true' ? true : aria === 'false' ? false : null;
}

const enabled = (el: HTMLElement): boolean => !el.matches(':disabled, [aria-disabled="true"]');
const rowMenu = (el: HTMLElement): boolean => hasPrefix(ROW_MENU_LABELS, normalize(el.getAttribute('aria-label') ?? ''));

function rowKey(label: string, row: HTMLElement): string {
  return JSON.stringify([label, row.querySelector<HTMLAnchorElement>('a[href]')?.href ?? '']);
}

function readRow(checkbox: HTMLElement, main: HTMLElement): ActivityRow | null {
  const title = checkbox.getAttribute('aria-label')?.trim() ?? '';
  const label = normalize(title);
  if (!hasPrefix(ROW_LABELS, label)) return null;
  for (let box = checkbox.parentElement; box && box !== main; box = box.parentElement) {
    if (box.querySelectorAll(CHECK).length !== 1) return null;
    const menus = [...box.querySelectorAll<HTMLElement>(BUTTON)].filter(rowMenu);
    if (menus.length > 1) return null;
    if (menus.length === 1) return { key: rowKey(label, box), label, title, box, checkbox, options: menus[0]! };
  }
  return null;
}

function isHeader(checkbox: HTMLElement, main: HTMLElement): boolean {
  if (normalize(checkbox.getAttribute('aria-label') ?? '')) return false;
  for (let container = checkbox.parentElement; container && container !== main; container = container.parentElement) {
    if (container.querySelectorAll(CHECK).length !== 1) return false;
    const buttons = [...container.querySelectorAll<HTMLElement>(BUTTON)];
    if (buttons.some(rowMenu)) return false;
    const text = normalize(container.textContent ?? '');
    if (hasLabel(ALL, text) ||
      [...container.querySelectorAll('span, label')].some((label) => hasLabel(ALL, label.textContent ?? ''))) return true;
    // Facebook may group the plain-text All label and Remove in a single container.
    const remove = buttons.filter((button) => isRemoveLabel(labelOf(button)));
    const action = remove.length === 1 ? normalize(remove[0]!.textContent ?? '') : '';
    if (action && text.endsWith(action) && hasLabel(ALL, text.slice(0, -action.length))) return true;
  }
  return false;
}

function scanRows(main: HTMLElement) {
  const rows = new Map<string, ActivityRow>();
  const duplicates = new Set<string>();
  const headers: HTMLElement[] = [];
  let unknownSelection = false;
  for (const checkbox of main.querySelectorAll<HTMLElement>(CHECK)) {
    const row = readRow(checkbox, main);
    const state = checkState(checkbox);
    if (row) {
      if (rows.has(row.key)) duplicates.add(row.key);
      else rows.set(row.key, row);
      if (typeof state !== 'boolean') unknownSelection = true;
    } else if (isHeader(checkbox, main)) {
      headers.push(checkbox);
      if (state === null) unknownSelection = true;
    } else if (state !== false) unknownSelection = true;
  }
  return { rows, duplicates, headers, unknownSelection };
}

function readActivity(main: HTMLElement): ActivityRow[] {
  const { rows, duplicates } = scanRows(main);
  return [...rows.values()].filter((row) => !duplicates.has(row.key) && visible(row.checkbox));
}

function context(main: HTMLElement, category: Category) {
  const url = document.URL;
  return () => document.URL === url && isActivityPath(location.pathname) && main.isConnected &&
    document.querySelector(MAIN_SELECTOR) === main && readActivityCategory(main) === category;
}

function safeRows(snapshot: ReturnType<typeof scanRows>, keys: ReadonlySet<string>): boolean {
  return !snapshot.unknownSelection && !snapshot.duplicates.size && snapshot.headers.length <= 1 &&
    [...keys].every((key) => snapshot.rows.has(key));
}

function exactSelection(snapshot: ReturnType<typeof scanRows>, keys: ReadonlySet<string>): boolean {
  return safeRows(snapshot, keys) &&
    (!snapshot.headers.some((header) => checkState(header) === true) || keys.size === snapshot.rows.size) &&
    [...snapshot.rows.values()].every((row) => checkState(row.checkbox) === keys.has(row.key));
}

async function selectRows(
  main: HTMLElement, keys: ReadonlySet<string>, signal: AbortSignal, samePage: () => boolean,
): Promise<ActOutcome> {
  if (signal.aborted) return 'stopped';
  if (blockedDialog()) return 'blocked';
  if (!samePage() || visibleDialogs().length || visibleMenus().length) return 'unidentified';
  const snapshot = scanRows(main);
  if (!safeRows(snapshot, keys)) return 'unidentified';
  // Clear other rows first, so a new batch never adds to the previous selection.
  let current = snapshot;
  for (const wanted of [false, true]) {
    for (const key of snapshot.rows.keys()) {
      if (keys.has(key) !== wanted) continue;
      if (!current.rows.get(key)?.checkbox.isConnected) current = scanRows(main);
      const row = current.rows.get(key);
      if (!row || current.duplicates.has(key) || current.unknownSelection) return 'unidentified';
      const state = checkState(row.checkbox);
      if (typeof state !== 'boolean') return 'unidentified';
      if (state === wanted) continue;
      const { checkbox } = row;
      if (signal.aborted) return 'stopped';
      if (blockedDialog()) return 'blocked';
      if (visibleDialogs().length || !samePage() || !visible(checkbox) || !enabled(checkbox) ||
        row.label !== normalize(checkbox.getAttribute('aria-label') ?? '') ||
        readRow(checkbox, main)?.key !== row.key) return 'unidentified';

      checkbox.click();
      const changed = await waitFor(() => {
        if (blockedDialog()) return 'blocked';
        if (!samePage()) return 'unidentified';
        if (checkbox.isConnected && readRow(checkbox, main)?.key === key) {
          return checkState(checkbox) === wanted ? 'done' : null;
        }
        // Facebook can replace the control while updating its checked state.
        current = scanRows(main);
        if (current.duplicates.has(key) || current.unknownSelection) return 'unidentified';
        const replacement = current.rows.get(key)?.checkbox;
        return replacement && checkState(replacement) === wanted ? 'done' : null;
      }, WAIT_MS, signal);
      if (changed !== 'done') return changed ?? (signal.aborted ? 'stopped' : 'unidentified');
    }
  }
  if (signal.aborted) return 'stopped';
  return samePage() && exactSelection(scanRows(main), keys) ? 'done' : 'unidentified';
}

function namedButton(root: HTMLElement, match: (label: string) => boolean): HTMLElement | 'ambiguous' | null {
  const matches = [...root.querySelectorAll<HTMLElement>(BUTTON)].filter((button) => visible(button) && match(labelOf(button)));
  if (matches.length > 1) return 'ambiguous';
  const [button] = matches;
  return button && enabled(button) ? button : null;
}

// Only log labels made of activity UI vocabulary. Dialog copy can quote a
// person's name or comment, so other titles and labels are redacted.
const DIAGNOSTIC_WORDS = new Set(('gỡ xóa xoá bỏ lượt thích và cảm xúc bình luận mục các đã chọn bài viết ' +
  'này khỏi xác nhận hủy huỷ có không tiếp tục đóng tất cả bạn chắc chắn muốn remove delete selected ' +
  'like likes reaction reactions comment comments item items this these post posts are you sure to from ' +
  'want confirm cancel yes no continue close all ok').split(' '));

function diagnosticLabel(label: string): string {
  const value = normalize(label).replace(/\d+/g, '#');
  const words = value.match(/\p{L}+/gu) ?? [];
  return words.every((word) => DIAGNOSTIC_WORDS.has(word)) && !/[^\p{L} #?!.,:’'-]/u.test(value) ? value : '[redacted]';
}

function logDialog(dialog: HTMLElement): void {
  if (!__DEV__) return;
  const labelledBy = dialog.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? [];
  const label = dialog.getAttribute('aria-label') ||
    labelledBy.map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim() ||
    dialog.querySelector(HEADING)?.textContent || '';
  console.debug('[FB Sidekick] Activity Log confirmation', {
    title: diagnosticLabel(label),
    buttons: [...dialog.querySelectorAll<HTMLElement>(BUTTON)].filter(visible).map((button) => diagnosticLabel(labelOf(button))),
  });
}

async function removeBatch(category: Category, targets: readonly ActivityRow[], signal: AbortSignal): Promise<ActOutcome> {
  const main = document.querySelector<HTMLElement>(MAIN_SELECTOR);
  const keys = new Set(targets.map((row) => row.key));
  if (!main || !keys.size || keys.size !== targets.length) return 'unidentified';
  const samePage = context(main, category);
  const selected = await selectRows(main, keys, signal, samePage);
  if (selected !== 'done') return selected;
  if (signal.aborted) return 'stopped';
  if (blockedDialog()) return 'blocked';
  const snapshot = scanRows(main);
  const remove = namedButton(main, isRemoveLabel);
  if (!samePage() || snapshot.headers.length !== 1 || !exactSelection(snapshot, keys) ||
    !remove || remove === 'ambiguous' || visibleDialogs().length || visibleMenus().length) {
    return 'unidentified';
  }
  const selectedRows = [...keys].map((key) => snapshot.rows.get(key)!);
  remove.click();

  const opened: { dialog: HTMLElement | null } = { dialog: null };
  const matchesConfirmation = (label: string) => isConfirmLabel(category, label);
  const confirmation = await waitFor(() => {
    if (blockedDialog()) return 'blocked';
    if (!samePage()) return 'unidentified';
    const dialogs = visibleDialogs();
    if (dialogs.length > 1 || (opened.dialog && dialogs[0] !== opened.dialog)) return 'unidentified';
    if (!dialogs.length) return null;
    opened.dialog = dialogs[0]!;
    const button = namedButton(opened.dialog, matchesConfirmation);
    return button === 'ambiguous' ? 'unidentified' : button;
  }, WAIT_MS, signal);
  const { dialog } = opened;
  if (dialog) logDialog(dialog);
  if (signal.aborted) return 'stopped';
  if (confirmation === 'blocked') return 'blocked';
  if (!confirmation || confirmation === 'unidentified' || !dialog) return 'unidentified';
  const dialogs = visibleDialogs();
  if (dialogs.length !== 1 || dialogs[0] !== dialog ||
    namedButton(dialog, matchesConfirmation) !== confirmation ||
    !samePage() || !exactSelection(scanRows(main), keys)) return 'unidentified';
  confirmation.click();

  // Once sent, verify even if Stop is pressed so completed rows still count.
  let absentSince: number | null = null;
  return await waitFor(() => {
    if (blockedDialog()) return 'blocked';
    if (!samePage()) return 'unverified';
    const remaining = scanRows(main);
    const absent = !visibleDialogs().length && selectedRows.every((row) =>
      !row.box.isConnected && !row.options.isConnected && !remaining.rows.has(row.key));
    const listPresent = remaining.headers.length === 1 || ![...main.querySelectorAll<HTMLElement>(BUTTON)].some(rowMenu);
    if (!absent || !listPresent) {
      absentSince = null;
      return null;
    }
    absentSince ??= performance.now();
    return performance.now() - absentSince >= 500 ? 'done' : null;
  }, VERIFY_MS) ?? 'unverified';
}

function activityPage(category: Category, title: string, action: string, confirmTitle: string, confirmBody: string): PageAdapter<ActivityRow> {
  return {
    title, action, confirmTitle, confirmBody,
    read: readActivity,
    native: {
      checked: ({ checkbox }) => checkState(checkbox) === true,
      select: (main, keys, signal) => selectRows(main, keys, signal, context(main, category)),
      actBatch: (items, signal) => removeBatch(category, items, signal),
      blocks: (target) => {
        const button = target.closest(BUTTON);
        return !!target.closest(CHECK)?.closest(MAIN_SELECTOR) || (!!button && (
          (!!button.closest(MAIN_SELECTOR) && isRemoveLabel(labelOf(button))) ||
          (!!button.closest(DIALOG) && isConfirmLabel(category, labelOf(button)))
        ));
      },
    },
  };
}

export const activityPages = {
  reactions: activityPage('reactions', 'bulkReactionsTitle', 'bulkRemoveReactions', 'bulkReactionsConfirm', 'bulkReactionsBody'),
  comments: activityPage('comments', 'bulkCommentsTitle', 'bulkDeleteComments', 'bulkCommentsConfirm', 'bulkCommentsBody'),
};
