import assert from 'node:assert/strict';
import test from 'node:test';
import { extensionAlive, extensionCall, extensionValue, onExtensionInvalidated } from '../src/shared/runtime';
import { settings } from '../src/shared/settings';
import { people } from '../src/shared/people';
import { t } from '../src/shared/dom';

test('invalidated context is retired once; sync throws, rejected APIs and late callbacks cannot escape', async (testContext) => {
  const runtime = { id: 'test-extension' as string | undefined };
  let failRead: (() => Promise<Record<string, unknown>>) | undefined;
  let calls = 0;
  Object.defineProperty(globalThis, 'chrome', { configurable: true, value: {
    runtime,
    storage: {
      local: { get: () => { calls++; return failRead?.() ?? Promise.resolve({}); } },
      sync: { get: () => { calls++; return Promise.resolve({}); } },
    },
    i18n: { getMessage: () => { calls++; return 'Contacts'; } },
  } });
  testContext.after(() => Reflect.deleteProperty(globalThis, 'chrome'));

  assert.equal(extensionAlive(), true);
  assert.equal(t('contacts'), 'Contacts');
  assert.equal(await extensionCall(async () => 42), 42);
  await assert.rejects(extensionCall(() => { throw Error('storage unavailable'); }), /storage unavailable/);
  assert.throws(() => extensionValue(() => { throw Error('programming bug'); }, ''), /programming bug/);

  let stops = 0;
  onExtensionInvalidated(() => { stops++; });
  let rejectPending!: (error: Error) => void;
  const pending = extensionCall(() => new Promise<void>((_, reject) => { rejectPending = reject; }));
  // Chrome still exposes runtime.id at the guard, but storage.get throws synchronously.
  failRead = () => { throw Error('Extension context invalidated.'); };
  assert.equal((await settings.get()).view, 'contacts');
  assert.equal(stops, 1);
  rejectPending(Error('Extension context invalidated.'));
  assert.equal(await pending, undefined);
  assert.equal(stops, 1);
  const before = calls;
  assert.equal(t('contacts'), 'contacts');
  assert.deepEqual(await people.get(), { pinned: [], hidden: [], notify: [] });
  await settings.set({ view: 'inbox' });
  await extensionCall(() => { assert.fail('Late callback must not call Chrome'); });
  assert.equal(calls, before);
  assert.equal(extensionAlive(), false);
});
