/**
 * Content script for facebook.com (top frame only).
 *
 * The controller: it joins independent parts and holds no UI of its own.
 *   RailWatcher   where Facebook's right column is          (rail.ts)
 *   layout()      where the panel should sit                 (layout.ts)
 *   Panel         what the user sees and presses             (panel.ts)
 *   ChatOpener[]  how a chosen contact opens a chat window   (chat-opener.ts)
 *   Ranking       who you interact with most, per Facebook   (ranking.ts)
 *   mergeContacts ranking + inbox -> the Contacts list       (merge.ts)
 * Settings come from storage and are re-applied whenever the popup changes them.
 */
import { settings, type Settings, type View } from '../shared/settings';
import { isThreadHref, listen, post, threadId, type ChatTarget, type Contact, type DeleteResult, type FrameEvent,
  type HostCommand, type ToBackground, type ToHost } from '../shared/protocol';
import { people, type People } from '../shared/people';
import { cameOnline, presenceSnapshot } from '../shared/presence';
import { t } from '../shared/dom';
import { RailWatcher, type RailGeometry } from './rail';
import { layout } from './layout';
import { Panel } from './panel';
import { MessengerMenuOpener } from './chat-opener';
import { Ranking } from './ranking';
import { mergeContacts } from './merge';
import { deleteFailureCode, deleteFeedback } from '../shared/delete-feedback';
import { extensionAlive, extensionCall, extensionTask, extensionValue, onExtensionInvalidated } from '../shared/runtime';

