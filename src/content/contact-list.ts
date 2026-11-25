import { h, icon, ICONS, t } from '../shared/dom';
import { isThreadHref, type Contact } from '../shared/protocol';
import { emptyPeople, type People } from '../shared/people';

/** Folds case and Vietnamese (and other) diacritics: "hung" finds "Hưng", "do" finds "Đỗ". */
export const fold = (s: string): string =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();

/** Apply personal preferences before ordering the rest of the people by presence. */
export function arrange(contacts: readonly Contact[], query: string, preferences: People = emptyPeople(), onlineOnly = false) {
  const q = fold(query.trim());
  const hidden = new Set(preferences.hidden);
  const visible = contacts.filter((c) => c.group || !hidden.has(c.id));
  const matches = q ? visible.filter((c) => fold(c.name).includes(q)) : visible;
  const people = matches.filter((c) => !c.group && (!onlineOnly || c.online));
  const byId = new Map(people.map((c) => [c.id, c]));
  const pinned = preferences.pinned.flatMap((id) => {
    const contact = byId.get(id);
    byId.delete(id);
    return contact ? [contact] : [];
  });
  const rest = [...byId.values()];
  return {
    people: [...pinned, ...rest.filter((c) => c.online), ...rest.filter((c) => !c.online)],
    groups: onlineOnly ? [] : matches.filter((c) => c.group),
    onlineCount: visible.filter((c) => !c.group && c.online).length,
  };
}

export function openInTab(contact: Contact): void {
  if (isThreadHref(contact.href)) window.open(`${location.origin}${contact.href}`, '_blank', 'noopener');
}

export function updateAvatar(avatar: HTMLElement, contact: Contact): void {
  avatar.dataset.initial = [...contact.name][0]?.toUpperCase() ?? '';
  if (avatar.dataset.src === contact.avatar) return;
  avatar.dataset.src = contact.avatar;
  avatar.querySelector('img')?.remove();
  if (contact.avatar) {
    const img = h('img', { src: contact.avatar, alt: '', decoding: 'async', draggable: 'false' });
    img.addEventListener('error', () => img.remove(), { once: true });
    avatar.prepend(img);
  }
}

export interface ContactRow {
  el: HTMLLIElement;
  button: HTMLButtonElement;
  more: HTMLButtonElement;
  contact: Contact;
}

const rowKey = (contact: Contact) => `${contact.group ? 'group' : 'person'}:${contact.id}`;

interface ListActions {
  open(contact: Contact): void;
  showMenu(row: ContactRow, anchor: HTMLButtonElement): void;
  showCard(row: ContactRow, delayed: boolean): void;
  hideCard(row: ContactRow): void;
  focusFallback(): void;
}

