import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import type { DeleteResult, ToBackground } from '../src/shared/protocol';

test('worker deduplicates two tabs, routes notification clicks, and relays deletes from top frames', async (t) => {
  const href = '/messages/e2ee/t/123/';
  const tab = (id: number) => ({ id, windowId: 7, url: 'https://www.facebook.com/' });
  const sender = (id: number, frameId = 0) => ({ id: 'extension', tab: tab(id), url: tab(id).url, frameId });
  const local: Record<string, unknown> = {};
  const session: Record<string, unknown> = {};
  const sync = { people: { pinned: [], hidden: [], notify: ['456'] } };
  const storage = (contents: Record<string, unknown>) => ({
    get: async (key: string) => ({ [key]: contents[key] }),
    set: async (next: Record<string, unknown>) => { Object.assign(contents, next); },
  });
  const notifications: { key: string; options: { title: string; message: string; iconUrl: string } }[] = [];
  const actions: unknown[] = [];
  let deleteReply: DeleteResult = { type: 'deleted', href, ok: true };
  let onClick: (id: string) => void;
  let onMessage: (message: ToBackground, sender: ReturnType<typeof sender>, reply: (message: unknown) => void) => unknown;
  t.mock.method(globalThis, 'fetch', async () => { throw Error('Unexpected fetch'); });
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
    runtime: { id: 'extension', getManifest: () => ({ version: '1.1.3' }), onMessage: { addListener: (fn: typeof onMessage) => { onMessage = fn; } } },
    storage: { local: storage(local), session: storage(session), sync: storage(sync) },
    i18n: { getMessage: () => 'Active now' },
    notifications: {
      create: async (key: string, options: typeof notifications[number]['options']) => { notifications.push({ key, options }); return key; },
      clear: async () => true,
      onClicked: { addListener: (fn: typeof onClick) => { onClick = fn; } },
    },
    tabs: {
      get: async (id: number) => tab(id),
      update: async (id: number) => { actions.push(['activate', id]); },
      sendMessage: async (id: number, message: ToBackground, options: unknown) => {
        actions.push(['relay', id, message, options]);
        return message.type === 'delete' ? deleteReply : true;
      },
    },
    windows: { update: async (id: number) => { actions.push(['focus', id]); } },
  } });
  t.after(() => Reflect.deleteProperty(globalThis, 'chrome'));
  await import('../src/background/main');
  const send = (id: number, message: ToBackground) => new Promise((resolve) => onMessage(message, sender(id), resolve));
  const presence: ToBackground = { type: 'presence', contacts: [{ id: '456', href, name: 'Lan', avatar: '' }] };
  assert.deepEqual(await Promise.all([send(1, presence), send(2, presence)]), [true, true]);
  assert.equal(notifications.length, 1);
  const notification = notifications[0]!;
  assert.equal(notification.options.title, 'Lan');
  assert.equal(notification.options.message, 'Active now');
  assert.equal(notification.options.iconUrl, 'icons/128.png');
  assert.equal(typeof local[notification.key], 'number');

  onClick!(notification.key);
  await setImmediate();
  assert.deepEqual(actions.splice(0), [['focus', 7], ['activate', 1],
    ['relay', 1, { type: 'open-notification', contact: { id: '456', href } }, { frameId: 0 }]]);

  const deletion = { type: 'delete', href } as const;
  assert.equal(onMessage!(deletion, sender(2, 3), () => assert.fail('A subframe cannot request deletion')), undefined);
  assert.deepEqual(await send(2, deletion), { type: 'deleted', href, ok: true });
  assert.deepEqual(actions, [['relay', 2, deletion, undefined]]);
  assert.equal(local.deleteDiagnostic, undefined);

  deleteReply = { type: 'deleted', href, ok: false, reason: 'menu-missing', diagnostic: {
    stage: 'menu-missing', elapsedMs: 4000, steps: ['row-found', 'options-clicked'], facts: { visibleMenus: 0 },
  } };
  assert.deepEqual(await send(2, deletion), deleteReply);
  const report = local.deleteDiagnostic as { version: string; reason: string; diagnostic: unknown };
  assert.equal(report.version, '1.1.3');
  assert.equal(report.reason, 'menu-missing');
  assert.deepEqual(report.diagnostic, deleteReply.diagnostic);
  assert.doesNotMatch(JSON.stringify(report), /\/messages\/|href|tabId/);
  t.mock.method(chrome.storage.local, 'set', async () => { throw Error('Storage unavailable'); });
  assert.deepEqual(await send(2, deletion), deleteReply);
});
