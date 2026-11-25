import type { Contact } from './protocol';

export const COOLDOWN_MS = 30 * 60 * 1000;

export const outsideCooldown = (last: number | undefined, now: number): boolean =>
  last === undefined || now - last >= COOLDOWN_MS;

export function presenceSnapshot(contacts: readonly Contact[]): ReadonlyMap<string, boolean> {
  return new Map(contacts.filter((c) => c.inInbox && !c.group).map((c) => [c.id, c.online]));
}

/** Missing contacts have unknown presence, even if they were observed on an earlier snapshot. */
export function cameOnline(
  previous: ReadonlyMap<string, boolean> | null,
  current: readonly Contact[],
  notify: ReadonlySet<string>,
): Contact[] {
  if (!previous) return [];
  return current.filter((c) => c.inInbox && !c.group && c.online && notify.has(c.id) && previous.get(c.id) === false);
}
