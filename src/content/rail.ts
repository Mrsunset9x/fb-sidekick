/**
 * Finds Facebook's right column and reports where the panel should sit.
 *
 * Facebook ships a new DOM often, so finding the column is a list of
 * strategies tried in order. When a release breaks the first one, add a
 * new strategy at the top; the rest of the extension does not change.
 */
import { findChatWindows, type ChatBox, type ChatWindow } from './chat-windows';

export interface RailGeometry {
  /** Left and right edges of the column's content, in viewport pixels. */
  left: number;
  right: number;
  /** Top of the column (just under Facebook's top bar). */
  top: number;
  /** Bottom of Facebook's own items in the column (friend requests, birthdays...). */
  contentBottom: number;
  /** Native chat windows which can cover the bottom of this column. */
  chatWindows?: readonly ChatBox[];
}

type Strategy = { name: string; find: () => HTMLElement | null };

const isOnRightSide = (el: Element): boolean => {
  const r = el.getBoundingClientRect();
  return r.width >= 240 && r.height > 0 && r.left > innerWidth / 2;
};

export const STRATEGIES: Strategy[] = [
  {
    name: 'complementary-landmark',
    find: () =>
      [...document.querySelectorAll<HTMLElement>('[role="complementary"]')].find(isOnRightSide) ?? null,
  },
];

export function locateRail(): HTMLElement | null {
  for (const strategy of STRATEGIES) {
    const el = strategy.find();
    if (el) return el;
  }
  return null;
}

/** Things that carry Facebook's visible content inside the column. */
const CONTENT = 'a, span, img, svg, [role="button"], h2, h3';
const GUTTER = 8;

export function measure(rail: HTMLElement, chats: readonly ChatWindow[] = []): RailGeometry {
  const box = rail.getBoundingClientRect();
  let left = Infinity;
  let right = -Infinity;
  let bottom = box.top;
  for (const el of rail.querySelectorAll(CONTENT)) {
    if (chats.some((chat) => chat.element.contains(el))) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.bottom > innerHeight * 2) continue;
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
    bottom = Math.max(bottom, r.bottom);
  }
  // An empty column has no content edges: fall back to the column's box.
  if (!Number.isFinite(left)) [left, right] = [box.left + GUTTER, box.right - GUTTER * 2];
  return {
    left: Math.round(Math.max(left, box.left)),
    right: Math.round(Math.min(right, box.right)),
    top: Math.round(Math.max(box.top, 0)),
    contentBottom: Math.round(bottom),
    chatWindows: chats.map((chat) => chat.box),
  };
}

const same = (a: RailGeometry | null, b: RailGeometry | null): boolean =>
  a === b || (!!a && !!b && a.left === b.left && a.right === b.right && a.top === b.top && a.contentBottom === b.contentBottom &&
    JSON.stringify(a.chatWindows) === JSON.stringify(b.chatWindows));

/**
 * Watches the column as Facebook navigates and re-renders, and calls
 * `onChange` with its geometry, or null when the page has no column.
 * All triggers are coalesced into one measurement per animation frame.
 */
export class RailWatcher {
  #rail: HTMLElement | null = null;
  #last: RailGeometry | null = null;
  #frame = 0;
  #chatRoots: HTMLElement[] = [];
  /** Ignore feed changes; remeasure when a chat is added, removed, resized or hidden. */
  #page = new MutationObserver((changes) => {
    if (!this.#rail?.isConnected || changes.some((change) => {
      const target = change.target;
      if (target instanceof Element && this.#chatRoots.some((root) => root.contains(target) || target.contains(root))) return true;
      if (change.type === 'attributes' && target instanceof Element &&
          (target.matches('[role="log"]') || target.querySelector('[role="log"]'))) return true;
      return [...change.addedNodes, ...change.removedNodes].some((node) => node instanceof Element &&
        (node.matches('[role="log"]') || !!node.querySelector('[role="log"]')));
    })) this.schedule();
  });
  /** Changes inside the column (a request accepted, a birthday added). */
  #content = new MutationObserver(() => this.schedule());
  #resize = new ResizeObserver(() => this.schedule());
  #chatResize = new ResizeObserver(() => this.schedule());
  readonly #onChange: (geometry: RailGeometry | null) => void;

  constructor(onChange: (geometry: RailGeometry | null) => void) {
    this.#onChange = onChange;
  }

  start(): void {
    this.#page.observe(document.body, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['style', 'hidden', 'aria-hidden', 'role'] });
    addEventListener('resize', this.schedule, { passive: true });
    addEventListener('scroll', this.schedule, { passive: true });
    this.schedule();
  }

  stop(): void {
    this.#page.disconnect();
    this.#content.disconnect();
    this.#resize.disconnect();
    this.#chatResize.disconnect();
    this.#chatRoots = [];
    removeEventListener('resize', this.schedule);
    removeEventListener('scroll', this.schedule);
    cancelAnimationFrame(this.#frame);
    this.#frame = 0;
    this.#rail = null;
    this.#last = null;
  }

  readonly schedule = (): void => {
    if (!this.#frame) this.#frame = requestAnimationFrame(this.#tick);
  };

  readonly #tick = (): void => {
    this.#frame = 0;
    if (!this.#rail?.isConnected || !isOnRightSide(this.#rail)) this.#attach(locateRail());
    const chats = findChatWindows();
    const roots = chats.map((chat) => chat.element);
    for (const root of this.#chatRoots) if (!roots.includes(root)) this.#chatResize.unobserve(root);
    for (const root of roots) if (!this.#chatRoots.includes(root)) this.#chatResize.observe(root);
    this.#chatRoots = roots;
    const next = this.#rail ? measure(this.#rail, chats) : null;
    if (same(next, this.#last)) return;
    this.#last = next;
    this.#onChange(next);
  };

  #attach(rail: HTMLElement | null): void {
    if (rail === this.#rail) return;
    this.#resize.disconnect();
    this.#content.disconnect();
    this.#rail = rail;
    if (!rail) return;
    this.#content.observe(rail, { childList: true, subtree: true });
    this.#resize.observe(rail);
    for (const child of rail.children) this.#resize.observe(child);
  }
}
