/**
 * The bulk-action tool for one supported page, shown inside the hub's panel
 * (src/hub). The page adapter says how to read items and how to act on one;
 * the toolbar owns selection, the confirmation dialog and the run.
 *
 * Selection checkboxes are injected into Facebook's item cards (light DOM,
 * inline styles, tagged with data-fb-sidekick) and re-attached when Facebook
 * re-renders. The toolbar itself lives in the hub's shadow root.
 */
import { h, t } from '../shared/dom';
import { extensionValue } from '../shared/runtime';
import { abortableSleep, dailyBudget, runBulk, type ActOutcome, type Progress, type StopReason } from './runner';

export interface BulkItem {
  key: string;
  title: string;
  box: HTMLElement;
}

export interface PageAdapter<T extends BulkItem> {
  /** i18n keys */
  title: string;
  action: string;
  confirmTitle: string;
  confirmBody: string;
  read(): T[];
  act(item: T, signal: AbortSignal): Promise<ActOutcome>;
}

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
  #items: T[] = [];
  readonly #selected = new Set<string>();
  #run: AbortController | null = null;
  #loading = false;
  #timer = 0;
  #observer = new MutationObserver(() => this.#schedule());

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

    this.#selectAll.addEventListener('click', () => {
      for (const item of this.#items) this.#selected.add(item.key);
      this.#sync();
    });
    this.#clear.addEventListener('click', () => {
      this.#selected.clear();
      this.#sync();
    });
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

  get running(): boolean {
    return !!this.#run;
  }

  /** Starts watching the page. The hub has already placed `el` and `dialog`. */
  mount(): void {
    this.#observer.observe(document.body, { childList: true, subtree: true });
    this.#sync();
  }

  destroy(): void {
    this.#run?.abort();
    this.#observer.disconnect();
    clearTimeout(this.#timer);
    for (const el of document.querySelectorAll(`[${MARK}="check"]`)) el.remove();
    this.el.remove();
    this.dialog.remove();
    this.#onRunning(false);
  }

  #schedule(): void {
    if (!this.#timer) this.#timer = window.setTimeout(() => {
      this.#timer = 0;
      this.#sync();
    }, 300);
  }

  /** Reads the page, re-attaches checkboxes and refreshes counts. Idempotent. */
  #sync(): void {
    this.#items = this.#page.read();
    const keys = new Set(this.#items.map((item) => item.key));
    // Selections of items that left the page (unsaved elsewhere, list re-rendered) are dropped.
    for (const key of this.#selected) if (!keys.has(key)) this.#selected.delete(key);
    for (const item of this.#items) this.#attach(item);
    const running = !!this.#run;
    const selected = this.#selected.size;
    this.#count.textContent = t('bulkCount', this.#number.format(this.#items.length), this.#number.format(selected));
    this.#start.textContent = t(this.#page.action, this.#number.format(selected));
    this.#start.disabled = running || selected === 0;
    for (const b of [this.#selectAll, this.#clear, this.#loadMore]) b.disabled = running || this.#loading;
    this.#stop.hidden = !running;
    this.#onRunning(running);
  }

  #attach(item: T): void {
    let check = item.box.querySelector<HTMLInputElement>(`:scope > [${MARK}="check"] input`);
    if (!check) {
      const wrapper = h('label', { [MARK]: 'check', title: t('bulkSelectOne') });
      wrapper.style.cssText = 'position:absolute;top:8px;left:8px;z-index:3;display:flex;padding:4px;' +
        'border-radius:6px;background:var(--surface-background,#fff);box-shadow:0 1px 2px rgba(0,0,0,.2);cursor:pointer';
      check = h('input', { type: 'checkbox', 'aria-label': t('bulkSelectItem', item.title) });
      check.style.cssText = 'width:18px;height:18px;margin:0;cursor:pointer;accent-color:var(--primary-button-background,#0866ff)';
      check.addEventListener('change', () => {
        if (check!.checked) this.#selected.add(item.key);
        else this.#selected.delete(item.key);
        this.#sync();
      });
      // Stop Facebook's card from treating the click as a click on the post.
      wrapper.addEventListener('click', (event) => event.stopPropagation());
      wrapper.append(check);
      if (getComputedStyle(item.box).position === 'static') item.box.style.position = 'relative';
      item.box.prepend(wrapper);
    }
    check.checked = this.#selected.has(item.key);
    check.disabled = !!this.#run;
  }

  /** Scrolls to the bottom until Facebook stops adding items. */
  async #loadAll(): Promise<void> {
    if (this.#loading || this.#run) return;
    this.#loading = true;
    this.#status.textContent = t('bulkLoading');
    this.#sync();
    let last = -1;
    let still = 0;
    for (let round = 0; round < LOAD_ROUNDS && still < 3; round++) {
      scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 1_200));
      const count = this.#page.read().length;
      still = count === last ? still + 1 : 0;
      last = count;
    }
    this.#loading = false;
    this.#status.textContent = '';
    this.#sync();
  }

  #confirm(): void {
    const count = this.#selected.size;
    if (!count || this.#run) return;
    const restore = this.#start;
    const listeners = new AbortController();
    const close = () => {
      listeners.abort();
      this.dialog.hidden = true;
      this.dialog.replaceChildren();
      restore.focus();
    };
    const cancel = h('button', { class: 'button', type: 'button' }, t('cancel'));
    const go = h('button', { class: 'button danger', type: 'button' }, t(this.#page.action, this.#number.format(count)));
    cancel.addEventListener('click', close);
    go.addEventListener('click', () => {
      close();
      void this.#execute();
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
    }, { signal: listeners.signal });
    this.dialog.replaceChildren(h('div', { class: 'card' },
      h('h3', { id: 'confirm-title' }, t(this.#page.confirmTitle, this.#number.format(count))),
      h('p', { id: 'confirm-body' }, t(this.#page.confirmBody)),
      h('div', { class: 'row end' }, cancel, go),
    ));
    this.dialog.hidden = false;
    cancel.focus(); // the destructive button is never the default
  }

  async #execute(): Promise<void> {
    const queue = this.#items.filter((item) => this.#selected.has(item.key));
    if (!queue.length) return;
    const run = new AbortController();
    this.#run = run;
    this.#sync();
    const show = (p: Progress) => {
      const numbers = [p.done, p.total, p.skipped].map((n) => this.#number.format(n));
      if (p.state === 'running') this.#status.textContent = t('bulkProgress', ...numbers);
      else if (p.state === 'resting') this.#status.textContent = t('bulkResting', ...numbers);
      else if (p.state === 'finished') this.#status.textContent = t('bulkFinished', ...numbers);
      else this.#status.textContent = `${t('bulkProgress', ...numbers)} ${t(REASON_KEY[p.reason ?? 'stopped'])}`;
    };
    try {
      await runBulk(queue, run.signal, {
        act: async (item, signal) => {
          const outcome = await this.#page.act(item, signal);
          if (outcome === 'done') this.#selected.delete(item.key);
          return outcome;
        },
        budget: () => dailyBudget.remaining(),
        spend: (n) => dailyBudget.spend(n),
        sleep: abortableSleep,
        random: Math.random,
        onProgress: show,
      });
    } catch {
      this.#status.textContent = t('bulkUnidentified');
    } finally {
      this.#run = null;
      this.#sync();
    }
  }
}
