/**
 * Facebook's ranking of your contacts, fetched rarely and kept in storage.
 *
 * The ranking comes from a short-lived frame on facebook.com/messages/new/
 * (see frame/ranking.ts). It changes slowly, so it is cached for hours and
 * refreshed only when you are not typing anywhere on the page: the frame
 * briefly focuses Messenger's "To" field, and focus is handed back after.
 */
import { h } from '../shared/dom';
import { log } from '../shared/log';
import { SANDBOX } from './panel';
import { extensionAlive, extensionCall, extensionTask } from '../shared/runtime';
import { RANKER_NAME, listen, type FrameEvent, type RankedPerson } from '../shared/protocol';

const KEY = 'ranking';
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 30_000;
const RETRY_MS = 60_000;

interface Stored {
  at: number;
  people: RankedPerson[];
}

const isTyping = (): boolean => {
  const el = document.activeElement;
  return !!el && el !== document.body && (el.matches('input, textarea, select') || (el as HTMLElement).isContentEditable);
};

export class Ranking {
  #people: RankedPerson[] = [];
  #at = 0;
  #busy = false;
  #retry = 0;
  #stopped = false;
  #cancel: (() => void) | undefined;
  readonly #onChange: (people: RankedPerson[]) => void;

  constructor(onChange: (people: RankedPerson[]) => void) {
    this.#onChange = onChange;
  }

  get people(): readonly RankedPerson[] {
    return this.#people;
  }

  /** Loads the cached ranking, then refreshes it inside `container` if it is old. */
  async start(container: HTMLElement): Promise<void> {
    if (!extensionAlive()) return;
    const stored = (await extensionCall(() => chrome.storage.local.get(KEY)))?.[KEY] as Stored | undefined;
    if (this.#stopped || !extensionAlive()) return;
    if (__DEV__) log('ranking: cached', stored?.people?.length ?? 0, 'people from', stored ? new Date(stored.at).toLocaleTimeString() : 'never');
    if (stored?.people?.length) {
      this.#people = stored.people;
      this.#at = stored.at;
      this.#onChange(this.#people);
    }
    if (Date.now() - this.#at > MAX_AGE_MS) this.refresh(container);
  }

  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#retry);
    this.#cancel?.();
  }

  refresh(container: HTMLElement): void {
    if (this.#stopped || !extensionAlive() || this.#busy) return;
    // Never take focus from someone typing a post or a comment: try again later.
    if (isTyping() || document.visibilityState !== 'visible') {
      clearTimeout(this.#retry);
      this.#retry = window.setTimeout(() => this.refresh(container), RETRY_MS);
      return;
    }
    this.#busy = true;

    const before = document.activeElement as HTMLElement | null;
    const frame = h('iframe', {
      name: RANKER_NAME,
      class: 'aux',
      tabindex: '-1',
      'aria-hidden': 'true',
      sandbox: SANDBOX,
      src: `${location.origin}/messages/new/`,
    });

    if (__DEV__) log('ranking: refreshing');
    let finished = false;
    const finish = (people: RankedPerson[] | null) => {
      if (finished) return;
      finished = true;
      this.#cancel = undefined;
      if (__DEV__) log('ranking: finished with', people === null ? 'timeout' : `${people.length} people`);
      clearTimeout(timer);
      unlisten();
      frame.remove();
      this.#busy = false;
      // Hand focus back if the frame took it.
      if (!this.#stopped && before && document.activeElement !== before && !isTyping()) before.focus?.({ preventScroll: true });
      if (!this.#stopped && people?.length && extensionAlive()) {
        this.#people = people;
        this.#at = Date.now();
        extensionTask(() => chrome.storage.local.set({ [KEY]: { at: this.#at, people } satisfies Stored }));
        this.#onChange(people);
      }
    };
    const unlisten = listen<FrameEvent>(() => frame.contentWindow, (event) => {
      if (event.type === 'ranked') finish(event.people);
    });
    const timer = window.setTimeout(() => finish(null), TIMEOUT_MS);
    this.#cancel = () => finish(null);
    container.append(frame);
  }
}
