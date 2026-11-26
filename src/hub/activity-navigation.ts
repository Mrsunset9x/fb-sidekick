import { activityCategory, isActivityPath, readActivityCategory } from '../cleanup/activity';
import { MAIN_SELECTOR, normalize, visible, waitFor } from '../cleanup/dom';
import { extensionCall, extensionTask } from '../shared/runtime';

export type ActivityCategory = 'reactions' | 'comments';
type Expansion = 'activity-group' | 'comments-group';
type NavLabel = ActivityCategory | Expansion;
type Stage = 'start' | Expansion | 'arriving';

const CATEGORIES = ['reactions', 'comments'] as const;
const GROUP_LABELS = {
  'activity-group': ['hoạt động của bạn trên facebook', 'your activity across facebook', 'your activity on facebook'],
  'comments-group': ['bình luận và cảm xúc', 'comments and reactions'],
} satisfies Record<Expansion, readonly string[]>;
const NAV = '[role="navigation"]';
const NAV_LINK = `${NAV} a[href]`;
const NAV_BUTTON = `${NAV} div[role="button"]`;
const OVERVIEW = '/me/allactivity/';
const INTENT_KEY = 'fbsk-activity-navigation';
const STEP_MS = 6_000;

export function matchesActivityNavLabel(step: NavLabel, label: string): boolean {
  return step === 'activity-group' || step === 'comments-group'
    ? GROUP_LABELS[step].includes(normalize(label))
    : activityCategory([label]) === step;
}

export function validateActivityHref(value: unknown, origin: string): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, origin);
    const keys = url.searchParams.getAll('category_key');
    if (url.origin !== origin || url.username || url.password || !isActivityPath(url.pathname) ||
      keys.length !== 1 || !keys[0]?.trim()) return null;
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

interface Link {
  anchor: HTMLAnchorElement;
  href: string;
}

function categoryLinks(category: ActivityCategory): Link[] {
  const links: Link[] = [];
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(NAV_LINK)) {
    if (!matchesActivityNavLabel(category, anchor.textContent ?? '')) continue;
    const href = validateActivityHref(anchor.href, location.origin);
    if (href) links.push({ anchor, href });
  }
  return links;
}

function groupButtons(step: Expansion): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(NAV_BUTTON)].filter((button) => {
    const text = normalize(button.textContent ?? '');
    if (!visible(button)) return false;
    if (matchesActivityNavLabel(step, text) || matchesActivityNavLabel(step, button.getAttribute('aria-label') ?? '')) return true;
    if (step !== 'activity-group') return false;
    // This button puts a short description after the title. Match the exact
    // title from its own node, at the start of the control's text.
    return [...button.childNodes, ...button.querySelectorAll('span, div')].some((node) => {
      const title = normalize(node.textContent ?? '');
      return matchesActivityNavLabel(step, title) && text.startsWith(title);
    });
  });
}

const cacheKey = (category: ActivityCategory) => `fbskActivityHref:${location.origin}:${category}`;

interface Intent {
  category: ActivityCategory;
  stage: Stage;
  deadline: number;
}

function saveIntent(category: ActivityCategory, stage: Stage, duration = STEP_MS): Intent {
  const intent: Intent = { category, stage, deadline: Date.now() + duration };
  try { sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent)); } catch { /* In-page navigation can still continue. */ }
  return intent;
}

function clearIntent(): void {
  try { sessionStorage.removeItem(INTENT_KEY); } catch { /* Storage may be unavailable. */ }
}

function readIntent(): Intent | null {
  try {
    const intent = JSON.parse(sessionStorage.getItem(INTENT_KEY) ?? 'null') as Partial<Intent> | null;
    if (intent && CATEGORIES.some((category) => category === intent.category) &&
      (intent.stage === 'start' || intent.stage === 'activity-group' || intent.stage === 'comments-group' ||
        intent.stage === 'arriving') && typeof intent.deadline === 'number' &&
      intent.deadline <= Date.now() + STEP_MS * 2) return intent as Intent;
  } catch {
    // A missing or malformed intent cannot trigger navigation.
  }
  return null;
}

type NextAction =
  | 'arrived' | 'ambiguous'
  | { stage: Expansion; button: HTMLElement }
  | { stage: 'arriving'; link: Link };

function nextAction({ category, stage }: Intent): NextAction | null {
  if (!isActivityPath(location.pathname)) return null;
  const main = document.querySelector<HTMLElement>(MAIN_SELECTOR);
  if (main && readActivityCategory(main) === category) return 'arrived';
  if (stage === 'arriving') return null;

  const links = categoryLinks(category).filter(({ anchor }) => visible(anchor));
  if (links.length > 1) return 'ambiguous';
  if (links[0]) return { stage: 'arriving', link: links[0] };
  if (stage === 'comments-group') return null;

  const group = groupButtons('comments-group');
  if (group.length > 1) return 'ambiguous';
  if (group[0]) return expandable(group[0]) ? { stage: 'comments-group', button: group[0] } : null;
  if (stage === 'activity-group') return null;

  const activity = groupButtons('activity-group');
  if (activity.length > 1) return 'ambiguous';
  return activity[0] && expandable(activity[0]) ? { stage: 'activity-group', button: activity[0] } : null;
}

