/** Messenger markup for deleting a thread. Stop when the target or controls are ambiguous. */
import { isThreadHref, threadId, type DeleteDiagnostic, type DeleteResult } from '../shared/protocol';

const ACTION = 'button, [role="button"]';
const DIALOG = '[role="dialog"], [role="alertdialog"], dialog[open]';
const WAIT_MS = 4_000;
const VERIFY_MS = 10_000;
const DELETE_LABELS = new Set([
  'delete chat', 'delete conversation', 'xóa đoạn chat', 'xoá đoạn chat',
  'xóa cuộc trò chuyện', 'xoá cuộc trò chuyện',
]);
const CONFIRM_LABELS = new Set([...DELETE_LABELS, 'delete', 'xóa', 'xoá']);

const visible = (el: HTMLElement) => el.getClientRects().length > 0 &&
  getComputedStyle(el).visibility === 'visible' && !el.closest('[aria-hidden="true"], [hidden]');
const enabled = (el: HTMLElement) => visible(el) && !el.matches(':disabled, [aria-disabled="true"]');
const normalize = (value: string) => value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
const label = (el: HTMLElement) => normalize(el.getAttribute('aria-label') || el.innerText || el.textContent || '');
const only = <T>(items: readonly T[]): T | null => items.length === 1 ? items[0]! : null;
const visibleWidgets = (role: 'menu' | 'dialog') =>
  [...document.querySelectorAll<HTMLElement>(role === 'dialog' ? DIALOG : '[role="menu"]')].filter(visible);

function hasDeleteChatTitle(dialog: HTMLElement): boolean | null {
  const titles = [normalize(dialog.getAttribute('aria-label') ?? '')];
  for (const id of dialog.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? []) {
    const title = document.getElementById(id);
    if (title) titles.push(label(title));
  }
  for (const heading of dialog.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
    if (visible(heading)) titles.push(label(heading));
  }
  if (!titles.some(Boolean)) return null;
  return titles.some((title) =>
    /^(?:delete (?:this |the )?(?:chat|conversation)|(?:xóa|xoá) (?:đoạn chat|cuộc trò chuyện)(?: này)?)\s*\??$/.test(title));
}

function controlledElements(trigger: HTMLElement): HTMLElement[] {
  return (trigger.getAttribute('aria-controls')?.trim().split(/\s+/) ?? [])
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => !!el);
}

const chatMenuLabels = new Set(['lựa chọn khác cho đoạn chat này', 'more options for this chat',
  'more options for this conversation']);

// Some Messenger triggers reference an ID which no longer exists after opening their popover.
// The caller establishes that there was no open menu immediately before clicking this row.
function ownsNewMenu(trigger: HTMLElement, menu: HTMLElement): boolean {
  const labelledBy = menu.getAttribute('aria-labelledby')?.trim().split(/\s+/) ?? [];
  if (labelledBy.length && (!trigger.id || !labelledBy.includes(trigger.id))) return false;
  for (const other of document.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]')) {
    if (other === trigger || !visible(other)) continue;
    if (other.getAttribute('aria-expanded') === 'true' || controlledElements(other).some((el) => el.contains(menu))) return false;
  }
  if (labelledBy.length || trigger.getAttribute('aria-expanded') === 'true') return true;
  // Some buttons omit expanded state. Require both a conversation-options label and a popover
  // anchored against this button, including a popover flipped above or beside the button.
  if (!chatMenuLabels.has((menu.getAttribute('aria-label') ?? '').normalize('NFC').trim().toLowerCase())) return false;
  const a = trigger.getBoundingClientRect();
  const b = menu.getBoundingClientRect();
  const gap = 20;
  return a.left <= b.right + gap && a.right >= b.left - gap && a.top <= b.bottom + gap && a.bottom >= b.top - gap;
}

