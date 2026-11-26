/**
 * facebook.com/saved: read the saved items and unsave one.
 *
 * Observed markup (Nov 2026): each item has a button labelled
 * "Hành động khác, <title>" (vi) whose menu holds a single item "Bỏ lưu".
 * Facebook's "Saved" section of the Activity Log has no bulk select, so this
 * page is where unsaving happens.
 */
import type { ActOutcome } from './runner';
import { blockedDialog, closeMenus, labelOf, normalize, visible, visibleMenus, waitFor } from './dom';

/** Prefix of each item's "more actions" button label. English is a best guess until seen. */
const MORE_PREFIXES = ['hành động khác, ', 'more actions, ', 'more options for ', 'more options, '];
const UNSAVE = new Set(['bỏ lưu', 'unsave']);
const MENU_MS = 4_000;
const VERIFY_MS = 8_000;

export interface SavedItem {
  /** Stable while the page lives: the item's link, else its title. */
  key: string;
  title: string;
  button: HTMLElement;
  box: HTMLElement;
}

const moreTitle = (button: Element): string | null => {
  const label = normalize(button.getAttribute('aria-label') ?? '');
  const prefix = MORE_PREFIXES.find((p) => label.startsWith(p));
  return prefix ? (button.getAttribute('aria-label') ?? '').trim().slice(prefix.length).trim() : null;
};

function moreButtons(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="button"][aria-label], button[aria-label]')]
    .filter((b) => moreTitle(b) !== null);
}

/** The largest ancestor that still holds only this item's button: the item's card. */
function itemBox(button: HTMLElement, main: HTMLElement): HTMLElement {
  let box = button;
  while (box.parentElement && box.parentElement !== main && moreButtons(box.parentElement).length === 1) {
    box = box.parentElement;
  }
  return box;
}

/** A post link without Facebook's tracking parameters. */
function linkKey(box: HTMLElement): string | null {
  for (const a of box.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    try {
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === '/' || url.pathname.startsWith('/saved')) continue;
      for (const name of [...url.searchParams.keys()]) if (name.startsWith('__')) url.searchParams.delete(name);
      return url.pathname + url.search;
    } catch {
      // ignore malformed links
    }
  }
  return null;
}

export function readSaved(): SavedItem[] {
  const main = document.querySelector<HTMLElement>('[role="main"]');
  if (!main) return [];
  const items: SavedItem[] = [];
  const seen = new Set<string>();
  for (const button of moreButtons(main)) {
    if (!visible(button)) continue;
    const title = moreTitle(button) ?? '';
    const box = itemBox(button, main);
    const key = linkKey(box) ?? `title:${normalize(title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ key, title, button, box });
  }
  return items;
}

const stillSaved = (key: string) => readSaved().find((item) => item.key === key) ?? null;

/** Unsaves one item through its own menu. Never clicks anything it could not identify. */
export async function unsave(target: SavedItem, signal: AbortSignal): Promise<ActOutcome> {
  if (signal.aborted) return 'stopped';
  if (blockedDialog()) return 'blocked';
  const item = target.button.isConnected ? target : stillSaved(target.key);
  if (!item) return 'skipped';
  if (!(await closeMenus())) return 'unidentified';

  item.button.scrollIntoView({ block: 'center' });
  item.button.click();
  const menu = await waitFor(() => {
    const menus = visibleMenus();
    return menus.length === 1 ? menus[0] : null;
  }, MENU_MS, signal);
  if (signal.aborted) {
    await closeMenus();
    return 'stopped';
  }
  if (!menu) return blockedDialog() ? 'blocked' : 'unidentified';

  const matches = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    .filter((el) => visible(el) && UNSAVE.has(labelOf(el)));
  if (matches.length !== 1) {
    await closeMenus();
    return 'unidentified';
  }
  matches[0]!.click();

  // Done when the menu has closed and the item has left the list, or its button no longer offers the menu.
  const verified = await waitFor(() => {
    if (blockedDialog()) return 'blocked';
    if (visibleMenus().length) return null;
    return !item.button.isConnected || !stillSaved(item.key) || moreTitle(item.button) === null ? 'done' : null;
  }, VERIFY_MS);
  if (verified === 'blocked') return 'blocked';
  return verified ? 'done' : 'unverified';
}
