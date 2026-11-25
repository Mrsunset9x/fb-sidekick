/**
 * Reads Facebook's own ranking of your contacts, inside the short-lived ranker
 * frame that the page opens on facebook.com/messages/new/.
 *
 * Messenger's "New message" box lists "Your contacts" before you type, best
 * first: the people you interact with most, ranked by Facebook (the same kind
 * of ranking the old Contacts list used). Each suggestion is an <li
 * role="option"> whose id is the person's user id.
 */
import type { RankedPerson } from '../shared/protocol';
import { log } from '../shared/log';

const OPTION = '[role="listbox"] [role="option"][id]';
const WANTED = 60;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(find: () => T | null, timeoutMs: number): Promise<T | null> {
  const end = performance.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found || performance.now() > end) return found;
    await wait(150);
  }
}

/** The signed-in user's id, so they are not listed as their own contact. */
const selfId = (): string | null => document.cookie.match(/(?:^|;\s*)c_user=(\d+)/)?.[1] ?? null;

function readOptions(): RankedPerson[] {
  const self = selfId();
  const people: RankedPerson[] = [];
  for (const option of document.querySelectorAll<HTMLElement>(OPTION)) {
    const id = option.id;
    const name = option.getAttribute('aria-label')?.trim() ?? '';
    // People only: numeric ids, not "Create channel", not yourself, not the Meta AI assistant.
    if (!/^\d+$/.test(id) || !name || id === self || name === 'Meta AI') continue;
    const img = option.querySelector('img');
    people.push({ id, name, avatar: img?.currentSrc || img?.src || '' });
  }
  return people;
}

/** Scrolls the suggestions until about WANTED people are loaded or no more come. */
async function loadMore(): Promise<void> {
  const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
  if (!listbox) return;
  const scroller =
    [...listbox.querySelectorAll<HTMLElement>('*'), listbox].find(
      (el) => /auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 4,
    ) ?? null;
  if (!scroller) return;
  let count = -1;
  for (let i = 0; i < 8; i++) {
    const now = document.querySelectorAll(OPTION).length;
    if (now >= WANTED || now === count) break;
    count = now;
    scroller.scrollTop = scroller.scrollHeight;
    await wait(600);
  }
}

/** At least one real person is listed (the first suggestions are "Create channel" and Meta AI). */
const peopleListed = () => (readOptions().length ? true : null);

export async function readRanking(): Promise<RankedPerson[]> {
  if (__DEV__) log('ranker: start', location.pathname, innerWidth, innerHeight);
  let ready = await until(peopleListed, 6000);
  if (!ready) {
    // The suggestions open when the "To" field has focus.
    const field = await until(() => document.querySelector<HTMLInputElement>('input[role="combobox"]'), 4000);
    if (__DEV__) log('ranker: no suggestions yet; focusing the To field', !!field);
    // Modern Chrome can forbid scripted focus inside a sandboxed frame. Do not
    // emit a policy violation or take focus from the user when it is forbidden.
    const policy = (document as Document & { featurePolicy?: { allowsFeature(name: string): boolean } }).featurePolicy;
    if (!policy || policy.allowsFeature('focus-without-user-activation')) field?.focus();
    ready = await until(peopleListed, 10_000);
  }
  if (!ready) {
    if (__DEV__) log(
      'ranker: no people found',
      [...document.querySelectorAll(OPTION)].map((o) => `${o.id}:${o.getAttribute('aria-label')}`).join(', '),
      'focus:', document.hasFocus(), document.activeElement?.tagName, 'visibility:', document.visibilityState,
    );
    return [];
  }
  await loadMore();
  const people = readOptions();
  if (__DEV__) log('ranker: read', people.length, 'people', people.slice(0, 5).map((p) => p.name));
  (document.activeElement as HTMLElement | null)?.blur?.();
  return people;
}
