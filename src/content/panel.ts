/**
 * The docked panel: a view only. It renders a `PanelState` and reports what
 * the user did through `PanelActions`; it never reads settings or measures
 * the page itself. The controller owns those decisions.
 *
 * Two views share one Messenger frame:
 *   contacts  the Contacts list, drawn by ContactList from the frame's data;
 *             the frame stays loaded underneath, invisible and inert.
 *   inbox     the frame itself, to read and reply inside the panel.
 */
import css from './panel.css';
import { h, icon, ICONS, t } from '../shared/dom';
import { FRAME_NAME, type Contact } from '../shared/protocol';
import type { View } from '../shared/settings';
import type { People } from '../shared/people';
import { ContactList } from './contact-list';
import { ContactActions } from './contact-actions';
import { menuItem, menuKeys } from './menu';
import { extensionValue } from '../shared/runtime';

export type FrameStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PanelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PanelState {
  box: PanelBox | null;
  view: View;
  collapsed: boolean;
  wide: boolean;
  inThread: boolean;
  onlineOnly: boolean;
  people: People;
}

export interface PanelActions {
  openContact(contact: Contact): void;
  setView(view: View): void;
  toggleCollapsed(): void;
  toggleWide(): void;
  back(): void;
  toggleOnlineOnly(): void;
  setPerson(key: keyof People, id: string, enabled: boolean): void;
  deleteConversation(contact: Contact): void;
}

/** Messenger inside a facebook.com frame: it may script itself, but never move the page. */
export const SANDBOX = [
  'allow-scripts',
  'allow-same-origin',
  'allow-forms',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-modals',
  'allow-downloads',
  'allow-storage-access-by-user-activation',
].join(' ');

const PERMISSIONS = 'autoplay; camera; microphone; display-capture; fullscreen; clipboard-write';
const LOAD_TIMEOUT_MS = 20_000;
const READY_GRACE_MS = 4_000;
const HEADER = 44;

export class Panel {
  readonly host = h('div', { 'data-contacts-rail': true, hidden: true });
  /** Closed in releases; open in dev builds so the panel can be inspected from DevTools. */
  readonly #root = this.host.attachShadow({ mode: __DEV__ ? 'open' : 'closed' });
  readonly #actions: PanelActions;
  readonly #list: ContactList;
  readonly #overlays: ContactActions;
  readonly #events = new AbortController();
  readonly #number = new Intl.NumberFormat(extensionValue(() => chrome.i18n.getUILanguage(), 'en'));
  #frame: HTMLIFrameElement | null = null;
  #timeout = 0;
  #state: PanelState | null = null;
  #contacts: readonly Contact[] = [];

