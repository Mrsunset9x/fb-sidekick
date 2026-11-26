/**
 * Runs one bulk action (unsave, unlike, unfollow...) over a list of items,
 * one item at a time, at a human pace, and stops at the first sign of trouble.
 *
 * DOM-free: the page adapter supplies `act`, the runner supplies the pacing,
 * the daily budget and the stop rules, so all of that is unit-tested.
 */

/** What one action did. Anything other than done/skipped stops the run. */
export type ActOutcome = 'done' | 'skipped' | StopReason;
export type StopReason =
  /** The user pressed Stop, or the page went away. */
  | 'stopped'
  /** Facebook showed a rate-limit, restriction or checkpoint message. */
  | 'blocked'
  /** A menu, item or button could not be identified exactly. */
  | 'unidentified'
  /** The action was sent but its result could not be confirmed. */
  | 'unverified'
  /** Today's budget is used up. */
  | 'daily-limit';

export interface Pace {
  /** Random wait between two items, in ms. */
  min: number;
  max: number;
  /** A longer break after this many completed items. */
  batch: number;
  breakMin: number;
  breakMax: number;
}

export const PACE: Readonly<Pace> = Object.freeze({
  min: 3_000, max: 7_000, batch: 25, breakMin: 120_000, breakMax: 180_000,
});

export interface Progress {
  total: number;
  done: number;
  skipped: number;
  state: 'running' | 'resting' | 'finished' | 'stopped';
  reason?: StopReason;
}

export interface RunnerDeps<T> {
  act(item: T, signal: AbortSignal): Promise<ActOutcome>;
  /** Items left in today's budget. */
  budget(): Promise<number>;
  /** Records completed items against today's budget. */
  spend(count: number): Promise<void>;
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  random(): number;
  onProgress(progress: Progress): void;
  pace?: Pace;
}

const between = (min: number, max: number, r: number) => Math.round(min + (max - min) * r);

export async function runBulk<T>(items: readonly T[], signal: AbortSignal, deps: RunnerDeps<T>): Promise<Progress> {
  const pace = deps.pace ?? PACE;
  const progress: Progress = { total: items.length, done: 0, skipped: 0, state: 'running' };
  const report = (patch: Partial<Progress>) => {
    Object.assign(progress, patch);
    deps.onProgress({ ...progress });
  };
  const stop = (reason: StopReason) => {
    report({ state: 'stopped', reason });
    return { ...progress };
  };
  report({});
  let restedAt = 0;

  for (const [index, item] of items.entries()) {
    if (signal.aborted) return stop('stopped');
    if (index > 0) {
      // Once per completed batch, even when skipped items follow it.
      const rest = progress.done > 0 && progress.done % pace.batch === 0 && progress.done !== restedAt;
      if (rest) {
        restedAt = progress.done;
        report({ state: 'resting' });
      }
      try {
        await deps.sleep(rest ? between(pace.breakMin, pace.breakMax, deps.random())
          : between(pace.min, pace.max, deps.random()), signal);
      } catch {
        return stop('stopped');
      }
      if (signal.aborted) return stop('stopped');
      if (rest) report({ state: 'running' });
    }
    if ((await deps.budget()) <= 0) return stop('daily-limit');

    let outcome: ActOutcome;
    try {
      outcome = await deps.act(item, signal);
    } catch {
      outcome = signal.aborted ? 'stopped' : 'unidentified';
    }
    if (outcome === 'done') {
      await deps.spend(1);
      report({ done: progress.done + 1 });
    } else if (outcome === 'skipped') {
      report({ skipped: progress.skipped + 1 });
    } else {
      return stop(outcome);
    }
  }
  report({ state: 'finished' });
  return { ...progress };
}

/** A sleep that ends early, rejecting, when the signal aborts. */
export const abortableSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

export const DAILY_LIMIT = 200;
const DAILY_KEY = 'cleanupDaily';

interface Daily {
  day: string;
  count: number;
}

const today = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

/** Today's count in chrome.storage.local, shared by every tab and every bulk action. */
export const dailyBudget = {
  async remaining(limit = DAILY_LIMIT): Promise<number> {
    const stored = (await chrome.storage.local.get(DAILY_KEY))[DAILY_KEY] as Daily | undefined;
    return limit - (stored?.day === today() ? stored.count : 0);
  },
  async spend(count: number): Promise<void> {
    const stored = (await chrome.storage.local.get(DAILY_KEY))[DAILY_KEY] as Daily | undefined;
    const day = today();
    const used = stored?.day === day ? stored.count : 0;
    await chrome.storage.local.set({ [DAILY_KEY]: { day, count: used + count } satisfies Daily });
  },
};