const finders = {
  rows(id: string): HTMLElement[] {
    const rows = new Set<HTMLElement>();
    for (const link of document.querySelectorAll<HTMLAnchorElement>('a[role="link"][href]')) {
      const href = link.getAttribute('href');
      if (!isThreadHref(href) || threadId(href) !== id) continue;
      const row = link.closest<HTMLElement>('[role="row"]');
      if (row) rows.add(row);
    }
    return [...rows];
  },
  options(row: HTMLElement): HTMLElement | null {
    return only([...row.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]')].filter(
      (el) => el.matches(ACTION) && enabled(el),
    ));
  },
  menu(trigger: HTMLElement): HTMLElement | null {
    const menus = visibleWidgets('menu');
    if (!trigger.getAttribute('aria-controls')?.trim()) return only(menus);
    // aria-controls identifies the controlled popover, which may wrap the menu.
    // It is an IDREF list, not a requirement that role=menu carry the same ID.
    const containers = controlledElements(trigger);
    if (containers.length) {
      return only(menus.filter((menu) => containers.some((el) =>
        el !== document.body && el !== document.documentElement && el.contains(menu))));
    }
    const menu = only(menus);
    return menu && ownsNewMenu(trigger, menu) ? menu : null;
  },
  menuItem(menu: HTMLElement): HTMLElement | null {
    return only([...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].filter(
      // Facebook changes SVG paths and also uses sprites. The exact localized
      // action name identifies the operation; a decorative icon cannot do that.
      (item) => enabled(item) && DELETE_LABELS.has(label(item)),
    ));
  },
  confirm(dialog: HTMLElement, menuLabel: string): HTMLElement | null {
    const buttons = [...dialog.querySelectorAll<HTMLElement>(ACTION)].filter(enabled);
    const named = menuLabel ? buttons.filter((button) => label(button) === menuLabel) : [];
    if (named.length) return only(named);
    // The confirmation can shorten "Delete chat" to "Delete". Never infer a
    // destructive action merely from its position after Cancel.
    return only(buttons.filter((button) => CONFIRM_LABELS.has(label(button))));
  },
};

