import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { deleteConversation } from '../src/frame/delete';

const href = '/messages/e2ee/t/123/';
const trashPath = 'M8.75.5A2.25 2.25 0 0 0 6.5 2.75v.75H1.7z';

function inbox(t: TestContext, options: { icon?: string; item?: string; cancel?: string; confirm?: string;
  dialog?: 'replacement' | 'unrelated' | 'competing' | 'target-changed';
  controls?: 'direct' | 'wrapper' | 'multiple-ids' | 'unrelated' | 'ambiguous' | 'stale' | 'unclaimed' | 'stale-ambiguous' } = {}) {
  const events: string[] = [];
  const actions = 'button, [role="button"]';
  let hasRow = true;
  let hasMenu = false;
  let hasDialog = false;
  let initialDialog = true;
  let targetPresent = true;
  const widget = (name: string, visible = () => true, onClick = () => {}) => ({
    id: '',
    innerText: name,
    isConnected: true,
    getClientRects: () => visible() ? [{}] : [],
    closest: () => null,
    matches: (selector: string) => selector === actions,
    contains: (_el: unknown) => false,
    getAttribute: () => null,
    querySelectorAll: (_selector: string): unknown[] => [],
    dispatchEvent: (event: { type: string; key?: string }) => events.push(event.key ?? event.type),
    click: () => { events.push(name); onClick(); },
  });
  const controls = options.controls === 'multiple-ids' ? 'unrelated menu-popover' :
    options.controls === 'direct' ? 'menu-list' : options.controls === 'unrelated' ? 'unrelated' :
    ['stale', 'unclaimed', 'stale-ambiguous'].includes(options.controls ?? '') ? 'missing-node' :
      options.controls ? 'menu-popover' : null;
  const trigger = { ...widget('Options', () => true, () => { hasMenu = true; }),
    getAttribute: (name: string) => name === 'aria-controls' ? controls :
      name === 'aria-expanded' && hasMenu && options.controls !== 'unclaimed' ? 'true' : null };
  const row = { ...widget('Row'), contains: (el: unknown) => el === trigger,
    querySelectorAll: (selector: string) => selector === '[aria-haspopup="menu"]' ? [trigger] : [] };
  const link = { closest: (selector: string) => selector === '[role="row"]' ? row : null,
    getAttribute: (name: string) => name === 'href' ? href : null };
  const item = {
    ...widget(options.item ?? 'Delete chat', () => hasMenu, () => {
      hasMenu = false;
      hasDialog = true;
      if (options.dialog) setTimeout(() => {
        initialDialog = false;
        if (options.dialog === 'target-changed') targetPresent = false;
      }, 10);
    }),
    querySelectorAll: (selector: string) => selector === 'svg path' ? [{ getAttribute: () => options.icon ?? trashPath }] : [],
  };
  const menu = { ...widget('Menu', () => hasMenu),
    querySelectorAll: (selector: string) => selector === '[role="menuitem"]' ? [item] : [] };
  menu.id = 'menu-list';
  menu.contains = (el: unknown) => el === menu;
  const secondMenu = widget('Another menu', () => hasMenu && (options.controls === 'ambiguous' || options.controls === 'stale-ambiguous'));
  const wrapper = { ...widget('Popover'), contains: (el: unknown) => el === menu || el === secondMenu };
  const cancel = widget(options.cancel ?? 'Cancel');
  const confirm = widget(options.confirm ?? 'Delete chat', () => hasDialog, () => { hasRow = false; hasDialog = false; });
  const loading = { ...widget('Loading', () => hasDialog && initialDialog && !!options.dialog),
    querySelectorAll: (selector: string) => selector === actions ? [cancel] : [] };
  const title = widget(options.dialog === 'unrelated' ? 'Xóa ảnh?' : 'Xóa đoạn chat này?');
  const dialog = { ...widget('Dialog', () => hasDialog && (!options.dialog || !initialDialog)),
    getAttribute: (name: string) => name === 'role' ? 'alertdialog' : null,
    querySelectorAll: (selector: string) => selector === actions ? [cancel, confirm] : selector.includes('heading') ? [title] : [] };
  const otherDialog = widget('Other dialog', () => hasDialog && !initialDialog && options.dialog === 'competing');
  const doc = {
    activeElement: null,
    getElementById: (id: string) => ({ 'menu-popover': wrapper, 'menu-list': menu, unrelated: widget('Unrelated') })[id] ?? null,
    querySelectorAll: (selector: string) => ({
      'a[role="link"][href]': hasRow && targetPresent ? [link] : [], '[role="menu"]': [menu, secondMenu],
      '[role="dialog"], [role="alertdialog"], dialog[open]': [loading, dialog, otherDialog],
    })[selector] ?? [],
  };
  const globals = {
    document: doc, getComputedStyle: () => ({ visibility: 'visible' }), MouseEvent: Event, KeyboardEvent: class {
      readonly key: string;
      constructor(readonly type: string, options: { key: string }) { this.key = options.key; }
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : Reflect.deleteProperty(globalThis, key));
  }
  let tick = 0;
  t.mock.method(performance, 'now', () => tick += 2_000);
  return events;
}

