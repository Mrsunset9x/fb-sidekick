/** Reload the extension and its Facebook tabs when the development build stamp changes. */
export function devReload(): void {
  const stamp = 'build-id.txt';
  const key = '__devReload';
  const facebook = ['https://www.facebook.com/*', 'https://web.facebook.com/*'];
  type ReloadState = { loaded: string; reloadTabs: boolean };
  const state = async () => (await chrome.storage.local.get(key))[key] as ReloadState | undefined;
  const read = () => fetch(chrome.runtime.getURL(stamp), { cache: 'no-store' })
    .then((response) => response.text())
    .then((text) => text.trim())
    .catch(() => '');

  let ready = false;
  async function check(): Promise<void> {
    if (!ready) return;
    const id = await read();
    if (!id || (await state())?.loaded === id) return;
    await chrome.storage.local.set({ [key]: { loaded: id, reloadTabs: true } });
    console.log('[dev-reload] new build', id, '- reloading');
    chrome.runtime.reload();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message === 'dev-check') void check();
  });
  chrome.alarms?.onAlarm.addListener(() => void check());
  void chrome.alarms?.create('dev-check', { periodInMinutes: 0.5 });
  setInterval(check, 1000);

  void read().then(async (id) => {
    const current = await state();
    if (!current?.reloadTabs) {
      await chrome.storage.local.set({ [key]: { loaded: id, reloadTabs: false } });
    } else {
      await chrome.storage.local.set({ [key]: { ...current, reloadTabs: false } });
      for (const tab of await chrome.tabs.query({ url: facebook })) {
        if (tab.id !== undefined) void chrome.tabs.reload(tab.id).catch(() => {});
      }
    }
    ready = true;
  });
}