async function waitFor<T>(find: () => T | null, timeout = WAIT_MS): Promise<T | null> {
  const deadline = performance.now() + timeout;
  do {
    const found = find();
    if (found !== null) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (performance.now() < deadline);
  return null;
}

function escape(target: HTMLElement): void {
  const active = target.contains(document.activeElement) ? document.activeElement : target;
  active?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
}

export async function deleteConversation(href: string): Promise<DeleteResult> {
  let opened: HTMLElement | null = null;
  let ok = false;
  const started = performance.now();
  const steps: string[] = [];
  const facts: DeleteDiagnostic['facts'] = {};
  const fail = (reason: string): DeleteResult => ({ type: 'deleted', href, ok: false, reason,
    diagnostic: { stage: reason, elapsedMs: Math.round(performance.now() - started), steps, facts } });
  try {
    const id = isThreadHref(href) ? threadId(href) : null;
    if (!id) return fail('invalid-thread');
    const row = await waitFor(() => only(finders.rows(id).filter(visible)));
    facts.matchingRows = finders.rows(id).length;
    if (!row) return fail('row-missing');
    steps.push('row-found');

    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    row.dispatchEvent(new MouseEvent('mouseenter'));
    const options = await waitFor(() => finders.rows(id).includes(row) ? finders.options(row) : null);
    facts.rowStillPresent = finders.rows(id).includes(row);
    facts.rowActions = row.querySelectorAll(ACTION).length;
    facts.menuTriggers = row.querySelectorAll('[aria-haspopup="menu"]').length;
    facts.enabledMenuTriggers = [...row.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]')].filter(enabled).length;
    facts.optionsAlreadyExpanded = options?.getAttribute('aria-expanded') === 'true';
    facts.existingMenus = visibleWidgets('menu').length;
    facts.existingDialogs = visibleWidgets('dialog').length;
    if (!options || options.getAttribute('aria-expanded') === 'true' || visibleWidgets('menu').length ||
      visibleWidgets('dialog').length) return fail('options-missing');

    opened = options;
    options.click();
    steps.push('options-clicked');
    const menu = await waitFor(() => finders.menu(options));
    const menus = visibleWidgets('menu');
    const controlled = options.getAttribute('aria-controls');
    facts.visibleMenus = menus.length;
    facts.hasAriaControls = !!controlled;
    facts.optionsExpandedAfterClick = options.getAttribute('aria-expanded') === 'true';
    facts.controlledMenuMatch = menus.some((widget) => widget.id === controlled);
    const containers = controlledElements(options);
    facts.controlledElements = containers.length;
    facts.controlledMenuContainerMatch = menus.some((widget) => containers.some((container) => container.contains(widget)));
    if (!menu) return fail('menu-missing');
    steps.push('menu-found');
    opened = menu;
    const item = await waitFor(() => visible(menu) ? finders.menuItem(menu) : null);
    facts.menuStillVisible = visible(menu);
    facts.menuItems = menu.querySelectorAll('[role="menuitem"]').length;
    facts.namedDeleteItems = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .filter((el) => DELETE_LABELS.has(label(el))).length;
    facts.rowStillContainsOptions = row.contains(options);
    if (!item || only(finders.rows(id).filter(visible)) !== row || !row.contains(options) ||
      finders.menu(options) !== menu || visibleWidgets('dialog').length) {
      return fail('delete-action-missing');
    }
    const menuLabel = label(item);
    const inboxUrl = document.URL;
    item.click();
    steps.push('delete-item-clicked');
    let firstDialog: HTMLElement | null = null;
    const currentConfirmation = () => {
      const dialogs = visibleWidgets('dialog');
      facts.visibleDialogs = dialogs.length;
      facts.visibleAlertDialogs = dialogs.filter((dialog) => dialog.getAttribute('role') === 'alertdialog').length;
      if (dialogs.length > 1) facts.ambiguousDialogs = true;
      const dialog = only(dialogs);
      facts.dialogStillVisible = firstDialog ? dialogs.includes(firstDialog) : !!dialog;
      const buttons = dialog ? [...dialog.querySelectorAll<HTMLElement>(ACTION)] : [];
      const named = buttons.filter((button) => CONFIRM_LABELS.has(label(button)));
      facts.confirmButtons = buttons.length;
      facts.namedConfirmButtons = named.length;
      facts.enabledNamedConfirmButtons = named.filter(enabled).length;
      if (!dialog || facts.ambiguousDialogs || document.URL !== inboxUrl) return null;
      if (!firstDialog) {
        firstDialog = dialog;
        opened = dialog;
        steps.push('dialog-found');
      }
      if (dialog !== firstDialog) facts.dialogReplaced = true;
      const button = finders.confirm(dialog, menuLabel);
      if (!button) return null;
      if (!DELETE_LABELS.has(label(button))) {
        const chatTitle = hasDeleteChatTitle(dialog);
        if (chatTitle === false || (dialog !== firstDialog && !chatTitle)) return null;
      }
      return { dialog, button };
    };
    const confirmation = await waitFor(currentConfirmation, 8_000);
    if (!firstDialog) return fail('dialog-missing');
    if (!confirmation) return fail('confirm-missing');
    const current = currentConfirmation();
    const targetRow = only(finders.rows(id));
    facts.targetRowPresentAtConfirm = !!targetRow;
    if (current?.button !== confirmation.button || current.dialog !== confirmation.dialog ||
        !targetRow || (row.isConnected && row !== targetRow)) return fail('confirm-missing');
    opened = confirmation.dialog;
    confirmation.button.click();
    steps.push('confirm-clicked');
    ok = !!await waitFor(() =>
      document.URL === inboxUrl && !visibleWidgets('dialog').length && !finders.rows(id).length ? true : null, VERIFY_MS);
    return ok ? { type: 'deleted', href, ok } : fail('deletion-unverified');
  } catch {
    return fail('unexpected-error');
  } finally {
    if (!ok && opened?.isConnected && !facts.ambiguousDialogs && visible(opened)) escape(opened);
  }
}