test('delete uses an explicit action and confirmation, then verifies row removal', async (t) => {
  const events = inbox(t, { item: 'Xóa đoạn chat', confirm: 'Xóa đoạn chat', cancel: 'Hủy' });
  assert.deepEqual(await deleteConversation(href), { type: 'deleted', href, ok: true });
  assert.deepEqual(events, ['mouseover', 'mouseenter', 'Options', 'Xóa đoạn chat', 'Xóa đoạn chat']);
});

test('delete accepts the exact action label when Facebook changes its SVG or uses a sprite', async (t) => {
  const events = inbox(t, { icon: 'M0 0z' });
  assert.equal((await deleteConversation(href)).ok, true);
  assert.deepEqual(events, ['mouseover', 'mouseenter', 'Options', 'Delete chat', 'Delete chat']);
});

test('delete recognizes an explicit short confirmation label', async (t) => {
  const events = inbox(t, { item: 'Xóa đoạn chat', confirm: 'Xóa', cancel: 'Hủy bỏ' });
  assert.equal((await deleteConversation(href)).ok, true);
  assert.equal(events.at(-1), 'Xóa');
});

test('delete follows a loading dialog replaced with a localized alert dialog', async (t) => {
  const events = inbox(t, { dialog: 'replacement', confirm: 'Xóa' });
  assert.equal((await deleteConversation(href)).ok, true);
  assert.deepEqual(events, ['mouseover', 'mouseenter', 'Options', 'Delete chat', 'Xóa']);
});

for (const dialog of ['unrelated', 'competing', 'target-changed'] as const) {
  test(`delete leaves the confirmation untouched when the replacement is ${dialog}`, async (t) => {
    const events = inbox(t, { dialog, confirm: 'Xóa' });
    const result = await deleteConversation(href);
    assert.equal(result.reason, 'confirm-missing');
    assert.equal(result.ok, false);
    assert.equal(result.diagnostic?.facts.visibleAlertDialogs, 1);
    assert.deepEqual(events, ['mouseover', 'mouseenter', 'Options', 'Delete chat']);
  });
}

test('delete never guesses that the button after Cancel is a delete action', async (t) => {
  const events = inbox(t, { cancel: 'Cancel', confirm: 'Continue' });
  const result = await deleteConversation(href);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'confirm-missing');
  assert.deepEqual(result.diagnostic?.steps, ['row-found', 'options-clicked', 'menu-found', 'delete-item-clicked', 'dialog-found']);
  assert.equal(result.diagnostic?.facts.namedConfirmButtons, 0);
  assert.equal(result.diagnostic?.facts.confirmButtons, 2);
  assert.deepEqual(events, ['mouseover', 'mouseenter', 'Options', 'Delete chat', 'Escape']);
});

test('delete does not click an archive action even if it has the formerly known trash path', async (t) => {
  const events = inbox(t, { item: 'Archive chat' });
  const result = await deleteConversation(href);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'delete-action-missing');
  assert.deepEqual(result.diagnostic?.steps, ['row-found', 'options-clicked', 'menu-found']);
  assert.equal(result.diagnostic?.facts.namedDeleteItems, 0);
  assert.equal(result.diagnostic?.facts.menuItems, 1);
  assert.doesNotMatch(JSON.stringify(result.diagnostic), /"123"|"Archive chat"|"Options"|\/messages\//);
  assert.deepEqual(events, ['mouseover', 'mouseenter', 'Options', 'Escape']);
});

test('delete handles the other Vietnamese accent spelling and a shortened confirmation', async (t) => {
  inbox(t, { item: 'Xoá đoạn chat', confirm: 'Xoá', cancel: 'Huỷ' });
  assert.equal((await deleteConversation(href)).ok, true);
});

for (const controls of ['direct', 'wrapper', 'multiple-ids', 'stale'] as const) {
  test(`delete follows aria-controls through ${controls} ownership`, async (t) => {
    const events = inbox(t, { controls });
    assert.equal((await deleteConversation(href)).ok, true);
    assert.deepEqual(events, ['mouseover', 'mouseenter', 'Options', 'Delete chat', 'Delete chat']);
  });
}

for (const controls of ['unrelated', 'ambiguous', 'stale-ambiguous', 'unclaimed'] as const) {
  test(`delete stops before destructive actions when menu ownership is ${controls}`, async (t) => {
    const events = inbox(t, { controls });
    const result = await deleteConversation(href);
    assert.equal(result.reason, 'menu-missing');
    assert.equal(result.ok, false);
    assert.deepEqual(events, ['mouseover', 'mouseenter', 'Options', 'Escape']);
  });
}
