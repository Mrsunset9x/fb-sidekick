/**
 * Content script for facebook.com (top frame): the floating FB Sidekick
 * button (hub.ts) and the bulk tools it shows on supported pages.
 *
 * Facebook is a single-page app, so the script runs on every page and swaps
 * the tool when the route or Activity Log category changes.
 */
import { settings, type Settings } from '../shared/settings';
import { extensionAlive, extensionTask, onExtensionInvalidated } from '../shared/runtime';
import { Toolbar, type BulkItem, type PageAdapter } from '../cleanup/toolbar';
import { activityPages, isActivityPath, readActivityCategory } from '../cleanup/activity';
import { watchMain } from '../cleanup/dom';
import { readSaved, unsave, type SavedItem } from '../cleanup/saved';
import { ActivityNavigation } from './activity-navigation';
import { Hub } from './hub';

const toolFor = <T extends BulkItem>(page: PageAdapter<T>) => (hub: Hub) =>
  new Toolbar(page, hub.root, (running) => hub.setRunning(running));

const savedPage = toolFor<SavedItem>({
  title: 'bulkSavedTitle',
  action: 'bulkUnsave',
  confirmTitle: 'bulkUnsaveConfirm',
  confirmBody: 'bulkUnsaveBody',
  read: readSaved,
  act: unsave,
});
const activityTools = {
  reactions: toolFor(activityPages.reactions),
  comments: toolFor(activityPages.comments),
};

const isSavedPath = (path: string): boolean => path === '/saved' || path.startsWith('/saved/');

function adapterFor(path: string, main: HTMLElement | null) {
  if (isSavedPath(path)) return savedPage;
  const category = main && isActivityPath(path) ? readActivityCategory(main) : null;
  return category ? activityTools[category] : null;
}

async function boot(): Promise<void> {
  let current: Settings = await settings.get();
  if (!extensionAlive()) return;
  let hub: Hub | null = null;
  let toolUrl: string | null = null;
  let adapter: ReturnType<typeof adapterFor> = null;
  let stopWatching: (() => void) | null = null;
  const activityNavigation = new ActivityNavigation((category) => hub?.showActivityHint(category));

  const stop = () => {
    stopWatching?.();
    stopWatching = null;
    toolUrl = null;
    adapter = null;
  };

  const route = () => {
    if (!hub || !extensionAlive()) return;
    const url = new URL(location.href);
    const identity = url.pathname + url.search;
    if (identity === toolUrl) return;
    stop();
    toolUrl = identity;
    hub.setTool(null);
    const activity = isActivityPath(url.pathname);
    hub.showActivityLinks(activity);
    activityNavigation.route(activity);
    if (!activity && !isSavedPath(url.pathname)) return;
    stopWatching = watchMain((main) => {
      if (!hub || !extensionAlive()) return;
      // A DOM mutation can be observed before Navigation reports the new URL.
      if (location.pathname + location.search !== identity) {
        route();
        return;
      }
      const next = adapterFor(url.pathname, main);
      if (next === adapter) hub.syncTool(main);
      else {
        adapter = next;
        hub.setTool(next?.(hub) ?? null, main);
      }
    });
  };

  const apply = (next: Settings) => {
    current = next;
    if (!extensionAlive()) return;
    if (next.hub && !hub) {
      hub = new Hub({
        set: (patch) => extensionTask(() => settings.set(patch)),
        openActivity: (category) => activityNavigation.open(category),
      });
      hub.mount();
      route();
    } else if (!next.hub && hub) {
      stop();
      activityNavigation.stop();
      hub.destroy();
      hub = null;
    }
    hub?.render(current);
  };

  const unsubscribe = settings.subscribe(apply);
  const nav = (window as { navigation?: EventTarget }).navigation;
  nav?.addEventListener('navigatesuccess', route);
  addEventListener('popstate', route);
  onExtensionInvalidated(() => {
    stop();
    activityNavigation.stop();
    hub?.destroy();
    hub = null;
    unsubscribe();
    nav?.removeEventListener('navigatesuccess', route);
    removeEventListener('popstate', route);
  });
  apply(current);
}

if (window.top === window) extensionTask(boot);
