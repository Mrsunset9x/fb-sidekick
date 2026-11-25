import assert from 'node:assert/strict';
import test from 'node:test';
import { arrange, fold } from '../src/content/contact-list';
import { mergeContacts } from '../src/content/merge';
import { cameOnline, COOLDOWN_MS, outsideCooldown, presenceSnapshot } from '../src/shared/presence';
import { isThreadHref, type Contact, type RankedPerson } from '../src/shared/protocol';

const chat = (id: string, options: Partial<Contact> = {}): Contact => ({
  id, href: `/messages/t/${id}/`, name: id, avatar: '', online: false, unread: false, group: false,
  inInbox: true, snippet: '', time: '', ...options,
});
const person = (id: string, name: string): RankedPerson => ({ id, name, avatar: '' });
const ids = (contacts: readonly Contact[]) => contacts.map((c) => c.id);

test('merge uses the exact person ID and keeps live inbox data', () => {
  const inbox = chat('100', { name: 'Lan', online: true, unread: true, snippet: 'Chào Lan', time: '5 phút trước' });
  assert.deepEqual(mergeContacts([inbox], [person('100', 'Old name')]), [inbox]);
});

test('merge joins an encrypted thread by its unique name, retaining the ranked person ID', () => {
  const encrypted = chat('200', { href: '/messages/e2ee/t/200/', name: 'Đỗ Hưng', snippet: '🙂' });
  const rankedOnly = chat('102', { name: 'Linh', inInbox: false });
  assert.deepEqual(mergeContacts([encrypted], [person('101', '  Đỗ Hưng '), person('102', 'Linh')]), [
    { ...encrypted, id: '101' }, rankedOnly,
  ]);
});

test('merge keeps ambiguous encrypted names separate on both sides of the match', () => {
  const first = chat('200', { href: '/messages/e2ee/t/200/', name: 'Hưng' });
  const second = chat('201', { href: '/messages/e2ee/t/201/', name: 'Hưng' });
  assert.deepEqual(mergeContacts([first, second], [person('100', 'Hưng')]).map((c) => c.inInbox), [false, true, true]);
  assert.deepEqual(mergeContacts([first], [person('100', 'Hưng'), person('101', 'Hưng')]).map((c) => c.inInbox), [false, false, true]);
});

test('merge reserves exact IDs and preserves groups as separate inbox rows', () => {
  const encrypted = chat('200', { href: '/messages/e2ee/t/200/', name: 'Old name' });
  const group = chat('300', { name: 'Lan', group: true });
  const merged = mergeContacts([encrypted, group], [person('100', 'Old name'), person('200', 'Lan')]);
  assert.deepEqual(ids(merged), ['100', '200', '300']);
  assert.deepEqual(merged.map((c) => c.inInbox), [false, true, true]);
  assert.equal(merged.at(-1), group);
});

test('arrange respects pin order, then online order, and excludes hidden people from the count', () => {
  const contacts = [chat('offline'), chat('online', { online: true }), chat('pin-b', { online: true }),
    chat('pin-a'), chat('hidden', { online: true }), chat('group', { group: true, online: true })];
  const preferences = { pinned: ['pin-a', 'pin-b', 'hidden', 'missing'], hidden: ['hidden'], notify: [] };
  const all = arrange(contacts, '', preferences);
  assert.deepEqual(ids(all.people), ['pin-a', 'pin-b', 'online', 'offline']);
  assert.deepEqual(ids(all.groups), ['group']);
  assert.equal(all.onlineCount, 2);
  const active = arrange(contacts, '', preferences, true);
  assert.deepEqual(ids(active.people), ['pin-b', 'online']);
  assert.deepEqual(active.groups, []);
  assert.equal(active.onlineCount, 2);
  const search = arrange(contacts, ' B ', preferences);
  assert.deepEqual(ids(search.people), ['pin-b']);
  assert.equal(search.onlineCount, 2);
});

test('fold handles Vietnamese diacritics, decomposed accents and case', () => {
  assert.equal(fold('ĐỖ HƯNG'), 'do hung');
  assert.equal(fold('Cafe\u0301'), 'cafe');
});

test('first presence snapshot is silent and only opted-in, observed offline-to-online people qualify', () => {
  const previous = [chat('100'), chat('101'), chat('102', { online: true }), chat('104', { group: true }),
    chat('105', { inInbox: false })];
  const current = [...previous.map((c) => ({ ...c, online: true })), chat('103', { online: true })];
  const subscribed = new Set(['100', '102', '103', '104', '105']);
  assert.deepEqual(cameOnline(null, current, subscribed), []);
  assert.deepEqual(ids(cameOnline(presenceSnapshot(previous), current, subscribed)), ['100']);
  assert.deepEqual(cameOnline(presenceSnapshot(current), current, subscribed), []);
  assert.deepEqual(cameOnline(presenceSnapshot([]), current, subscribed), []);
});

test('notification cooldown lasts 30 minutes from the last notification', () => {
  const start = 123_456_789;
  assert.equal(outsideCooldown(undefined, start), true);
  assert.equal(outsideCooldown(start, start), false);
  assert.equal(outsideCooldown(start, start + 29 * 60_000), false);
  assert.equal(outsideCooldown(start, start + COOLDOWN_MS - 1), false);
  assert.equal(outsideCooldown(start, start + COOLDOWN_MS), true);
});

test('privileged Messenger commands accept only relative URLs that identify one thread', () => {
  assert.equal(isThreadHref('/messages/t/123/'), true);
  assert.equal(isThreadHref('/messages/e2ee/t/456/?ref=inbox'), true);
  for (const href of ['https://www.facebook.com/messages/t/123/', '//www.facebook.com/messages/t/123/',
    '/messages/t/123/extra', '/messages/t/123\\extra', '/messages/', '/messages/t/']) {
    assert.equal(isThreadHref(href), false, href);
  }
});
