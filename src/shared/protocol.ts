/**
 * The message protocol between the docked Messenger frame and the Facebook
 * page that hosts it. Both sides are https://www.facebook.com, so postMessage
 * is sent with an exact target origin and every message is checked on arrival.
 */

/** window.name of the docked frame (the inbox). The frame scripts only act inside our frames. */
export const FRAME_NAME = 'contacts-rail-messenger';
/**
 * window.name of the short-lived frame that reads Facebook's own ranking of
 * your contacts: the "Your contacts" suggestions of Messenger's New message.
 */
export const RANKER_NAME = 'contacts-rail-ranker';

/** One person as Facebook ranks them, most interacted with first. */
export interface RankedPerson {
  /** User id; for a one-to-one chat it is also the thread id. */
  id: string;
  name: string;
  avatar: string;
}

const TAG = 'contacts-rail' as const;

/** One conversation as the Contacts list shows it. */
export interface Contact {
  /** Thread id, the stable key (the same in /messages/t/ and /messages/e2ee/t/ links). */
  id: string;
  /** The thread link as Messenger has it. */
  href: string;
  name: string;
  /** Avatar URL on Facebook's CDN, or '' when there is none. */
  avatar: string;
  /** Active now. False also when unknown: Facebook only shows presence for recent chats. */
  online: boolean;
  unread: boolean;
  /** A group conversation rather than one person. */
  group: boolean;
  /** Whether href came from an inbox row, rather than a ranked suggestion. */
  inInbox: boolean;
  snippet: string;
  time: string;
}

/** Bounded control metadata only: never names, thread IDs, messages, URLs or HTML. */
export interface DeleteDiagnostic {
  stage: string;
  elapsedMs: number;
  steps: string[];
  facts: Record<string, boolean | number>;
}

export type FrameEvent =
  /** The frame's route changed: the inbox, or one conversation. Also the frame's "I'm alive". */
  | { type: 'route'; path: string; inThread: boolean }
  /** The conversation list as it is now, in Messenger's order (most recent first). */
  | { type: 'contacts'; contacts: Contact[] }
  /** The frame asks the host page to navigate (a profile, a post, a group). */
  | { type: 'open'; url: string }
  /** The ranker frame's result: Facebook's ranking of your contacts, best first. */
  | { type: 'ranked'; people: RankedPerson[] }
  | { type: 'deleted'; href: string; ok: boolean; reason?: string; diagnostic?: DeleteDiagnostic };

export type HostCommand =
  /** This host page's selected view, independent of saved preferences or other tabs. */
  | { type: 'view'; view: 'contacts' | 'inbox' }
  /** Go back to the conversation list. */
  | { type: 'inbox' }
  /** Open one conversation inside the frame. */
  | { type: 'thread'; href: string }
  | { type: 'delete'; href: string };

export type ChatTarget = Pick<Contact, 'id' | 'href'> & Partial<Pick<Contact, 'name'>>;
export type PresenceNotice = ChatTarget & Pick<Contact, 'name' | 'avatar'>;
export type DeleteCommand = Extract<HostCommand, { type: 'delete' }>;
export type DeleteResult = Extract<FrameEvent, { type: 'deleted' }>;

export type ToBackground =
  | { type: 'presence'; contacts: PresenceNotice[] }
  | { type: 'set-person'; key: 'pinned' | 'hidden' | 'notify'; id: string; enabled: boolean }
  | DeleteCommand;

export type ToHost = { type: 'open-notification'; contact: ChatTarget };

type Envelope<T> = { tag: typeof TAG; body: T };

export function post<T extends FrameEvent | HostCommand>(target: Window, body: T): void {
  const envelope: Envelope<T> = { tag: TAG, body };
  target.postMessage(envelope, location.origin);
}

/** Listens for protocol messages from `source` only. Returns an unsubscribe. */
export function listen<T extends FrameEvent | HostCommand>(
  source: () => Window | null,
  handler: (body: T) => void,
): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== location.origin || event.source !== source()) return;
    const data = event.data as Partial<Envelope<T>> | null;
    if (data?.tag === TAG && data.body && typeof data.body === 'object') handler(data.body);
  };
  addEventListener('message', onMessage);
  return () => removeEventListener('message', onMessage);
}

export const isThreadPath = (path: string): boolean => /^\/messages\/(e2ee\/)?t\/[^/]+/.test(path);

/** The thread id in a Messenger link, or null. */
export const threadId = (href: string): string | null => href.match(/\/t\/([^/?#]+)/)?.[1] ?? null;

/** Restrict privileged commands to relative Messenger thread URLs. */
export const isThreadHref = (href: unknown): href is string =>
  typeof href === 'string' && /^\/messages\/(?:e2ee\/)?t\/[\w.-]+\/?(?:[?#][^\s\\]*)?$/.test(href);
