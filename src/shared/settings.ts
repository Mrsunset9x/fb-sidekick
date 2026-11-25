/**
 * Settings: one typed schema, one store.
 *
 * Every part of the extension (content script, popup) reads and writes
 * settings through `settings`, and listens for changes with `subscribe`.
 * chrome.storage.onChanged is the only channel between them, so the popup
 * never has to message a tab.
 *
 * To add a setting: add it to `Settings` and `DEFAULTS`. Nothing else.
 */

import { extensionAlive, extensionCall, extensionValue } from './runtime';
export { extensionAlive } from './runtime';

export const RAIL_MODES = ['below', 'full'] as const;
export type RailMode = (typeof RAIL_MODES)[number];

export const VIEWS = ['contacts', 'inbox'] as const;
/** 'contacts': the Contacts list. 'inbox': Messenger itself, to read and reply in the panel. */
export type View = (typeof VIEWS)[number];

export interface Settings {
  /** Master switch. Off removes the panel from every open tab. */
  enabled: boolean;
  /** 'below': dock under Facebook's own right-column items. 'full': take the whole column. */
  railMode: RailMode;
  /** Hide Messenger's own top bar inside the panel. */
  compact: boolean;
  /** Panel is folded to its header. Toggled from the panel itself. */
  collapsed: boolean;
  /** Panel is widened over the feed to read a conversation. Toggled from the panel. */
  wide: boolean;
  /** Legacy storage field. Current panel navigation is page-local and starts on contacts. */
  view: View;
  onlineOnly: boolean;
  /**
   * Unload the hidden Messenger frame after a tab has been in the background for a while.
   * Skipped while anyone has "Notify when active", because those alerts need a live inbox.
   */
  pauseHidden: boolean;
}

export const DEFAULTS: Readonly<Settings> = Object.freeze({
  enabled: true,
  railMode: 'below',
  compact: true,
  collapsed: false,
  wide: false,
  view: 'contacts',
  onlineOnly: false,
  pauseHidden: true,
});

/** Settings with a fixed set of values; anything else falls back to the default. */
const ALLOWED: Partial<Record<keyof Settings, readonly string[]>> = { railMode: RAIL_MODES, view: VIEWS };

const KEY = 'settings';
const area = (): chrome.storage.StorageArea => chrome.storage.local;

function normalise(raw: unknown): Settings {
  const out: Settings = { ...DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      const value = (raw as Record<string, unknown>)[key];
      if (typeof value !== typeof DEFAULTS[key]) continue;
      if (ALLOWED[key] && !ALLOWED[key].includes(value as string)) continue;
      (out as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

export const settings = {
  async get(): Promise<Settings> {
    if (!extensionAlive()) return { ...DEFAULTS };
    const stored = await extensionCall(() => area().get(KEY));
    return normalise(stored?.[KEY]);
  },

  async set(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...(await this.get()), ...patch };
    await extensionCall(() => area().set({ [KEY]: next }));
    return next;
  },

  /** Calls `listener` with the full settings whenever any of them change. Returns an unsubscribe. */
  subscribe(listener: (next: Settings, prev: Settings) => void): () => void {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      const change = changes[KEY];
      if (!extensionAlive() || areaName !== 'local' || !change) return;
      listener(normalise(change.newValue), normalise(change.oldValue));
    };
    extensionValue(() => chrome.storage.onChanged.addListener(handler), undefined);
    return () => extensionValue(() => chrome.storage.onChanged.removeListener(handler), undefined);
  },
};
