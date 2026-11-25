/**
 * Builds the Contacts list from two sources:
 *   ranked  Facebook's ranking of the people you interact with most (who to list, in what order);
 *   inbox   your recent conversations (who is active now, what is unread, group chats).
 * A pure function: easy to read, easy to test, no DOM.
 *
 * Matching a ranked person to their conversation: by id when they are equal
 * (a plain chat's thread id is the user id), otherwise by name, because an
 * end-to-end encrypted chat has a thread id of its own. Names shared by two
 * people in the inbox are not matched, rather than matched wrongly.
 */
import type { Contact, RankedPerson } from '../shared/protocol';

const key = (name: string) => name.normalize('NFC').trim().toLocaleLowerCase();

export function mergeContacts(inbox: readonly Contact[], ranked: readonly RankedPerson[]): Contact[] {
  const people = inbox.filter((c) => !c.group);
  const byId = new Map(people.map((c) => [c.id, c]));
  const byName = new Map<string, Contact | null>();
  for (const c of people) {
    const k = key(c.name);
    byName.set(k, byName.has(k) ? null : c); // null: ambiguous
  }
  const rankedNames = new Map<string, number>();
  for (const person of ranked) {
    const k = key(person.name);
    rankedNames.set(k, (rankedNames.get(k) ?? 0) + 1);
  }
  const rankedIds = new Set(ranked.map((person) => person.id));

  const used = new Set<Contact>();
  const out: Contact[] = [];

  // People Facebook ranks highest, in its order, with live state from their conversation.
  for (const person of ranked) {
    const k = key(person.name);
    const named = rankedNames.get(k) === 1 ? byName.get(k) : null;
    const encrypted = named?.href.startsWith('/messages/e2ee/') && !rankedIds.has(named.id) ? named : null;
    const chat = byId.get(person.id) ?? encrypted;
    if (chat) used.add(chat);
    out.push({
      id: person.id,
      href: chat?.href ?? `/messages/t/${person.id}/`,
      name: chat?.name ?? person.name,
      avatar: chat?.avatar || person.avatar,
      online: chat?.online ?? false,
      unread: chat?.unread ?? false,
      group: false,
      inInbox: chat?.inInbox ?? false,
      snippet: chat?.snippet ?? '',
      time: chat?.time ?? '',
    });
  }

  // Then everyone else you have talked to recently, most recent first; groups keep their own section.
  for (const chat of inbox) if (!used.has(chat)) out.push(chat);
  return out;
}