const expandable = (button: HTMLElement) =>
  !button.matches('[aria-expanded="true"], [aria-disabled="true"]');

function navigate(href: string, anchor?: HTMLAnchorElement): void {
  if (location.pathname + location.search === href) return;
  if (anchor && (!anchor.target || anchor.target.toLowerCase() === '_self') && !anchor.hasAttribute('download')) anchor.click();
  else location.assign(href);
}

function touchesNav(record: MutationRecord): boolean {
  const target = record.target instanceof Element ? record.target : record.target.parentElement;
  return !!target?.closest(NAV) || [...record.addedNodes].some((node) =>
    node instanceof Element && (node.matches(NAV) || node.querySelector(NAV)));
}

/** Owns per-tab navigation intent and caches the category URLs exposed by Facebook. */
export class ActivityNavigation {
  readonly #showHint: (category: ActivityCategory | null) => void;
  readonly #seen = new Map<string, string>();
  readonly #observer = new MutationObserver((records) => {
    if (records.some(touchesNav)) this.#rememberLinks();
  });
  #onActivity = false;
  #run: AbortController | null = null;

  constructor(showHint: (category: ActivityCategory | null) => void) {
    this.#showHint = showHint;
  }

  route(onActivity: boolean): void {
    if (!onActivity) {
      if (this.#onActivity) this.stop();
      return;
    }
    if (!this.#onActivity) {
      this.#onActivity = true;
      this.#observer.observe(document.body, {
        childList: true, subtree: true, characterData: true, attributeFilter: ['href', 'role'],
      });
    }
    this.#rememberLinks();
    if (this.#run) return;
    const intent = readIntent();
    if (intent) this.#start(intent.category, (signal) => this.#follow(intent, signal));
  }

  open(category: ActivityCategory): void {
    this.#start(category, async (signal) => {
      const key = cacheKey(category);
      const stored = await extensionCall(() => chrome.storage.local.get(key)).catch(() => undefined);
      if (signal.aborted) return false;
      const cached = validateActivityHref(stored?.[key], location.origin);
      const known = categoryLinks(category).filter(({ anchor }) => visible(anchor));
      if (known.length > 1 && !cached) return false;
      const link = known.length === 1 ? known[0] : undefined;
      const href = link?.href ?? cached;
      if (href) {
        const intent = saveIntent(category, 'arriving', STEP_MS * 2);
        navigate(href, link?.anchor);
        return this.#follow(intent, signal);
      }
      const intent = saveIntent(category, 'start', STEP_MS * 2);
      if (!isActivityPath(location.pathname)) location.assign(OVERVIEW);
      return this.#follow(intent, signal);
    });
  }

  stop(): void {
    this.#run?.abort();
    this.#run = null;
    this.#observer.disconnect();
    this.#onActivity = false;
    clearIntent();
  }

  #rememberLinks(): void {
    const updates: Record<string, string> = {};
    for (const category of CATEGORIES) {
      const values = new Set(categoryLinks(category).map(({ href }) => href));
      if (values.size !== 1) continue;
      const [href] = values;
      const key = cacheKey(category);
      if (!href || this.#seen.get(key) === href) continue;
      this.#seen.set(key, href);
      updates[key] = href;
    }
    if (Object.keys(updates).length) extensionTask(() => chrome.storage.local.set(updates));
  }

  #start(category: ActivityCategory, run: (signal: AbortSignal) => Promise<boolean>): void {
    this.#run?.abort();
    const controller = new AbortController();
    this.#run = controller;
    this.#showHint(null);
    const finish = (ok: boolean) => {
      if (this.#run !== controller) return;
      this.#run = null;
      clearIntent();
      if (!ok) this.#showHint(category);
    };
    void run(controller.signal).then(finish, () => finish(false));
  }

  async #follow(initial: Intent, signal: AbortSignal): Promise<boolean> {
    let intent = initial;
    while (!signal.aborted && Date.now() < intent.deadline) {
      const action = await waitFor(() => nextAction(intent), intent.deadline - Date.now(), signal);
      if (action === 'arrived') return true;
      if (!action || action === 'ambiguous' || signal.aborted || Date.now() >= intent.deadline) return false;
      // Recheck identity after the wait, before clicking a navigation control.
      const current = nextAction(intent);
      if (current === 'arrived') return true;
      if (current === 'ambiguous') return false;
      if (!current || current.stage !== action.stage) continue;
      if (current.stage === 'arriving') {
        if (action.stage !== 'arriving' || current.link.anchor !== action.link.anchor || current.link.href !== action.link.href) continue;
        intent = saveIntent(intent.category, 'arriving', STEP_MS * 2);
        navigate(current.link.href, current.link.anchor);
      } else {
        if (action.stage === 'arriving' || current.button !== action.button) continue;
        intent = saveIntent(intent.category, current.stage);
        current.button.click();
      }
    }
    return false;
  }
}
