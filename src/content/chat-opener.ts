import { isThreadPath, threadId, type ChatTarget } from '../shared/protocol';
import { findChatWindows } from './chat-windows';

export interface ChatOpener {
  readonly name: string;
  open(contact: ChatTarget): Promise<boolean>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const normalized = (text: string) => text.normalize('NFC').replace(/\uFE0F/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const visible = (el: HTMLElement) => el.getClientRects().length > 0 &&
  getComputedStyle(el).visibility !== 'hidden' && !el.closest('[hidden],[aria-hidden="true"]');
const accessibleName = (el: Element) => normalized(el.getAttribute('aria-label') ||
  (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' '));

async function poll<T>(find: () => T | null, timeout: number, current: () => boolean): Promise<T | null> {
  const end = performance.now() + timeout;
  while (current()) {
    const found = find();
    if (found || performance.now() >= end) return found;
    await wait(80);
  }
  return null;
}

function menuButton(): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>('button[aria-haspopup],[role="button"][aria-haspopup],button[aria-label^="Messenger"],[role="button"][aria-label^="Messenger"]')) {
    if (!/^messenger(?:$|,)/.test(accessibleName(el))) continue;
    const box = el.getBoundingClientRect();
    if (box.top < 64 && box.bottom > 0 && visible(el)) return el;
  }
  return null;
}

function menuFor(button: HTMLElement): HTMLElement | null {
  const controlled = button.getAttribute('aria-controls')?.split(/\s+/).map((id) => document.getElementById(id)) ?? [];
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"],dialog[open]')].find((el) =>
    visible(el) && (accessibleName(el) === 'messenger' || controlled.some((container) => container?.contains(el)))) ?? null;
}

function threadLink(menu: HTMLElement, ids: ReadonlySet<string>): HTMLAnchorElement | null {
  for (const link of menu.querySelectorAll<HTMLAnchorElement>('a[href*="/t/"]')) {
    if (link.origin === location.origin && isThreadPath(link.pathname) &&
        ids.has(threadId(link.pathname) ?? '') && visible(link)) return link;
  }
  return null;
}

function windowFor(contact: ChatTarget, previous?: ReadonlySet<HTMLElement>): HTMLElement | null {
  const name = normalized(contact.name ?? '');
  const id = threadId(contact.href);
  for (const { element } of findChatWindows()) {
    const log = element.querySelector<HTMLElement>('[role="log"]');
    if (!log) continue;
    // Only inspect the window's controls. Links within messages can reference other people.
    if ([...element.querySelectorAll<HTMLAnchorElement>('a[href]')].some((a) => !log.contains(a) && a.origin === location.origin &&
        ((isThreadPath(a.pathname) && threadId(a.pathname) === id) ||
          a.pathname.replace(/\/$/, '') === '/' + contact.id))) return element;
    const transcript = accessibleName(log);
    if (previous && (!previous.has(log) || element.contains(document.activeElement)) && name &&
      ['tin nhắn trong cuộc trò chuyện với ', 'messages in conversation with ', 'messages in the conversation with ']
      .some((prefix) => transcript === prefix + name)) return element;
  }
  return null;
}

function searchField(menu: HTMLElement): HTMLInputElement | null {
  return [...menu.querySelectorAll<HTMLInputElement>('input')].find((input) =>
    visible(input) && /^(?:search messenger|tìm kiếm trên messenger)$/.test(accessibleName(input) || normalized(input.placeholder))) ?? null;
}

function fillSearch(field: HTMLInputElement, value: string): void {
  // The native setter lets Facebook observe a real value change through its input listener.
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}

export class MessengerMenuOpener implements ChatOpener {
  readonly name = 'messenger-menu';
  #request = 0;
  #finished = Promise.resolve(false);

  cancel(): void { ++this.#request; }

  open(contact: ChatTarget): Promise<boolean> {
    const request = ++this.#request;
    const current = () => request === this.#request;
    // Finish the contact click before opening a popover. Its bubbling click is outside Facebook's menu.
    const run = this.#finished.then(async () => {
      await wait(0);
      return current() && this.#open(contact, current);
    });
    this.#finished = run.catch(() => false);
    return this.#finished;
  }

  async #open(contact: ChatTarget, current: () => boolean): Promise<boolean> {
    const ids = new Set([contact.id, threadId(contact.href) ?? contact.id]);
    const button = menuButton();
    const existing = windowFor(contact);
    if (existing) {
      existing.querySelector<HTMLElement>('[contenteditable="true"][role="textbox"], textarea')?.focus({ preventScroll: true });
      return true;
    }
    if (!button) return false;
    const wasOpen = !!menuFor(button) || button.getAttribute('aria-expanded') === 'true';
    let field: HTMLInputElement | null = null;
    const veil = document.createElement('style');
    veil.textContent = '[role="dialog"][aria-label="Messenger"],[data-contacts-rail-opening]{opacity:0!important;pointer-events:none!important}';
    let menu: HTMLElement | null = null;
    try {
      if (!wasOpen) {
        document.head.append(veil);
        button.click();
      }
      menu = await poll(() => menuFor(button), 6500, current);
      if (!menu) return false;
      if (!wasOpen) menu.setAttribute('data-contacts-rail-opening', '');
      const find = () => { const active = menuFor(button); return active && threadLink(active, ids); };
      let action: HTMLElement | null = await poll(find, 3500, current);
      if (!action && current() && !wasOpen && contact.name) {
        const active = menuFor(button);
        field = active && searchField(active);
        if (field && !field.value) {
          field.focus({ preventScroll: true });
          fillSearch(field, contact.name);
          action = await poll(() => {
            const results = menuFor(button);
            if (!results) return null;
            const link = threadLink(results, ids);
            if (link) return link;
            // Some search results use "#" as their href but expose the recipient ID on the option.
            const options = [...results.querySelectorAll<HTMLElement>('[role="option"][id]')]
              .filter((el) => visible(el) && ids.has(el.id));
            return options.length === 1 ? options[0]! : null;
          }, 4500, current);
        } else field = null;
      }
      if (!action || !current()) return false;
      const previous = new Set(findChatWindows().flatMap(({ element }) =>
        [...element.querySelectorAll<HTMLElement>('[role="log"]')]));
      action.click();
      return !!await poll(() => windowFor(contact, previous), 6500, current);
    } finally {
      if (field && contact.name && field.isConnected && field.value === contact.name) fillSearch(field, '');
      if (!wasOpen && menu && menuFor(button) === menu) button.click();
      menu?.removeAttribute('data-contacts-rail-opening');
      veil.remove();
    }
  }
}
