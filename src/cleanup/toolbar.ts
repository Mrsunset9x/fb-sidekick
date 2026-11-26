/**
 * The bulk-action tool for one supported page, shown inside the hub's panel
 * (src/hub). The page adapter says how to read items and how to act on one;
 * the toolbar owns selection, the confirmation dialog and the run.
 *
 * Saved cards have extension checkboxes. Activity Log tools use Facebook's
 * own selection. The toolbar itself lives in the hub's shadow root.
 */
import css from './selection.css';
import { h, icon, t } from '../shared/dom';
import { extensionValue } from '../shared/runtime';
import { abortableSleep, dailyBudget, runBulk, type ActOutcome, type Progress, type StopReason } from './runner';

export interface BulkItem {
  key: string;
  title: string;
  box: HTMLElement;
}

interface NativeSelection<T> {
  checked(item: T): boolean;
  select(main: HTMLElement, keys: ReadonlySet<string>, signal: AbortSignal): Promise<ActOutcome>;
  blocks(target: Element): boolean;
  actBatch(items: readonly T[], signal: AbortSignal): Promise<ActOutcome>;
}

export type PageAdapter<T extends BulkItem> = {
  /** i18n keys */
  title: string;
  action: string;
  confirmTitle: string;
  confirmBody: string;
  read(main: HTMLElement): T[];
} & (
  | { act(item: T, signal: AbortSignal): Promise<ActOutcome>; native?: never }
  | { act?: never; native: NativeSelection<T> }
);

const MARK = 'data-fb-sidekick';
const LOAD_ROUNDS = 40;

const REASON_KEY: Record<StopReason, string> = {
  stopped: 'bulkStopped',
  blocked: 'bulkBlocked',
  unidentified: 'bulkUnidentified',
  unverified: 'bulkUnverified',
  'daily-limit': 'bulkDailyLimit',
};

export class Toolbar<T extends BulkItem> {
  readonly #root: ShadowRoot;
  readonly #onRunning: (running: boolean) => void;
  readonly #page: PageAdapter<T>;
  readonly #number = new Intl.NumberFormat(extensionValue(() => chrome.i18n.getUILanguage(), 'en'));
  readonly #lifetime = new AbortController();
  #main: HTMLElement | null = null;
  #items: T[] = [];
  readonly #selected = new Set<string>();
  readonly #checks = new Map<HTMLElement, { button: HTMLButtonElement; key: string }>();
  #anchor: string | null = null;
  #run: AbortController | null = null;
  #loading = false;
  #editing = false;
  #style: HTMLStyleElement | null = null;