/** Reuse both the row and its controls across snapshots to preserve focus and loaded avatars. */
export class ContactList {
  readonly el = h('div', { class: 'list' });
  readonly #rows = new Map<string, ContactRow>();
  readonly #people = h('ul', { class: 'rows', role: 'list' });
  readonly #groups = h('ul', { class: 'rows', role: 'list' });
  readonly #groupSection = h('section', { class: 'groups', 'aria-labelledby': 'groups-title' },
    h('h3', { class: 'section-title', id: 'groups-title' }, t('groupChats')),
    this.#groups,
  );
  readonly #empty = h('p', { class: 'empty', role: 'status' });
  #contacts: readonly Contact[] = [];
  #preferences: People = emptyPeople();
  #onlineOnly = false;
  #query = '';
  onlineCount = 0;

  constructor(private readonly actions: ListActions) {
    this.el.append(this.#people, this.#empty, this.#groupSection);
    this.#render();
  }

  set contacts(next: readonly Contact[]) {
    this.#contacts = next;
    this.#render();
  }

  set query(next: string) {
    this.#query = next;
    this.#render();
  }

  configure(preferences: People, onlineOnly: boolean): void {
    if (this.#preferences === preferences && this.#onlineOnly === onlineOnly) return;
    this.#preferences = preferences;
    this.#onlineOnly = onlineOnly;
    this.#render();
  }

  focusFirst(): boolean {
    const first = this.el.querySelector<HTMLButtonElement>('.contact');
    first?.focus();
    return !!first;
  }

  #render(): void {
    const { people, groups, onlineCount } = arrange(this.#contacts, this.#query, this.#preferences, this.#onlineOnly);
    this.onlineCount = onlineCount;
    const focused = (this.el.getRootNode() as ShadowRoot).activeElement ?? null;
    const hadFocus = this.el.contains(focused);
    this.#setRows(this.#people, people);
    this.#setRows(this.#groups, groups);
    if (focused instanceof HTMLElement && this.el.contains(focused) &&
      (this.el.getRootNode() as ShadowRoot).activeElement !== focused) focused.focus({ preventScroll: true });
    if (hadFocus && !this.el.contains(focused) && !this.focusFirst()) this.actions.focusFallback();
    this.#groupSection.hidden = groups.length === 0;

    this.#empty.hidden = people.length + groups.length > 0 || (this.#contacts.length === 0 && !this.#onlineOnly);
    const empty = this.#query.trim() ? t('noMatch', this.#query.trim())
      : t(this.#onlineOnly ? 'noActiveContacts' : 'noContacts');
    if (this.#empty.textContent !== empty) this.#empty.textContent = empty;

    const live = new Set(this.#contacts.map(rowKey));
    for (const id of this.#rows.keys()) if (!live.has(id)) this.#rows.delete(id);
  }

  #setRows(list: HTMLUListElement, contacts: readonly Contact[]): void {
    const pinned = new Set(this.#preferences.pinned);
    const rows = contacts.map((contact) => {
      const key = rowKey(contact);
      const row = this.#rows.get(key) ?? this.#build(contact);
      this.#rows.set(key, row);
      this.#update(row, contact, !contact.group && pinned.has(contact.id));
      return row.el;
    });
    const live = new Set<Element>(rows);
    for (const child of [...list.children]) if (!live.has(child)) child.remove();
    rows.forEach((row, index) => {
      const current = list.children.item(index);
      if (current !== row) list.insertBefore(row, current);
    });
  }

  #build(contact: Contact): ContactRow {
    const button = h('button', { class: 'contact', type: 'button' },
      h('span', { class: 'avatar', 'aria-hidden': 'true' }, h('span', { class: 'presence' })),
      h('span', { class: 'contact-label' }, h('span', { class: 'name' }),
        h('span', { class: 'pin-mark', 'aria-hidden': 'true', hidden: true }, icon(ICONS.pin))),
      h('span', { class: 'badge', 'aria-hidden': 'true' }),
    );
    const more = h('button', {
      class: 'icon-button row-more', type: 'button', title: t('more'), 'aria-haspopup': 'menu',
      'aria-expanded': 'false', 'aria-controls': 'row-menu',
    }, icon(ICONS.more));
    const el = h('li', { class: 'contact-row' }, button, more);
    const row = { contact, button, el, more };
    button.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey) openInTab(row.contact);
      else this.actions.open(row.contact);
    });
    button.addEventListener('auxclick', (event) => {
      if (event.button !== 1) return;
      event.preventDefault();
      openInTab(row.contact);
    });
    button.addEventListener('mousedown', (event) => {
      if (event.button === 1) event.preventDefault();
    });
    more.addEventListener('click', () => this.actions.showMenu(row, more));
    el.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.actions.showMenu(row, button);
    });
    el.addEventListener('keydown', (event) => {
      if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
        event.preventDefault();
        event.stopPropagation();
        this.actions.showMenu(row, event.target === more ? more : button);
      } else if (event.target === button) this.#arrowKeys(event, button);
    });
    el.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse') this.actions.showCard(row, true);
    });
    el.addEventListener('pointerleave', () => this.actions.hideCard(row));
    button.addEventListener('focus', () => {
      if (button.matches(':focus-visible')) this.actions.showCard(row, false);
    });
    button.addEventListener('blur', () => this.actions.hideCard(row));
    return row;
  }

  #update(row: ContactRow, contact: Contact, pinned: boolean): void {
    const { button, more } = row;
    row.contact = contact;
    button.toggleAttribute('data-online', contact.online);
    button.toggleAttribute('data-unread', contact.unread);
    const name = button.querySelector<HTMLElement>('.name')!;
    if (name.textContent !== contact.name) name.textContent = contact.name;
    button.querySelector<HTMLElement>('.pin-mark')!.hidden = !pinned;
    button.setAttribute('aria-label', [
      contact.name, pinned ? t('pinned') : '', contact.online ? t('activeNow') : '', contact.unread ? t('unread') : '',
    ].filter(Boolean).join(', '));
    more.setAttribute('aria-label', t('moreFor', contact.name));
    updateAvatar(button.querySelector<HTMLElement>('.avatar')!, contact);
  }

  #arrowKeys(event: KeyboardEvent, from: HTMLButtonElement): void {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const all = [...this.el.querySelectorAll<HTMLButtonElement>('.contact')];
    all[all.indexOf(from) + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
  }
}
