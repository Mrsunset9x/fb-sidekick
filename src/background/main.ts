import { t } from '../shared/dom';
import { PEOPLE_KEYS, people } from '../shared/people';
import { outsideCooldown } from '../shared/presence';
import { isThreadHref, type ChatTarget, type DeleteCommand, type DeleteResult, type PresenceNotice,
  type ToBackground, type ToHost } from '../shared/protocol';
import { devReload } from './dev-reload';

const FACEBOOK = /^https:\/\/(?:www|web)\.facebook\.com\//;
const FACEBOOK_TABS = ['https://www.facebook.com/*', 'https://web.facebook.com/*'];
const NOTICE_PREFIX = 'contacts-active:';
const FALLBACK_ICON = 'icons/128.png';

interface NoticeState {
  tabId: number;
  contact: ChatTarget;
  origin: string;
}

// One worker serializes the cooldown check and claim across the profile's Facebook tabs. Timestamps
// survive a browser restart; the click target only needs to survive service-worker suspension.
let presenceQueue = Promise.resolve();
let peopleQueue = Promise.resolve();

async function avatarIcon(avatar: string): Promise<string> {
  try {
    const url = new URL(avatar);
    if (url.protocol !== 'https:' || !/(?:^|\.)(?:fbcdn\.net|fbsbx\.com|facebook\.com)$/.test(url.hostname)) {
      return FALLBACK_ICON;
    }
    const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(2500) });
    const mime = response.headers.get('content-type')?.split(';')[0] ?? '';
    if (!response.ok || !/^image\/(?:jpeg|png|webp|gif|avif)$/.test(mime)) return FALLBACK_ICON;
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 256 * 1024) return FALLBACK_ICON;
    const encoded = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    return `data:${mime};base64,${encoded}`;
  } catch {
    return FALLBACK_ICON;
  }
}

async function notify(contact: PresenceNotice, tabId: number, origin: string): Promise<void> {
  const { id, href, name, avatar } = contact;
  const key = NOTICE_PREFIX + id;
  const previous = (await chrome.storage.local.get(key))[key] as number | undefined;
  const now = Date.now();
  if (!outsideCooldown(previous, now)) return;
  const notification: NoticeState = { tabId, origin, contact: { id, href } };
  await chrome.storage.local.set({ [key]: now });
  await chrome.storage.session.set({ [key]: notification });
  const options: chrome.notifications.NotificationCreateOptions = {
    type: 'basic', title: name, message: t('activeNowNotice'), iconUrl: await avatarIcon(avatar),
  };
  try {
    await chrome.notifications.create(key, options);
  } catch {
    if (options.iconUrl === FALLBACK_ICON) return;
    await chrome.notifications.create(key, { ...options, iconUrl: FALLBACK_ICON });
  }
}

function isNotice(contact: PresenceNotice): boolean {
  return !!contact && typeof contact.id === 'string' && !!contact.id && isThreadHref(contact.href) &&
    typeof contact.name === 'string' && !!contact.name && typeof contact.avatar === 'string';
}

async function deleteInInbox(tabId: number, command: DeleteCommand): Promise<DeleteResult> {
  const fail: DeleteResult = { type: 'deleted', href: command.href, ok: false, reason: 'inbox-unavailable' };
  let result = fail;
  try {
    // Only the docked inbox registers a handler for this authenticated command.
    const response = await chrome.tabs.sendMessage<DeleteCommand, DeleteResult | undefined>(tabId, command);
    if (response?.type === 'deleted' && response.href === command.href && typeof response.ok === 'boolean') result = response;
  } catch { /* Keep the connection failure, without retrying a destructive request. */ }
  if (!result.ok) {
    // Keep one local report, excluding the requested href and all conversation data.
    try {
      await chrome.storage.local.set({ deleteDiagnostic: {
        version: chrome.runtime.getManifest().version,
        at: new Date().toISOString(),
        reason: result.reason ?? 'invalid-response',
        ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}),
      } });
    } catch { /* Diagnostics must not change the operation's result. */ }
  }
  return result;
}

chrome.runtime.onMessage.addListener((message: ToBackground, sender, reply) => {
  const tabId = sender.tab?.id;
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 || tabId === undefined || !FACEBOOK.test(sender.url ?? '')) return;
  switch (message?.type) {
    case 'set-person': {
      const { key, id, enabled } = message;
      if (!PEOPLE_KEYS.includes(key) || typeof id !== 'string' || !id || typeof enabled !== 'boolean') return;
      const write = peopleQueue.then(() => people.set(key, id, enabled));
      peopleQueue = write.then(() => {}, () => {});
      void write.then(() => reply(true), () => reply(false));
      return true;
    }
    case 'presence': {
      if (!Array.isArray(message.contacts)) return;
      const origin = new URL(sender.url!).origin;
      presenceQueue = presenceQueue.then(async () => {
        const subscribed = new Set((await people.get()).notify);
        for (const contact of message.contacts) {
          if (isNotice(contact) && subscribed.has(contact.id)) await notify(contact, tabId, origin).catch(() => {});
        }
      }).catch(() => {});
      // Keep the channel open until the notification has been handed to Chrome.
      void presenceQueue.then(() => reply(true));
      return true;
    }
    case 'delete':
      if (!isThreadHref(message.href)) return;
      void deleteInInbox(tabId, message).then(reply);
      return true;
  }
});

async function openNotice(id: string): Promise<void> {
  const notice = (await chrome.storage.session.get(id))[id] as NoticeState | undefined;
  if (!notice) return;
  await chrome.notifications.clear(id);
  const original = await chrome.tabs.get(notice.tabId).catch(() => null);
  const tab = original?.url && FACEBOOK.test(original.url) ? original : (await chrome.tabs.query({ url: FACEBOOK_TABS }))[0];
  if (tab?.id !== undefined) {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    await chrome.tabs.update(tab.id, { active: true }).catch(() => {});
    const message: ToHost = { type: 'open-notification', contact: notice.contact };
    const handled = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }).catch(() => false);
    if (handled) return;
  }
  await chrome.tabs.create({ url: `${notice.origin}${notice.contact.href}` });
}

chrome.notifications.onClicked.addListener((id) => {
  if (id.startsWith(NOTICE_PREFIX)) void openNotice(id).catch(() => {});
});

if (__DEV__) devReload();
