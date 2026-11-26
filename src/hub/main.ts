/**
 * Content script for facebook.com (top frame): the floating FB Sidekick
 * button (hub.ts) and the bulk tools it shows on supported pages.
 *
 * Facebook is a single-page app, so the script runs on every page and swaps
 * the tool when the route changes. Supported tool pages: /saved (more to come,
 * see docs/PLAN-cleanup.md).
 */
import { settings, type Settings } from '../shared/settings';
import { extensionAlive, extensionTask, onExtensionInvalidated } from '../shared/runtime';
import { Toolbar, type BulkItem, type PageAdapter } from '../cleanup/toolbar';
import { readSaved, unsave, type SavedItem } from '../cleanup/saved';
import { Hub } from './hub';

const savedPage: PageAdapter<SavedItem> = {
  title: 'bulkSavedTitle',
  action: 'bulkUnsave',
  confirmTitle: 'bulkUnsaveConfirm',
  confirmBody: 'bulkUnsaveBody',
  read: readSaved,
  act: unsave,
};

function adapterFor(path: string): PageAdapter<BulkItem> | null {
  if (path === '/saved' || path.startsWith('/saved/')) return savedPage as unknown as PageAdapter<BulkItem>;
  return null;
}

async function boot(): Promise<void> {
  let current: Settings = await settings.get();
  if (!extensionAlive()) return;
  let hub: Hub | null = null;
  let toolPath: string | null = null;

  const route = () => {
    if (!hub || !extensionAlive()) return;
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path === toolPath) return;
    toolPath = path;
    const page = adapterFor(path);
    hub.setTool(page ? new Toolbar(page, hub.root, (running) => hub?.setRunning(running)) : null);
  };

  const apply = (next: Settings) => {
    current = next;
    if (!extensionAlive()) return;
    if (next.hub && !hub) {
      hub = new Hub({ set: (patch) => extensionTask(() => settings.set(patch)) });
      hub.mount();
      toolPath = null;
      route();
    } else if (!next.hub && hub) {
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
    hub?.destroy();
    hub = null;
    unsubscribe();
    nav?.removeEventListener('navigatesuccess', route);
    removeEventListener('popstate', route);
  });
  apply(current);
}

if (window.top === window) extensionTask(boot);
