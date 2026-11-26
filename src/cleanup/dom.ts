/**
 * Shared DOM helpers for bulk actions: exact label matching, waiting, menus
 * and Facebook's "you're blocked / try again later" messages.
 *
 * Rule for every page adapter: click only what was identified by its exact
 * label. Never fall back to position ("the first item"), because Facebook
 * puts Block and Report next to Unfollow.
 */

export const normalize = (value: string): string =>
  value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

export const labelOf = (el: Element): string =>
  normalize(el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.textContent || '');

export const visible = (el: Element): boolean =>
  el.getClientRects().length > 0 && getComputedStyle(el).visibility === 'visible' &&
  !el.closest('[aria-hidden="true"], [hidden]');

export const visibleMenus = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('[role="menu"]')].filter(visible);

export const visibleDialogs = (): HTMLElement[] =>
  [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], dialog[open]')].filter(visible);

export const MAIN_SELECTOR = '[role="main"]';

/** Watch the content column and direct child changes along its ancestor chain. */
export function watchMain(sync: (main: HTMLElement | null) => void): () => void {
  let frame = 0;
  let scope: Element[] | null = null;
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(refresh);
  };
  const observer = new MutationObserver((records) => {
    // Updating our own Saved control must not trigger another read of Facebook's list.
    if (records.some((record) => record.type !== 'attributes' ||
      !(record.target instanceof Element && record.target.matches('[data-fb-sidekick="check"]')))) {
      schedule();
    }
  });
  function refresh(): void {
    frame = 0;
    const main = document.querySelector<HTMLElement>(MAIN_SELECTOR);
    const ancestors: Element[] = [];
    for (let node: Element | null = main; node; node = node.parentElement) ancestors.push(node);
    const previous = scope;
    if (!previous || ancestors.length !== previous.length || ancestors.some((node, i) => node !== previous[i])) {
      observer.disconnect();
      previous?.[0]?.removeEventListener('change', schedule, true);
      scope = ancestors;
      if (main) {
        // Native inputs can update their checked property without changing an attribute.
        main.addEventListener('change', schedule, true);
        observer.observe(main, {
          childList: true, subtree: true, characterData: true,
          attributeFilter: ['aria-checked', 'aria-label', 'aria-hidden', 'hidden', 'href', 'role'],
        });
        for (const ancestor of ancestors.slice(1)) observer.observe(ancestor, { childList: true });
      } else {
        // Navigation may temporarily remove main. Watch for its arrival until it can be scoped again.
        observer.observe(document.documentElement, { childList: true, subtree: true, attributeFilter: ['role'] });
      }
    }
    sync(main);
  }
  refresh();
  return () => {
    observer.disconnect();
    scope?.[0]?.removeEventListener('change', schedule, true);
    if (frame) cancelAnimationFrame(frame);
  };
}

/** Polls `find` every 100 ms until it returns something truthy, the time runs out or the signal aborts. */
export async function waitFor<T>(find: () => T | null | undefined | false, ms: number, signal?: AbortSignal): Promise<T | null> {
  const end = Date.now() + ms;
  for (;;) {
    if (signal?.aborted) return null;
    const found = find();
    if (found) return found;
    if (Date.now() >= end) return null;
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function pressEscape(): void {
  const target = document.activeElement ?? document.body;
  for (const type of ['keydown', 'keyup'] as const) {
    target.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
  }
}

/** Closes any open menu. False when one is still open afterwards. */
export async function closeMenus(): Promise<boolean> {
  if (!visibleMenus().length) return true;
  pressEscape();
  return !!(await waitFor(() => !visibleMenus().length, 1_500));
}

/**
 * Facebook's messages for rate limits, feature blocks and checkpoints, in
 * English and Vietnamese. Seeing one in a dialog stops every bulk action.
 */
const BLOCKED = [
  /temporarily blocked/, /you('|’)re temporarily/, /try again later/, /restricted/, /we limit how often/,
  /checkpoint/, /confirm (it'?s|that it'?s) you/, /suspicious/,
  /tạm thời bị chặn/, /bị hạn chế/, /thử lại sau/, /chúng tôi giới hạn/, /xác nhận đó là bạn/, /đáng ngờ/,
];

export const isBlockedText = (text: string): boolean => {
  const value = normalize(text);
  return BLOCKED.some((pattern) => pattern.test(value));
};

/** Chat windows are dialogs too; a friend writing "thử lại sau" must not stop a run. */
const isChat = (dialog: HTMLElement) => !!dialog.querySelector('[role="log"], [contenteditable="true"]');

export const blockedDialog = (): HTMLElement | null =>
  visibleDialogs().find((dialog) => !isChat(dialog) && isBlockedText(dialog.innerText || dialog.textContent || '')) ?? null;
