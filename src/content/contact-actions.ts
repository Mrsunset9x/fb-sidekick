import { h, icon, ICONS, t } from '../shared/dom';
import { emptyPeople, type People } from '../shared/people';
import { isThreadHref, type Contact } from '../shared/protocol';
import { openInTab, updateAvatar, type ContactRow } from './contact-list';
import { menuItem, menuKeys } from './menu';

const CARD_DELAY_MS = 400;
const GAP = 8;

interface Actions {
  setPerson(key: keyof People, id: string, enabled: boolean): void;
  deleteConversation(contact: Contact): void;
  focusFallback(): void;
  closeHeaderMenu(): void;
}

export class ContactActions {
  readonly menu = h('div', { class: 'menu row-menu', id: 'row-menu', role: 'menu', hidden: true });
  readonly #cardAvatar = h('span', { class: 'avatar', 'aria-hidden': 'true' });
  readonly #cardName = h('div', { class: 'card-name' });
  readonly #cardActive = h('div', { class: 'card-active' }, t('activeNowNotice'));
  readonly #cardSnippet = h('div', { class: 'card-snippet' });
  readonly #cardTime = h('div', { class: 'card-time' });
  readonly card = h('div', { class: 'hover-card', id: 'contact-card', role: 'tooltip', hidden: true },
    h('div', { class: 'card-header' }, this.#cardAvatar, h('div', {}, this.#cardName, this.#cardActive)),
    this.#cardSnippet, this.#cardTime,
  );
  readonly dialog = h('dialog', { class: 'action-dialog', 'aria-labelledby': 'action-title' });
  #menuTarget: { row: ContactRow; anchor: HTMLButtonElement } | null = null;
  #cardTarget: ContactRow | null = null;
  #cardTimer = 0;
  #described: HTMLButtonElement | undefined;
  #restoreDialogFocus: (() => void) | undefined;
  #hiddenDialog = false;
  #contacts: readonly Contact[] = [];
  #people: People = emptyPeople();
  deleting = false;

  constructor(private readonly actions: Actions, private readonly list: HTMLElement) {
    menuKeys(this.menu, (restore) => this.closeMenu(restore));
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.closeDialog();
    });
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.closeDialog();
      }
      if (event.key !== 'Tab') return;
      const buttons = [...this.dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const first = buttons[0];
      const last = buttons.at(-1);
      const from = event.shiftKey ? first : last;
      if (event.target === from) {
        event.preventDefault();
        (event.shiftKey ? last : first)?.focus();
      }
    });
    list.addEventListener('scroll', () => this.position());
  }

  update(contacts: readonly Contact[], people: People): void {
    this.#contacts = contacts;
    const changed = this.#people !== people;
    this.#people = people;
    if (this.#hiddenDialog && changed) {
      const button = this.dialog.querySelector<HTMLButtonElement>('[data-done]');
      this.#renderHidden();
      button?.focus();
    }
    if (this.#menuTarget && changed) {
      const active = (this.menu.getRootNode() as ShadowRoot).activeElement;
      const items = [...this.menu.querySelectorAll<HTMLButtonElement>('button')];
      const index = active ? items.indexOf(active as HTMLButtonElement) : 0;
      this.#renderMenu();
      this.menu.querySelectorAll<HTMLButtonElement>('button')[Math.max(index, 0)]?.focus();
    }
    this.position();
  }

  showMenu(row: ContactRow, anchor: HTMLButtonElement): void {
    const same = this.#menuTarget?.row === row && this.#menuTarget.anchor === anchor;
    this.closeMenu(same);
    if (same || this.dialog.open) return;
    this.actions.closeHeaderMenu();
    this.hideCard();
    this.#menuTarget = { row, anchor };
    row.more.setAttribute('aria-expanded', 'true');
    this.menu.setAttribute('aria-label', t('moreFor', row.contact.name));
    this.#renderMenu();
    this.menu.hidden = false;
    this.position();
    this.menu.querySelector<HTMLButtonElement>('button')?.focus();
  }

  closeMenu(restore = false): void {
    const target = this.#menuTarget;
    if (!target) return;
    this.#menuTarget = null;
    target.row.more.setAttribute('aria-expanded', 'false');
    this.menu.hidden = true;
    if (restore) this.#focus(target.anchor);
  }

  #renderMenu(): void {
    const target = this.#menuTarget;
    if (!target) return;
    const { contact } = target.row;
    const { id, group } = contact;
    const item = (label: string, run: () => void, paths: readonly string[], checked?: boolean) =>
      menuItem(label, () => {
        this.closeMenu(true);
        run();
      }, paths, checked);
    const items: HTMLElement[] = [];
    if (!group) {
      const pinned = this.#people.pinned.includes(id);
      const notify = this.#people.notify.includes(id);
      items.push(
        item(t(pinned ? 'unpin' : 'pin'), () => this.actions.setPerson('pinned', id, !pinned), ICONS.pin),
        item(t('notifyActive'), () => this.actions.setPerson('notify', id, !notify), notify ? ICONS.checked : ICONS.unchecked, notify),
        item(t('hidePerson'), () => {
          this.actions.focusFallback();
          this.actions.setPerson('hidden', id, true);
        }, ICONS.hide),
      );
    }
    items.push(item(t('openChatInTab'), () => openInTab(contact), ICONS.external));
    if (contact.inInbox && isThreadHref(contact.href)) {
      const remove = menuItem(t('deleteConversation'), () => {
        this.closeMenu();
        this.#confirmDelete(contact, target.anchor);
      }, ICONS.trash);
      remove.classList.add('negative');
      remove.disabled = this.deleting;
      items.push(h('div', { class: 'menu-separator', role: 'separator' }), remove);
    }
    this.menu.replaceChildren(...items);
  }

  showCard(row: ContactRow, delayed: boolean): void {
    this.hideCard();
    if (!this.menu.hidden || this.dialog.open) return;
    if (!(row.contact.snippet || row.contact.time || row.contact.online)) return;
    this.#cardTarget = row;
    if (delayed) {
      this.#cardTimer = window.setTimeout(() => {
        this.#cardTimer = 0;
        this.position();
      }, CARD_DELAY_MS);
    } else this.position();
  }

  hideCard(row?: ContactRow): void {
    if (row && this.#cardTarget !== row) return;
    this.#cardTarget = null;
    clearTimeout(this.#cardTimer);
    this.#cardTimer = 0;
    this.#setCardVisible(false);
  }

  #setCardVisible(show: boolean, forButton?: HTMLButtonElement): void {
    if (this.#described !== forButton) {
      this.#described?.removeAttribute('aria-describedby');
      forButton?.setAttribute('aria-describedby', this.card.id);
      this.#described = forButton;
    }
    this.card.hidden = !show;
  }

  position(): void {
    const listBox = this.list.getBoundingClientRect();
    const rowBox = (row: ContactRow) => {
      const rect = row.el.getBoundingClientRect();
      return rect.width && rect.bottom > listBox.top && rect.top < listBox.bottom ? rect : null;
    };
    if (this.#menuTarget) {
      const { row } = this.#menuTarget;
      const rect = rowBox(row);
      if (!rect) this.closeMenu(true);
      else {
        const { offsetWidth: width, offsetHeight: height } = this.menu;
        const right = Math.min(rect.right - GAP, innerWidth - GAP);
        const top = rect.bottom + height + GAP <= innerHeight ? rect.bottom : rect.top - height;
        Object.assign(this.menu.style, { left: `${Math.max(GAP, right - width)}px`, top: `${Math.max(GAP, top)}px` });
      }
    }
    const row = this.#cardTarget;
    if (!row || this.#cardTimer) return;
    const rect = rowBox(row);
    const { contact } = row;
    const width = Math.min(280, (rect?.left ?? 0) - GAP * 2);
    if (!rect || width < 160 || !(contact.snippet || contact.time || contact.online)) {
      this.#setCardVisible(false);
      return;
    }
    updateAvatar(this.#cardAvatar, contact);
    this.#cardActive.hidden = !contact.online;
    for (const [el, text] of [[this.#cardName, contact.name], [this.#cardSnippet, contact.snippet], [this.#cardTime, contact.time]] as const) {
      if (el.textContent !== text) el.textContent = text;
      el.hidden = !text;
    }
    this.#setCardVisible(true, row.button);
    this.card.style.width = `${width}px`;
    const top = Math.max(GAP, Math.min(innerHeight - this.card.offsetHeight - GAP, rect.top));
    Object.assign(this.card.style, { left: `${rect.left - width - GAP}px`, top: `${top}px` });
  }

  showHidden(restoreFocus: () => void): void {
    this.#hiddenDialog = true;
    const title = h('h3', { id: 'action-title' }, t('hiddenPeopleTitle'));
    const done = h('button', { class: 'dialog-button', type: 'button', 'data-done': true, autofocus: true,
      onclick: () => this.closeDialog() }, t('done'));
    this.dialog.setAttribute('role', 'dialog');
    this.dialog.removeAttribute('aria-describedby');
    this.#openDialog(restoreFocus, done, title, h('div', { class: 'hidden-people' }), h('div', { class: 'dialog-actions' }, done));
    this.#renderHidden();
  }

  #renderHidden(): void {
    const byId = new Map(this.#contacts.filter((c) => !c.group).map((c) => [c.id, c]));
    const rows = this.#people.hidden.map((id) => {
      const name = byId.get(id)?.name ?? t('hiddenPersonId', id);
      return h('li', { class: 'hidden-person' }, h('span', {}, name), h('button', {
        class: 'dialog-button', type: 'button', 'aria-label': t('unhidePerson', name),
        onclick: () => this.actions.setPerson('hidden', id, false),
      }, t('unhide')));
    });
    this.dialog.querySelector('.hidden-people')?.replaceChildren(
      rows.length ? h('ul', {}, ...rows) : h('p', {}, t('noneHidden')),
    );
  }

  #confirmDelete(contact: Contact, anchor: HTMLButtonElement): void {
    const title = h('h3', { id: 'action-title' }, t('deleteTitle', contact.name));
    const body = h('p', { id: 'delete-description' }, t('deleteDescription'));
    const cancel = h('button', { class: 'dialog-button', type: 'button', autofocus: true, onclick: () => this.closeDialog() }, t('cancel'));
    const confirm = h('button', { class: 'dialog-button danger-button', type: 'button', onclick: (event) => {
      if (!event.isTrusted) return;
      this.closeDialog();
      this.actions.deleteConversation(contact);
    } }, t('deleteConversation'));
    this.dialog.setAttribute('role', 'alertdialog');
    this.dialog.setAttribute('aria-describedby', body.id);
    this.#openDialog(() => this.#focus(anchor), cancel, title, body, h('div', { class: 'dialog-actions' }, cancel, confirm));
  }

  #openDialog(restoreFocus: () => void, defaultButton: HTMLButtonElement, ...content: HTMLElement[]): void {
    this.hideCard();
    this.#restoreDialogFocus = restoreFocus;
    this.dialog.replaceChildren(...content);
    this.dialog.showModal();
    defaultButton.focus();
  }

  closeDialog(restoreFocus = true): void {
    if (!this.dialog.open) return;
    this.dialog.close();
    this.dialog.replaceChildren();
    this.#hiddenDialog = false;
    const restore = this.#restoreDialogFocus;
    this.#restoreDialogFocus = undefined;
    if (restoreFocus) restore?.();
  }

  #focus(anchor: HTMLButtonElement): void {
    if (anchor.isConnected && anchor.getClientRects().length) {
      anchor.focus({ preventScroll: true });
      // Returning from an overlay is not a new request to see the hover card.
      this.hideCard();
    } else this.actions.focusFallback();
  }
}
