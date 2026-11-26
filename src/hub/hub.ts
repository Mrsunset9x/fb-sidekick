/**
 * The floating "FB Sidekick" button and its panel: quick settings and the
 * tools. One place on every Facebook page to switch features on and off,
 * without opening the extension popup.
 *
 * The bulk tool of the current page (src/cleanup) is shown inside the panel;
 * on other pages the panel links to the pages where tools work.
 */
import css from './hub.css';
import { h, t } from '../shared/dom';
import type { Settings } from '../shared/settings';
import type { Toolbar, BulkItem } from '../cleanup/toolbar';
import type { ActivityCategory } from './activity-navigation';

type Switch = 'enabled' | 'onlineOnly' | 'pauseHidden';
type Tool = Pick<Toolbar<BulkItem>, 'el' | 'dialog' | 'mount' | 'destroy' | 'sync'>;

export interface HubActions {
  set(patch: Partial<Settings>): void;
  openActivity(category: ActivityCategory): void;
}

const SLIDERS = [
  'M2.5 4.5h6', 'M11.5 4.5h2', 'M10 3v3', 'M2.5 11.5h2', 'M7.5 11.5h6', 'M6 10v3',
];

function sliders(): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({ width: 22, height: 22, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', 'aria-hidden': 'true' })) {
    svg.setAttribute(k, String(v));
  }
  for (const d of SLIDERS) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export class Hub {
  readonly host = h('div', { 'data-fb-sidekick': 'hub' });
  readonly root = this.host.attachShadow({ mode: __DEV__ ? 'open' : 'closed' });
  readonly #actions: HubActions;
  readonly #events = new AbortController();
  readonly #launcher = h('button', { class: 'launcher', type: 'button', 'aria-expanded': 'false',
    'aria-controls': 'hub-panel', title: t('hubTitle'), 'aria-label': t('hubTitle') }, sliders(), h('span', { class: 'dot', hidden: true }));
  readonly #panel = h('div', { class: 'panel', id: 'hub-panel', role: 'dialog', 'aria-labelledby': 'hub-title', hidden: true });
  readonly #switches = new Map<Switch, HTMLInputElement>();
  readonly #toolSlot = h('div', { class: 'tool-slot' });
  readonly #links = h('div', { class: 'links' });
  readonly #reactions = h('button', { class: 'link', type: 'button' }, t('bulkReactionsTitle'));
  readonly #comments = h('button', { class: 'link', type: 'button' }, t('bulkCommentsTitle'));
  readonly #activityHint = h('p', { class: 'activity-hint', role: 'status', hidden: true });
  #tool: Tool | null = null;

  constructor(actions: HubActions) {
    this.#actions = actions;
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    this.root.adoptedStyleSheets = [sheet];

    const close = h('button', { class: 'close', type: 'button', title: t('hubClose'), 'aria-label': t('hubClose') }, '×');
    close.addEventListener('click', () => this.toggle(false, true));
    this.#launcher.addEventListener('click', () => this.toggle());
    this.#reactions.addEventListener('click', () => this.#actions.openActivity('reactions'));
    this.#comments.addEventListener('click', () => this.#actions.openActivity('comments'));

    this.#links.append(
      this.#link(t('bulkSavedTitle'), '/saved/'),
      this.#reactions,
      this.#comments,
      this.#soon(t('hubUnfollow')),
      this.#activityHint,
    );
    this.#panel.append(
      h('header', {}, h('h2', { id: 'hub-title' }, t('hubTitle')), close),
      h('h3', { class: 'section-title' }, t('hubQuick')),
      this.#switch('enabled', t('showPanel')),
      this.#switch('onlineOnly', t('onlyActive')),
      this.#switch('pauseHidden', t('pauseHidden')),
      h('h3', { class: 'section-title' }, t('hubTools')),
      this.#toolSlot,
      this.#links,
    );
    this.root.append(this.#panel, this.#launcher);

    const { signal } = this.#events;
    document.addEventListener('pointerdown', (event) => {
      // On a tool page the user ticks items on the page itself: the panel stays open.
      if (!this.#tool && !event.composedPath().includes(this.host)) this.toggle(false);
    }, { signal });
    this.root.addEventListener('keydown', (event) => {
      const e = event as KeyboardEvent;
      if (e.key === 'Escape' && !this.#panel.hidden && (this.#tool?.dialog.hidden ?? true)) {
        e.stopPropagation();
        this.toggle(false, true);
      }
    });
  }

  mount(): void {
    document.body.append(this.host);
  }

  destroy(): void {
    this.#events.abort();
    this.setTool(null);
    this.host.remove();
  }

  render(settings: Settings): void {
    for (const [key, input] of this.#switches) input.checked = settings[key];
    // The contacts-only switches mean nothing while the contacts panel is off.
    this.#switches.get('onlineOnly')!.disabled = !settings.enabled;
    this.#switches.get('pauseHidden')!.disabled = !settings.enabled;
  }

  toggle(open = this.#panel.hidden, restoreFocus = false): void {
    if (this.#panel.hidden === !open) return;
    this.#panel.hidden = !open;
    this.#launcher.setAttribute('aria-expanded', String(open));
    if (open) this.#panel.querySelector<HTMLElement>('button, input')?.focus();
    else if (restoreFocus) this.#launcher.focus();
  }

  /** Shows the current page's bulk tool in the panel, or the links to tool pages when null. */
  setTool(tool: Tool | null, main: HTMLElement | null = null): void {
    if (this.#tool === tool) return;
    this.#tool?.destroy();
    this.#tool = tool;
    this.#links.hidden = !!tool;
    if (!tool) return;
    this.#toolSlot.append(tool.el);
    this.root.append(tool.dialog);
    tool.mount(main);
    this.toggle(true);
  }

  syncTool(main: HTMLElement | null): void {
    this.#tool?.sync(main);
  }

  showActivityLinks(onActivity: boolean): void {
    this.#reactions.textContent = t(onActivity ? 'hubOpenReactions' : 'bulkReactionsTitle');
    this.#comments.textContent = t(onActivity ? 'hubOpenComments' : 'bulkCommentsTitle');
    if (!onActivity) this.showActivityHint(null);
  }

  showActivityHint(category: ActivityCategory | null): void {
    this.#activityHint.hidden = !category;
    if (!category) return;
    this.#activityHint.textContent = t(category === 'reactions' ? 'hubReactionsHint' : 'hubCommentsHint');
    this.toggle(true);
  }

  /** A dot on the button while a bulk run goes on with the panel closed. */
  setRunning(running: boolean): void {
    this.#launcher.querySelector<HTMLElement>('.dot')!.hidden = !running;
  }

  #switch(key: Switch, label: string): HTMLElement {
    const id = `hub-${key}`;
    const input = h('input', { type: 'checkbox', class: 'switch', role: 'switch', id });
    input.addEventListener('change', () => this.#actions.set({ [key]: input.checked }));
    this.#switches.set(key, input);
    return h('div', { class: 'row' }, h('label', { for: id }, label), input);
  }

  #link(label: string, path: string): HTMLElement {
    const button = h('button', { class: 'link', type: 'button' }, label);
    button.addEventListener('click', () => location.assign(path));
    return button;
  }

  #soon(label: string): HTMLElement {
    return h('button', { class: 'link', type: 'button', disabled: true }, label, h('span', { class: 'soon' }, t('hubSoon')));
  }
}