class Controller {
  #settings: Settings;
  #people: People;
  #rail: RailGeometry | null = null;
  #inThread = false;
  // Navigation belongs to this page, not a preference shared with every Facebook tab.
  #view: View = 'contacts';
  #panel: Panel;
  #watcher = new RailWatcher((rail) => {
    this.#rail = rail;
    this.#render();
  });
  #unlisten: () => void;
  #inbox: Contact[] = [];
  #ranking = new Ranking(() => this.#showContacts());
  #rankingStarted = false;
  #presence: ReadonlyMap<string, boolean> | null = null;
  #deleting = false;
  #stopped = false;
  #opening = 0;
  readonly #opener = new MessengerMenuOpener();
  /** A deleted chat must not immediately return as a ranked suggestion. */
  readonly #deletedSuggestions = new Set<string>();

  constructor(initial: Settings, preferences: People) {
    this.#settings = initial;
    this.#people = preferences;
    this.#panel = new Panel({
      openContact: (contact) => void this.#openContact(contact).catch(() => {}),
      setView: (view) => this.#setView(view),
      toggleCollapsed: () => extensionTask(() => settings.set({ collapsed: !this.#settings.collapsed })),
      toggleWide: () => extensionTask(() => settings.set({ wide: !this.#settings.wide })),
      toggleOnlineOnly: () => extensionTask(() => settings.set({ onlineOnly: !this.#settings.onlineOnly })),
      setPerson: (key, id, enabled) => {
        void extensionCall(() => chrome.runtime.sendMessage<ToBackground, boolean>({ type: 'set-person', key, id, enabled }))
          .then((ok) => { if (!ok) this.#panel.status(t('preferenceFailed')); })
          .catch(() => this.#panel.status(t('preferenceFailed')));
      },
      deleteConversation: (contact) => void this.#deleteContact(contact),
      back: () => {
        if (this.#inThread) this.#send({ type: 'inbox' });
        else this.#setView('contacts');
      },
    });
    this.#unlisten = listen<FrameEvent>(() => this.#panel.frame?.contentWindow ?? null, (event) =>
      this.#onFrameEvent(event),
    );
    addEventListener('keydown', this.#onKey);
    extensionValue(() => chrome.runtime.onMessage.addListener(this.#onRuntimeMessage), undefined);
  }

  start(): void {
    if (this.#stopped || !extensionAlive()) { this.stop(); return; }
    document.body.prepend(this.#panel.host);
    this.#watcher.start();
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#opener.cancel();
    this.#watcher.stop();
    this.#ranking.stop();
    this.#unlisten();
    extensionValue(() => chrome.runtime.onMessage.removeListener(this.#onRuntimeMessage), undefined);
    removeEventListener('keydown', this.#onKey);
    this.#panel.destroy();
  }

  update(next: Settings): void {
    this.#settings = next;
    this.#render();
  }

  updatePeople(next: People): void {
    this.#people = next;
    this.#render();
  }

  #render(): void {
    if (this.#stopped || !extensionAlive()) return;
    const { collapsed, wide } = this.#settings;
    this.#panel.render({
      box: layout(this.#rail, { ...this.#settings, view: this.#view }, innerHeight),
      view: this.#view,
      collapsed,
      wide,
      inThread: this.#inThread,
      people: this.#people,
      onlineOnly: this.#settings.onlineOnly,
    });
  }

  #showContacts(snapshot = false): void {
    if (this.#stopped || !extensionAlive()) return;
    const contacts = mergeContacts(this.#inbox, this.#ranking.people);
    if (snapshot) {
      for (const contact of contacts) if (contact.inInbox) this.#deletedSuggestions.delete(contact.id);
      const candidates = cameOnline(this.#presence, contacts, new Set(this.#people.notify));
      this.#presence = presenceSnapshot(contacts);
      if (candidates.length) {
        void extensionCall(() => chrome.runtime.sendMessage<ToBackground>({ type: 'presence', contacts: candidates.map(({ id, href, name, avatar }) => ({
          id, href, name, avatar,
        })) })).catch(() => {});
      }
    } else if (this.#presence) {
      // The ranking can change an encrypted contact's key without any change in presence.
      this.#presence = presenceSnapshot(contacts);
    }
    this.#panel.contacts = contacts.filter((c) => c.inInbox || !this.#deletedSuggestions.has(c.id));
  }

  async #openContact(contact: ChatTarget): Promise<boolean> {
    if (this.#stopped || !extensionAlive()) return false;
    const opening = ++this.#opening;
    this.#panel.status('');
    const target = contact.name ? contact :
      this.#inbox.find((row) => threadId(row.href) === threadId(contact.href)) ?? contact;
    if (await this.#opener.open(target)) return true;
    if (opening !== this.#opening || this.#stopped || !extensionAlive()) return false;
    this.#panel.status(t('openChatFailed'), contact.href);
    return false;
  }

  async #deleteContact(contact: Contact): Promise<void> {
    if (this.#deleting || !contact.inInbox || !isThreadHref(contact.href)) return;
    // Recheck the inbox at confirmation time. The list may have updated while the dialog was open.
    const id = threadId(contact.href);
    if (!this.#inbox.some((chat) => threadId(chat.href) === id)) {
      this.#panel.status(t('deleteFailed'), contact.href);
      return;
    }
    this.#deleting = true;
    this.#panel.deleting = true;
    this.#panel.status(t('deletingConversation'));
    try {
      const result = await extensionCall(() => chrome.runtime.sendMessage<ToBackground, DeleteResult>({ type: 'delete', href: contact.href }));
      if (result?.type !== 'deleted' || result.href !== contact.href || !result.ok) {
        this.#panel.status(`${t(deleteFeedback(result?.reason))} ${t('deleteErrorCode', deleteFailureCode(result?.reason))}`, contact.href);
        return;
      }
      this.#deletedSuggestions.add(contact.id);
      this.#inbox = this.#inbox.filter((chat) => threadId(chat.href) !== id);
      this.#showContacts();
      this.#panel.status(t('deletedConversation', contact.name));
    } catch {
      this.#panel.status(t('deleteFailed'), contact.href);
    } finally {
      this.#deleting = false;
      this.#panel.deleting = false;
    }
  }

  #setView(view: View): void {
    this.#view = view;
    this.#render();
    this.#send({ type: 'view', view });
  }

  #send(command: HostCommand): void {
    const target = this.#panel.frame?.contentWindow;
    if (target) post(target, command);
  }

  #onFrameEvent(event: FrameEvent): void {
    if (this.#stopped || !extensionAlive()) return;
    this.#panel.markReady();
    switch (event.type) {
      case 'route':
        this.#inThread = event.inThread;
        this.#send({ type: 'view', view: this.#view });
        this.#render();
        break;
      case 'contacts':
        this.#inbox = event.contacts;
        this.#showContacts(true);
        // Fetch the ranking once the inbox is up, so the two frames never load at the same time.
        if (!this.#rankingStarted) {
          this.#rankingStarted = true;
          extensionTask(() => this.#ranking.start(this.#panel.stage));
        }
        break;
      case 'open': {
        const url = new URL(event.url, location.href);
        if (url.origin === location.origin) location.assign(url);
        break;
      }
    }
  }

  readonly #onRuntimeMessage = (message: ToHost, sender: chrome.runtime.MessageSender, reply: (handled: boolean) => void) => {
    if (sender.id !== chrome.runtime.id || sender.tab || message?.type !== 'open-notification' || !isThreadHref(message.contact?.href)) return;
    void this.#openContact(message.contact).then(reply, () => reply(false));
    return true;
  };

  readonly #onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.#settings.wide && this.#view === 'inbox') {
      extensionTask(() => settings.set({ wide: false }));
    }
  };
}

async function boot(): Promise<void> {
  let controller: Controller | null = null;
  let preferences = await people.get();
  if (!extensionAlive()) return;
  const unpeople = people.subscribe((next) => {
    preferences = next;
    controller?.updatePeople(next);
  });
  const apply = (s: Settings) => {
    if (!extensionAlive()) return;
    if (s.enabled && !controller) {
      controller = new Controller(s, preferences);
      controller.start();
    } else if (!s.enabled && controller) {
      controller.stop();
      controller = null;
    } else {
      controller?.update(s);
    }
  };
  const unsettings = settings.subscribe((next) => apply(next));
  onExtensionInvalidated(() => {
    controller?.stop();
    controller = null;
    unpeople();
    unsettings();
  });
  apply(await settings.get());
}

// Let Facebook finish its own start-up first; the panel is never the critical path.
const idle = (fn: () => void) =>
  'requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300);
if (window.top === window) idle(() => extensionTask(boot));

// Dev builds: wake the reload worker so a fresh build is picked up on every page load.
if (__DEV__) extensionTask(() => chrome.runtime.sendMessage('dev-check'));
