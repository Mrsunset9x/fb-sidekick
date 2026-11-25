/**
 * Content script inside the docked Messenger frame.
 *
 * It runs on every facebook.com/messages page but acts only inside the frame
 * this extension created (matched by window.name), so a normal Messenger tab
 * is never touched. Its jobs:
 *   - read the conversation list and send it to the page (the Contacts list);
 *   - tell the page which route is open (inbox or a conversation);
 *   - compact mode: hide Facebook's top bar when the inbox is shown;
 *   - send links that leave Messenger (a profile, a post) to the page;
 *   - follow the page's commands: back to the inbox, open a conversation.
 */
import css from './frame.css';
import { settings } from '../shared/settings';
import { FRAME_NAME, RANKER_NAME, isThreadHref, isThreadPath, listen, post, type HostCommand } from '../shared/protocol';
import { watchContacts } from './contacts';
import { readRanking } from './ranking';
import { deleteConversation } from './delete';
import { extensionAlive, extensionTask, extensionValue } from '../shared/runtime';

const parentWindow = window.parent;

function compactStyle(): (on: boolean) => void {
  const style = document.createElement('style');
  style.dataset.contactsRail = '';
  style.textContent = css;
  return (on) => {
    if (on && !style.isConnected) document.documentElement.append(style);
    else if (!on) style.remove();
  };
}

function watchRoute(onChange: (path: string) => void): void {
  let last = '';
  const check = () => {
    const path = location.pathname;
    if (path === last) return;
    last = path;
    onChange(path);
  };
  const nav = (window as { navigation?: EventTarget }).navigation;
  if (nav) nav.addEventListener('navigatesuccess', check);
  else setInterval(check, 500);
  addEventListener('popstate', check);
  check();
}

function routeLinksToHost(): void {
  document.addEventListener(
    'click',
    (event) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith('/messages')) return;
      event.preventDefault();
      event.stopPropagation();
      post(parentWindow, { type: 'open', url: url.href });
    },
    true,
  );
}

async function run(): Promise<void> {
  const setCompact = compactStyle();
  let hostView: 'contacts' | 'inbox' = 'contacts';
  /** Conversations opened since the inbox was last shown; null until it has been. */
  let stepsFromInbox: number | null = null;

  watchRoute((path) => {
    const inThread = isThreadPath(path);
    if (!inThread) stepsFromInbox = 0;
    else if (stepsFromInbox !== null) stepsFromInbox++;
    post(parentWindow, { type: 'route', path, inThread });
  });
  routeLinksToHost();

  listen<Exclude<HostCommand, { type: 'delete' }>>(() => parentWindow, (command) => {
    switch (command.type) {
      case 'view':
        if (command.view === 'contacts' || command.view === 'inbox') hostView = command.view;
        break;
      case 'inbox':
        // Back through Messenger's own history keeps the inbox's scroll and state;
        // a frame that opened straight on a conversation has no inbox to go back to.
        if (stepsFromInbox) history.go(-stepsFromInbox);
        else location.replace('/messages/');
        break;
      case 'thread': {
        // Prefer Messenger's own link (an in-app navigation, no reload).
        const link = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].find(
          (a) => a.getAttribute('href') === command.href,
        );
        if (link) link.click();
        else if (command.href.startsWith('/messages/')) location.assign(command.href);
        break;
      }
    }
  });

  let deleting = false;
  let refreshContacts: (() => void) | undefined;
  // Same-origin page code can spoof postMessage. Only the extension's worker can relay a delete.
  extensionValue(() => chrome.runtime.onMessage.addListener((command: HostCommand, sender, reply) => {
    if (sender.id !== chrome.runtime.id || sender.tab || command?.type !== 'delete' || !isThreadHref(command.href)) return;
    if (deleting) {
      reply({ type: 'deleted', href: command.href, ok: false, reason: 'busy' });
      return;
    }
    deleting = true;
    void deleteConversation(command.href).then((result) => {
      deleting = false;
      reply(result);
      if (result.ok) refreshContacts?.();
    });
    return true;
  }), undefined);

  let current = await settings.get();
  if (!extensionAlive()) return;
  settings.subscribe((next) => {
    current = next;
    setCompact(next.compact);
  });
  setCompact(current.compact);

  // In the contacts view nobody sees this frame, so the list is kept at its top (the most recent).
  const start = () => {
    refreshContacts = watchContacts(
      (contacts) => post(parentWindow, { type: 'contacts', contacts }),
      () => hostView === 'contacts',
    );
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
}

async function runRanker(): Promise<void> {
  const people = await readRanking();
  post(parentWindow, { type: 'ranked', people });
}

if (window.top !== window) {
  if (window.name === FRAME_NAME) extensionTask(run);
  else if (window.name === RANKER_NAME && location.pathname.startsWith('/messages/new')) {
    const start = () => extensionTask(runRanker);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
}