  readonly #count = h('p', { class: 'count', 'aria-live': 'polite' });
  readonly #status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  readonly #selectAll = h('button', { class: 'button', type: 'button' }, t('bulkSelectAll'));
  readonly #clear = h('button', { class: 'button', type: 'button' }, t('bulkClear'));
  readonly #loadMore = h('button', { class: 'button', type: 'button' }, t('bulkLoadAll'));
  readonly #start = h('button', { class: 'button danger', type: 'button' });
  readonly #stop = h('button', { class: 'button', type: 'button', hidden: true }, t('bulkStop'));
  readonly el = h('section', { class: 'tool', 'aria-labelledby': 'tool-title' });
  readonly dialog = h('div', { class: 'dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'confirm-title', 'aria-describedby': 'confirm-body', hidden: true });

  constructor(page: PageAdapter<T>, root: ShadowRoot, onRunning: (running: boolean) => void) {
    this.#page = page;
    this.#root = root;
    this.#onRunning = onRunning;

    this.#selectAll.addEventListener('click', () => void this.#setSelected(true));
    this.#clear.addEventListener('click', () => void this.#setSelected(false));
    this.#loadMore.addEventListener('click', () => void this.#loadAll());
    this.#start.addEventListener('click', () => this.#confirm());
    this.#stop.addEventListener('click', () => this.#run?.abort());

    this.el.append(
      h('h3', { id: 'tool-title', class: 'section-title' }, t(page.title)),
      this.#count,
      h('div', { class: 'row' }, this.#selectAll, this.#clear, this.#loadMore),
      h('div', { class: 'row' }, this.#start, this.#stop),
      this.#status,
      h('p', { class: 'hint' }, t('bulkHint')),
    );
  }

  /** The hub has already placed `el` and `dialog` in its shadow root. */
  mount(main: HTMLElement | null): void {
    this.#style = h('style', { [MARK]: 'selection' }, css);
    document.head.append(this.#style);
    if (this.#page.native) {
      for (const type of ['click', 'keydown', 'keyup'] as const) {
        document.addEventListener(type, (event) => this.#guardNativeActivation(event),
          { capture: true, signal: this.#lifetime.signal });
      }
    }
    this.sync(main);
  }

  destroy(): void {
    this.#lifetime.abort();
    this.#run?.abort();
    this.#main?.classList.remove('fbsk-native-selection-locked');
    for (const [box, check] of this.#checks) this.#detach(box, check.button);
    this.#style?.remove();
    this.el.remove();
    this.dialog.remove();
    this.#onRunning(false);
  }

  /** Reads the page, re-attaches checkboxes and refreshes counts. Idempotent. */
  sync(main = this.#main): void {
    if (this.#lifetime.signal.aborted) return;
    if (this.#main !== main) this.#main?.classList.remove('fbsk-native-selection-locked');
    this.#main = main;
    this.#items = main?.isConnected ? this.#page.read(main) : [];
    const native = this.#page.native;
    if (native) {
      this.#selected.clear();
      for (const item of this.#items) if (native.checked(item)) this.#selected.add(item.key);
    } else {
      const cards = new Set(this.#items.map((item) => item.box));
      const keys = new Set(this.#items.map((item) => item.key));
      for (const [box, check] of this.#checks) if (!cards.has(box)) this.#detach(box, check.button);
      for (const key of this.#selected) if (!keys.has(key)) this.#selected.delete(key);
      for (const item of this.#items) this.#attach(item);
    }
    this.#render();
  }

  #render(): void {
    const busy = !!this.#run || this.#editing || this.#loading || !this.dialog.hidden;
    if (this.#page.native) this.#main?.classList.toggle('fbsk-native-selection-locked', !!this.#run);
    for (const [box, { button, key }] of this.#checks) {
      const checked = this.#selected.has(key);
      box.classList.toggle('fbsk-selection-active', checked);
      if (button.getAttribute('aria-checked') !== String(checked)) button.setAttribute('aria-checked', String(checked));
      button.disabled = !!this.#run || !this.dialog.hidden;
    }

    const selected = this.#selected.size;
    const count = t('bulkCount', this.#number.format(this.#items.length), this.#number.format(selected));
    if (this.#count.textContent !== count) this.#count.textContent = count;
    const action = t(this.#page.action, this.#number.format(selected));
    if (this.#start.textContent !== action) this.#start.textContent = action;
    this.#start.disabled = busy || selected === 0;
    this.#selectAll.disabled = busy || selected === this.#items.length;
    this.#clear.disabled = busy || !selected;
    this.#loadMore.disabled = busy;
    this.#stop.hidden = !this.#run;
  }

  #attach(item: T): void {
    const existing = this.#checks.get(item.box);
    const label = t('bulkSelectItem', item.title);
    if (existing?.button.parentElement === item.box && existing.key === item.key) {
      if (existing.button.getAttribute('aria-label') !== label) existing.button.setAttribute('aria-label', label);
      return;
    }
    existing?.button.remove();
    const check = h('button', {
      type: 'button', role: 'checkbox', class: 'fbsk-selection-check', [MARK]: 'check',
      'aria-label': label, 'aria-checked': 'false',
    }, h('span', { class: 'fbsk-selection-circle' }, icon(['M3.5 8l3 3 6-6'], 15)));
    check.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!check.disabled) this.#toggle(item.key, event.shiftKey);
    });
    for (const type of ['pointerdown', 'pointerup', 'dblclick', 'auxclick'] as const) {
      check.addEventListener(type, (event) => event.stopPropagation());
    }
    // Native button activation handles Space and Enter, including assistive technology.
    for (const type of ['keydown', 'keyup'] as const) {
      check.addEventListener(type, (event) => {
        if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
      });
    }
    item.box.classList.add('fbsk-selection-card');
    item.box.prepend(check);
    this.#checks.set(item.box, { button: check, key: item.key });
  }

  #detach(box: HTMLElement, check: HTMLButtonElement): void {
    check.remove();
    box.classList.remove('fbsk-selection-card', 'fbsk-selection-active');
    this.#checks.delete(box);
  }

  #toggle(key: string, shift: boolean): void {
    const last = shift ? this.#items.findIndex((item) => item.key === this.#anchor) : -1;
    const end = this.#items.findIndex((item) => item.key === key);
    if (end < 0) return;
    if (last >= 0) {
      for (const item of this.#items.slice(Math.min(last, end), Math.max(last, end) + 1)) this.#selected.add(item.key);
    } else if (this.#selected.has(key)) this.#selected.delete(key);
    else this.#selected.add(key);
    this.#anchor = key;
    this.#render();
  }

  #guardNativeActivation(event: MouseEvent | KeyboardEvent): void {
    if (!event.isTrusted || (!this.#run && !this.#editing && this.dialog.hidden)) return;
    if (event instanceof KeyboardEvent && event.key !== ' ' && event.key !== 'Enter') return;
    if (event.target instanceof Element && this.#page.native?.blocks(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  async #setSelected(all: boolean): Promise<void> {
    const keys = new Set(all ? this.#items.map((item) => item.key) : []);
    const native = this.#page.native;
    if (!native) {
      this.#selected.clear();
      for (const key of keys) this.#selected.add(key);
      this.#anchor = null;
      this.#render();
      return;
    }
    if (!this.#main || this.#editing || this.#run) return;
    this.#editing = true;
    this.#render();
    try {
      const outcome = await native.select(this.#main, keys, this.#lifetime.signal);
      this.#status.textContent = outcome === 'done' ? '' : t(REASON_KEY[outcome === 'skipped' ? 'unidentified' : outcome]);
    } catch {
      this.#status.textContent = t('bulkUnidentified');
    } finally {
      this.#editing = false;
      this.sync();
    }
  }

  /** Scrolls to the bottom until Facebook stops adding items. */
  async #loadAll(): Promise<void> {
    if (this.#loading || this.#run) return;
    this.#loading = true;
    this.#status.textContent = t('bulkLoading');
    this.#render();
    let last = -1;
    let still = 0;
    try {
      for (let round = 0; round < LOAD_ROUNDS && still < 3 && this.#main; round++) {
        const lastRow = this.#page.native ? this.#items.at(-1) : undefined;
        if (lastRow) lastRow.box.scrollIntoView({ block: 'end', behavior: 'instant' });
        else scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
        await abortableSleep(1_200, this.#lifetime.signal);
        this.sync();
        const count = this.#items.length;
        still = count === last ? still + 1 : 0;
        last = count;
      }
    } catch {
      // The tool was destroyed during navigation.
    }
    this.#loading = false;
    this.#status.textContent = '';
    this.sync();
  }

  #confirm(): void {
    this.sync();
    const queue = this.#items.filter((item) => this.#selected.has(item.key));
    const count = queue.length;
    if (!count || this.#run) return;
    const restore = this.#start;
    const listeners = new AbortController();
    const close = () => {
      listeners.abort();
      this.dialog.hidden = true;
      this.dialog.replaceChildren();
      this.#render();
      restore.focus();
    };
    const cancel = h('button', { class: 'button', type: 'button' }, t('cancel'));
    const go = h('button', { class: 'button danger', type: 'button' }, t(this.#page.action, this.#number.format(count)));
    cancel.addEventListener('click', close);
    go.addEventListener('click', () => {
      close();
      void this.#execute(queue);
    });
    this.dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      } else if (event.key === 'Tab') {
        // Keep focus inside the two buttons.
        event.preventDefault();
        (this.#root.activeElement === cancel ? go : cancel).focus();
      }
    }, { signal: AbortSignal.any([listeners.signal, this.#lifetime.signal]) });
    this.dialog.replaceChildren(h('div', { class: 'card' },
      h('h3', { id: 'confirm-title' }, t(this.#page.confirmTitle, this.#number.format(count))),
      h('p', { id: 'confirm-body' }, t(this.#page.confirmBody)),
      h('div', { class: 'row end' }, cancel, go),
    ));
    this.dialog.hidden = false;
    this.#render();
    cancel.focus(); // the destructive button is never the default
  }

  async #execute(queue: readonly T[]): Promise<void> {
    if (this.#run || this.#lifetime.signal.aborted) return;
    const run = new AbortController();
    this.#run = run;
    this.#onRunning(true);
    this.#render();
    const show = (p: Progress) => {
      const numbers = [p.done, p.total, p.skipped].map((n) => this.#number.format(n));
      if (p.state === 'running') this.#status.textContent = t('bulkProgress', ...numbers);
      else if (p.state === 'resting') this.#status.textContent = t('bulkResting', ...numbers);
      else if (p.state === 'finished') this.#status.textContent = t('bulkFinished', ...numbers);
      else this.#status.textContent = `${t('bulkProgress', ...numbers)} ${t(REASON_KEY[p.reason ?? 'stopped'])}`;
    };
    try {
      const deps = {
        budget: () => dailyBudget.remaining(),
        spend: dailyBudget.spend,
        withBudgetLock: dailyBudget.withLock,
        sleep: abortableSleep,
        random: Math.random,
        onProgress: show,
      };
      const page = this.#page;
      if (page.native) await runBulk(queue, run.signal, { ...deps, actBatch: page.native.actBatch });
      else await runBulk(queue, run.signal, {
        ...deps,
        act: async (item, signal) => {
          const outcome = await page.act(item, signal);
          if (outcome === 'done') this.#selected.delete(item.key);
          return outcome;
        },
      });
    } catch {
      this.#status.textContent = t('bulkUnidentified');
    } finally {
      this.#run = null;
      if (!this.#lifetime.signal.aborted) this.#onRunning(false);
      this.sync();
    }
  }
}
