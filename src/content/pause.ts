/**
 * Unloads the hidden Messenger frame while its Facebook tab stays in the background.
 *
 * Messenger's own scripts keep running inside the frame and cost CPU even when
 * nobody can see the tab. After the tab has been hidden for a while, the frame
 * is removed; it is created again when any condition stops holding (the tab is
 * shown, someone gets "Notify when active", the setting is turned off).
 *
 * The decision is a pure function; `BackgroundPause` only adds the timer and
 * the visibility listener.
 */
import type { View } from '../shared/settings';

export const PAUSE_AFTER_MS = 5 * 60_000;

export interface PauseConditions {
  /** The `pauseHidden` setting. */
  enabled: boolean;
  /** The tab is in the background. */
  hidden: boolean;
  /** People with "Notify when active": their alerts need a live inbox. */
  notifying: number;
  /** The inbox view may hold a draft; only the contacts view is paused. */
  view: View;
  /** A delete or another frame-dependent action is in progress. */
  busy: boolean;
}

export const canPause = (c: PauseConditions): boolean =>
  c.enabled && c.hidden && c.notifying === 0 && c.view === 'contacts' && !c.busy;

export class BackgroundPause {
  #timer: ReturnType<typeof setTimeout> | undefined;
  #paused = false;
  #started = false;
  readonly #conditions: () => boolean;
  readonly #onPause: () => void;
  readonly #onResume: () => void;
  readonly #delay: number;
  readonly #target: EventTarget | undefined;

  constructor(options: {
    conditions: () => boolean;
    pause: () => void;
    resume: () => void;
    delay?: number;
    /** Fires `visibilitychange`; the document by default. */
    target?: EventTarget;
  }) {
    this.#conditions = options.conditions;
    this.#onPause = options.pause;
    this.#onResume = options.resume;
    this.#delay = options.delay ?? PAUSE_AFTER_MS;
    this.#target = options.target ?? (typeof document === 'undefined' ? undefined : document);
  }

  get paused(): boolean {
    return this.#paused;
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#target?.addEventListener('visibilitychange', this.evaluate);
    this.evaluate();
  }

  stop(): void {
    this.#started = false;
    this.#target?.removeEventListener('visibilitychange', this.evaluate);
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#paused = false;
  }

  /** Call whenever an input of the conditions may have changed. */
  readonly evaluate = (): void => {
    if (!this.#started) return;
    const can = this.#conditions();
    if (this.#paused) {
      if (!can) {
        this.#paused = false;
        this.#onResume();
      }
      return;
    }
    if (!can) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    } else if (this.#timer === undefined) {
      this.#timer = setTimeout(this.#fire, this.#delay);
    }
  };

  readonly #fire = (): void => {
    this.#timer = undefined;
    if (!this.#started || this.#paused || !this.#conditions()) return;
    this.#paused = true;
    this.#onPause();
  };
}
