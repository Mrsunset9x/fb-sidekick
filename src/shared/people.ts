/** Person preferences shared by Chrome profiles with sync enabled. */
import { extensionAlive, extensionCall, extensionValue } from './runtime';

export interface People {
  pinned: string[];
  hidden: string[];
  notify: string[];
}

export const PEOPLE_KEYS = ['pinned', 'hidden', 'notify'] as const satisfies readonly (keyof People)[];
const KEY = 'people';

export const emptyPeople = (): People => ({ pinned: [], hidden: [], notify: [] });

function normalise(raw: unknown): People {
  const result = emptyPeople();
  if (!raw || typeof raw !== 'object') return result;
  for (const key of PEOPLE_KEYS) {
    const ids = (raw as Record<string, unknown>)[key];
    if (Array.isArray(ids)) result[key] = [...new Set(ids.filter((id): id is string => typeof id === 'string' && !!id))];
  }
  return result;
}

export const people = {
  async get(): Promise<People> {
    if (!extensionAlive()) return emptyPeople();
    return normalise((await extensionCall(() => chrome.storage.sync.get(KEY)))?.[KEY]);
  },

  /** Called by the worker, which serializes writes from all open Facebook tabs. */
  async set(key: keyof People, id: string, enabled: boolean): Promise<People> {
    const next = await this.get();
    if (next[key].includes(id) === enabled) return next;
    next[key] = enabled ? [...next[key], id] : next[key].filter((item) => item !== id);
    await extensionCall(() => chrome.storage.sync.set({ [KEY]: next }));
    return next;
  },

  subscribe(listener: (next: People, prev: People) => void): () => void {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      const change = changes[KEY];
      if (extensionAlive() && areaName === 'sync' && change) listener(normalise(change.newValue), normalise(change.oldValue));
    };
    extensionValue(() => chrome.storage.onChanged.addListener(handler), undefined);
    return () => extensionValue(() => chrome.storage.onChanged.removeListener(handler), undefined);
  },
};
