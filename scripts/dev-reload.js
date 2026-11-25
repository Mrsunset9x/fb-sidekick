// Development only (added by `npm run dev`, never by `npm run build` or `pack`).
// Checks the build stamp; when a rebuild lands, reloads the extension and the open Facebook tabs.
// Chrome puts idle workers to sleep, so three things wake this one up: a timer while it is
// awake, an alarm, and a ping from the content script whenever a Facebook page loads.
// State lives in storage.local: storage.session is wiped by the reload itself.
const STAMP = 'build-id.txt';
const FACEBOOK = ['https://www.facebook.com/*', 'https://web.facebook.com/*'];
const KEY = '__devReload';

const read = () =>
  fetch(chrome.runtime.getURL(STAMP), { cache: 'no-store' })
    .then((r) => r.text())
    .then((t) => t.trim())
    .catch(() => '');

let ready = false;

async function check() {
  if (!ready) return;
  const id = await read();
  if (!id) return;
  const { [KEY]: state = {} } = await chrome.storage.local.get(KEY);
  if (state.loaded === id) return;
  await chrome.storage.local.set({ [KEY]: { loaded: id, reloadTabs: true } });
  console.log('[dev-reload] new build', id, '- reloading');
  chrome.runtime.reload();
}

async function afterReload() {
  const { [KEY]: state } = await chrome.storage.local.get(KEY);
  if (!state?.reloadTabs) return;
  await chrome.storage.local.set({ [KEY]: { ...state, reloadTabs: false } });
  for (const tab of await chrome.tabs.query({ url: FACEBOOK })) chrome.tabs.reload(tab.id);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message === 'dev-check') void check();
});
// Optional: a manifest loaded before `alarms` was added has no chrome.alarms.
chrome.alarms?.onAlarm.addListener(() => void check());
chrome.alarms?.create('dev-check', { periodInMinutes: 0.5 });
setInterval(check, 1000);

// On first start after a manual reload, take the current build as loaded; then reload tabs if asked.
read().then(async (id) => {
  const { [KEY]: state } = await chrome.storage.local.get(KEY);
  if (!state || !state.reloadTabs) await chrome.storage.local.set({ [KEY]: { loaded: id, reloadTabs: false } });
  await afterReload();
  ready = true;
});