  readonly #title = h('h2', { class: 'title', id: 'title', 'aria-live': 'polite', 'aria-atomic': 'true' });
  readonly #back = this.#button('back', ICONS.back, () => this.#actions.back());
  readonly #search = this.#button('search', ICONS.search, () => this.#toggleSearch());
  readonly #wide = this.#button('widen', ICONS.widen, () => this.#actions.toggleWide());
  readonly #more = this.#button('more', ICONS.more, () => this.#toggleMenu());
  readonly #fold = this.#button('expand', ICONS.unfold, () => this.#actions.toggleCollapsed());
  readonly #field = h('input', {
    class: 'field', type: 'search', placeholder: t('searchPlaceholder'), 'aria-label': t('searchPlaceholder'),
    autocomplete: 'off', spellcheck: 'false',
  });
  readonly #searchRow = h('div', { class: 'search', hidden: true }, icon(ICONS.search), this.#field);
  readonly #menu = h('div', { class: 'menu', id: 'header-menu', role: 'menu', 'aria-label': t('more'), hidden: true });
  readonly #notice = h('div', { class: 'notice', role: 'status', 'aria-live': 'polite' });
  readonly #body = h('div', { class: 'body' });

  constructor(actions: PanelActions) {
    this.#actions = actions;
    this.#list = new ContactList({
      open: actions.openContact,
      showMenu: (row, anchor) => this.#overlays.showMenu(row, anchor),
      showCard: (row, delay) => {
        if (this.#menu.hidden) this.#overlays.showCard(row, delay);
      },
      hideCard: (row) => this.#overlays.hideCard(row),
      focusFallback: () => this.#more.focus(),
    });
    this.#overlays = new ContactActions({
      setPerson: actions.setPerson,
      deleteConversation: actions.deleteConversation,
      focusFallback: () => this.#more.focus(),
      closeHeaderMenu: () => this.#toggleMenu(false),
    }, this.#list.el);

    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    this.#root.adoptedStyleSheets = [sheet];

    this.#title.addEventListener('click', () => {
      if (this.#state?.collapsed) this.#actions.toggleCollapsed();
      else if (this.#state?.view === 'inbox') this.#actions.back();
    });
    this.#field.addEventListener('input', () => {
      this.#list.query = this.#field.value;
      this.#overlays.position();
    });
    this.#field.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        this.#toggleSearch(false);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.#list.focusFirst();
      }
    });
    this.#more.setAttribute('aria-haspopup', 'menu');
    this.#more.setAttribute('aria-controls', this.#menu.id);
    this.#more.setAttribute('aria-expanded', 'false');
    this.#more.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.#toggleMenu(true);
        if (e.key === 'ArrowUp') [...this.#menu.querySelectorAll('button')].at(-1)?.focus();
      }
    });
    menuKeys(this.#menu, (restore) => this.#toggleMenu(false, restore));
    const { signal } = this.#events;
    document.addEventListener('pointerdown', (e) => {
      if (e.composedPath().includes(this.host)) return;
      this.#toggleMenu(false);
      this.#overlays.closeMenu();
      this.#overlays.hideCard();
    }, { signal });
    this.#root.addEventListener('pointerdown', (event) => {
      const path = event.composedPath();
      if (!path.includes(this.#menu) && !path.includes(this.#more)) this.#toggleMenu(false);
      if (!path.includes(this.#overlays.menu) && !path.some((el) => el instanceof Element && el.matches('.row-more'))) {
        this.#overlays.closeMenu();
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.#overlays.hideCard();
    }, { signal });
    window.addEventListener('resize', () => this.#overlays.position(), { signal });

    const skeleton = h('div', { class: 'skeleton', 'aria-hidden': 'true' },
      ...['62%', '48%', '56%', '40%', '52%', '58%', '44%', '50%'].map((w) =>
        h('div', { class: 'ghost', style: `--w:${w}` }),
      ),
    );
    const error = h('div', { class: 'error', role: 'status' },
      h('p', {}, t('loadFailed')),
      h('p', { class: 'hint' }, t('loadFailedHint')),
      h('button', { class: 'text-button', type: 'button', onclick: () => this.reload() }, t('retry')),
    );
    this.#body.append(this.#list.el, skeleton, error);

    this.#root.append(
      h('section', { class: 'panel', 'aria-labelledby': 'title' },
        h('header', { class: 'bar' }, this.#back, this.#title, this.#search, this.#wide, this.#more, this.#fold),
        this.#menu,
        this.#searchRow,
        this.#notice,
        this.#body,
        this.#overlays.menu,
        this.#overlays.card,
        this.#overlays.dialog,
      ),
    );
    this.#setStatus('idle');
  }

  get frame(): HTMLIFrameElement | null {
    return this.#frame;
  }

  /** Where helper frames (the ranker) live: inside the panel, invisible and inert. */
  get stage(): HTMLElement {
    return this.#body;
  }

  set contacts(next: readonly Contact[]) {
    this.#contacts = next;
    this.#list.contacts = next;
    if (this.#state) this.#overlays.update(this.#contacts, this.#state.people);
    this.#updateTitle();
    this.markReady();
  }

  status(message: string, href?: string): void {
    const link = href ? h('a', { href: `${location.origin}${href}`, target: '_blank', rel: 'noopener' }, t('openChatInMessenger')) : null;
    if (link) this.#notice.replaceChildren(message, ' ', link);
    else this.#notice.textContent = message;
  }

  set deleting(pending: boolean) {
    this.#overlays.deleting = pending;
  }

  render(state: PanelState): void {
    if (this.#state?.view !== state.view) this.#toggleMenu(false);
    this.#state = state;
    const { box, view, collapsed, wide, inThread, people, onlineOnly } = state;
    this.host.hidden = !box;
    this.#list.configure(people, onlineOnly);
    this.#updateTitle();
    if (!box || collapsed || view === 'inbox') {
      this.#overlays.closeMenu();
      this.#overlays.hideCard();
      this.#overlays.closeDialog(false);
    }
    if (!box || collapsed) this.#toggleMenu(false);
    if (!box) return;

    const inbox = view === 'inbox';
    Object.assign(this.host.style, {
      left: `${box.left}px`,
      top: `${box.top}px`,
      width: `${box.width}px`,
      height: collapsed ? `${HEADER}px` : `${box.height}px`,
    });
    this.host.dataset.view = view;
    this.host.toggleAttribute('data-collapsed', collapsed);
    this.host.toggleAttribute('data-wide', inbox && wide && !collapsed);

    this.#back.hidden = collapsed || !inbox;
    this.#back.title = t(inThread ? 'back' : 'showContacts');
    this.#back.setAttribute('aria-label', this.#back.title);
    this.#search.hidden = collapsed || inbox;
    this.#wide.hidden = collapsed || !inbox;
    this.#more.hidden = collapsed;
    this.#fold.hidden = !collapsed;
    this.#swapIcon(this.#wide, wide ? ICONS.narrow : ICONS.widen, wide ? 'narrow' : 'widen');
    if (collapsed || inbox) this.#toggleSearch(false);

    if (this.#frame) {
      // Invisible and out of the tab order in the contacts view; the panel itself in the inbox view.
      this.#frame.inert = !inbox;
      this.#frame.tabIndex = inbox ? 0 : -1;
      this.#frame.toggleAttribute('aria-hidden', !inbox);
    }
    if (!collapsed && !this.#frame) this.#createFrame();
    this.#overlays.update(this.#contacts, people);
  }

  #updateTitle(): void {
    const title = this.#state?.view === 'inbox' ? t(this.#state.inThread ? 'chats' : 'contacts')
      : t('contactsCount', this.#number.format(this.#list.onlineCount));
    if (this.#title.textContent !== title) this.#title.textContent = title;
  }

  reload(): void {
    if (!this.#frame) return this.#createFrame();
    this.#setStatus('loading');
    this.#armTimeout();
    this.#frame.src = `${location.origin}/messages/`;
  }

  /** The frame proves it is alive by talking (see frame/main.ts). */
  markReady(): void {
    if (this.host.dataset.status === 'ready') return;
    clearTimeout(this.#timeout);
    this.#setStatus('ready');
  }

  destroy(): void {
    clearTimeout(this.#timeout);
    this.#events.abort();
    this.#overlays.closeDialog(false);
    this.#overlays.hideCard();
    this.host.remove();
  }

  #createFrame(): void {
    const frame = h('iframe', {
      name: FRAME_NAME,
      title: t('frameTitle'),
      sandbox: SANDBOX,
      allow: PERMISSIONS,
      referrerpolicy: 'same-origin',
    });
    // The page cannot look inside the frame (Messenger relaxes its document.domain),
    // and a blocked frame fires `load` too: silence after load means it failed.
    frame.addEventListener('load', () => {
      if (this.host.dataset.status !== 'loading') return;
      clearTimeout(this.#timeout);
      this.#timeout = window.setTimeout(() => this.#setStatus('error'), READY_GRACE_MS);
    });
    this.#frame = frame;
    this.#setStatus('loading');
    this.#armTimeout();
    frame.src = `${location.origin}/messages/`;
    this.#body.append(frame);
    if (this.#state) this.render(this.#state);
  }

  #armTimeout(): void {
    clearTimeout(this.#timeout);
    this.#timeout = window.setTimeout(() => this.#setStatus('error'), LOAD_TIMEOUT_MS);
  }

  #setStatus(status: FrameStatus): void {
    this.host.dataset.status = status;
  }

  #toggleSearch(open = this.#searchRow.hidden): void {
    if (this.#searchRow.hidden === !open) return;
    this.#searchRow.hidden = !open;
    this.#search.setAttribute('aria-expanded', String(open));
    if (open) this.#field.focus();
    else if (this.#field.value) {
      this.#field.value = '';
      this.#list.query = '';
    }
  }

  #toggleMenu(open = this.#menu.hidden, restore = false): void {
    this.#menu.hidden = !open;
    this.#more.setAttribute('aria-expanded', String(open));
    if (!open) {
      if (restore) this.#more.focus();
      return;
    }
    this.#overlays.closeMenu();
    this.#overlays.hideCard();
    const inbox = this.#state?.view === 'inbox';
    const item = (label: string, run: () => void, checked?: boolean) =>
      menuItem(label, () => {
        this.#toggleMenu(false, true);
        run();
      }, checked === undefined ? undefined : checked ? ICONS.checked : ICONS.unchecked, checked);
    const hidden = this.#state?.people.hidden.length ?? 0;
    this.#menu.replaceChildren(
      item(t(inbox ? 'showContacts' : 'showInbox'), () => this.#actions.setView(inbox ? 'contacts' : 'inbox')),
      ...(inbox ? [] : [
        item(t('onlyActive'), () => this.#actions.toggleOnlineOnly(), this.#state?.onlineOnly ?? false),
        item(t('showHidden', this.#number.format(hidden)), () => this.#overlays.showHidden(() => this.#more.focus())),
      ]),
      item(t('reload'), () => this.reload()),
      item(t('openMessenger'), () => window.open(`${location.origin}/messages/`, '_blank', 'noopener')),
      item(t('collapse'), () => this.#actions.toggleCollapsed()),
    );
    this.#menu.querySelector<HTMLButtonElement>('.menu-item')?.focus();
  }

  #button(label: string, paths: readonly string[], onClick: () => void): HTMLButtonElement {
    const button = h('button', { class: 'icon-button', type: 'button', title: t(label), 'aria-label': t(label) }, icon(paths));
    button.addEventListener('click', onClick);
    return button;
  }

  #swapIcon(button: HTMLButtonElement, paths: readonly string[], label: string): void {
    if (button.dataset.icon === label) return;
    button.dataset.icon = label;
    button.replaceChildren(icon(paths));
    button.title = t(label);
    button.setAttribute('aria-label', t(label));
  }
}
