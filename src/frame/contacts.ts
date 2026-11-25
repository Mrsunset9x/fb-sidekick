/**
 * Reads the conversation list out of Messenger's inbox, inside the frame.
 *
 * Messenger's markup has no stable ids or test hooks, so every read goes
 * through a small set of named finders. When Facebook changes its markup,
 * fix the finder that broke; the rest of the extension only sees `Contact`.
 */
import { isThreadPath, threadId, type Contact } from '../shared/protocol';
import { log } from '../shared/log';

/** A conversation row: a thread link that carries an avatar. */
const ROW = 'a[role="link"][href*="/t/"]:has(img)';

/** Text of a node with emoji kept: Facebook draws emoji as <img alt="😀">. */
function textOf(node: Node): string {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) out += child.textContent ?? '';
    else if (child instanceof HTMLImageElement) out += child.alt;
    else out += textOf(child);
  }
  return out;
}

/** The colour Facebook paints "active now" dots with, resolved in this document. */
function positiveColour(): string {
  const probe = document.createElement('span');
  probe.style.cssText = 'position:absolute;width:0;height:0;background:var(--positive)';
  document.body.append(probe);
  const colour = getComputedStyle(probe).backgroundColor;
  probe.remove();
  return colour;
}

const finders = {
  avatar: (row: Element) => row.querySelector('img'),
  /** The name is the first text block to the right of the avatar. */
  name(row: Element, avatar: HTMLImageElement): HTMLElement | null {
    const right = avatar.getBoundingClientRect().right;
    for (const span of row.querySelectorAll<HTMLElement>('span[dir="auto"]')) {
      const r = span.getBoundingClientRect();
      if (r.width > 0 && r.left >= right - 1 && span.textContent?.trim()) return span;
    }
    return null;
  },
  /**
   * "Active now" is a small dot in the positive colour over the avatar. The dot
   * holds a visually hidden label, so it is matched by size, not by being empty.
   */
  online(row: Element, green: string): boolean {
    for (const el of row.querySelectorAll<HTMLElement>('span, div')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.width <= 24 && r.height <= 24 && getComputedStyle(el).backgroundColor === green) return true;
    }
    return false;
  },
  /** Unread conversations set their name in bold. */
  unread: (name: HTMLElement) => Number(getComputedStyle(name).fontWeight) >= 600,
  /** Messenger labels group rows ("Group chat: <name>") and leaves people's rows unlabelled. */
  group: (row: Element) => !!row.getAttribute('aria-label')?.trim(),
  timestamp: (row: Element) => row.querySelector('abbr, time'),
  snippet(row: Element, name: HTMLElement, timestamp: Element | null): string {
    const { bottom, left } = name.getBoundingClientRect();
    for (const span of row.querySelectorAll<HTMLElement>('span[dir="auto"]')) {
      if (span.contains(name) || name.contains(span) || timestamp?.contains(span) || span.contains(timestamp)) continue;
      const rect = span.getBoundingClientRect();
      if (!rect.width || rect.top < bottom - 2 || rect.left < left - 1) continue;
      const text = textOf(span).trim();
      if (text) return text;
    }
    return '';
  },
};

export function readContacts(): Contact[] {
  const green = positiveColour();
  const seen = new Set<string>();
  const contacts: Contact[] = [];
  for (const row of document.querySelectorAll<HTMLAnchorElement>(ROW)) {
    const href = row.getAttribute('href') ?? '';
    // Only real conversations: not "Message requests", archived or other folders.
    const id = isThreadPath(href) ? threadId(href) : null;
    const avatar = finders.avatar(row);
    if (!id || !avatar || seen.has(id)) continue;
    const nameEl = finders.name(row, avatar);
    if (!nameEl) continue;
    const name = textOf(nameEl).trim();
    if (!name) continue;
    const timestamp = finders.timestamp(row);
    seen.add(id);
    contacts.push({
      id,
      href,
      name,
      avatar: avatar.currentSrc || avatar.src,
      online: finders.online(row, green),
      unread: finders.unread(nameEl),
      group: finders.group(row),
      inInbox: true,
      snippet: finders.snippet(row, nameEl, timestamp),
      time: (timestamp?.getAttribute('aria-label') || timestamp?.getAttribute('title') || timestamp?.textContent || '').trim(),
    });
  }
  return contacts;
}

/** The element that scrolls the conversation list, found from its first row. */
export function listScroller(): HTMLElement | null {
  let el = document.querySelector(ROW)?.parentElement ?? null;
  while (el && el !== document.body) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) return el;
    el = el.parentElement;
  }
  return null;
}

const sameList = (a: Contact[], b: Contact[]) =>
  a.length === b.length &&
  a.every((c, i) => {
    const d = b[i]!;
    return (
      c.id === d.id && c.href === d.href && c.name === d.name && c.avatar === d.avatar &&
      c.online === d.online && c.unread === d.unread && c.group === d.group &&
      c.snippet === d.snippet && c.time === d.time
    );
  });

/**
 * Watches the inbox and calls `onChange` with the list whenever a row, a
 * presence dot or an unread state changes. Reads are batched to one per 300ms.
 *
 * Messenger only renders the rows that fit its viewport, so the page makes
 * this frame tall in the contacts view and the list is read from the top:
 * never scrolled, so it is always the most recent conversations, in order.
 */
export function watchContacts(onChange: (contacts: Contact[]) => void, pinToTop: () => boolean): () => void {
  let last: Contact[] = [];
  let timer = 0;
  const read = (allowEmpty = false) => {
    timer = 0;
    const scroller = pinToTop() ? listScroller() : null;
    if (scroller && scroller.scrollTop > 0) scroller.scrollTop = 0;
    const next = readContacts();
    if ((!next.length && !allowEmpty) || sameList(next, last)) return;
    if (__DEV__ && !last.length) log('inbox: rows', next.map((c) => `${c.name} ${c.href}`).join(' | '));
    last = next;
    onChange(next);
  };
  const schedule = () => {
    if (!timer) timer = window.setTimeout(read, 300);
  };
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    characterData: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style', 'src', 'aria-label', 'title', 'href'],
  });
  schedule();
  // Confirmed deletes can legitimately empty the inbox. Transient empty reads during loading cannot.
  return () => {
    clearTimeout(timer);
    read(true);
  };
}
