# Contacts Rail for Facebook

Facebook removed the **Contacts** list from the right column on desktop for many accounts
(spring 2026). This extension puts it back, drawn the way Facebook drew it:

- **Contacts** lists your pins first, in pin order, then people who are active now and your other recent conversations.
- **Group conversations** in their own section below.
- Unread conversations in bold with a blue dot.
- **Click someone and Facebook's own chat window opens** at the bottom of the page, as before.
- Search that ignores accents: `hung` finds *Hưng*, `do` finds *Đỗ*.
- Live: presence and unread states update as they change.
- A full Messenger inbox in the panel when you want it (⋯ → Open Messenger inbox here), widened
  over the feed to read a conversation (`Esc` narrows it). This view is local to the current page;
  refreshing Facebook returns to Contacts and opening another tab does not change it.
- Contacts leaves space above an open bottom-docked chat window. The remaining list scrolls;
  closing or minimizing the chat restores the space.
- Saves CPU in background tabs: after 5 minutes hidden, the panel unloads its Messenger frame and
  loads it again when you return, keeping the last list on screen meanwhile. It stays loaded while
  anyone has **Notify when active**, while the inbox view is open, or when **Pause in background
  tabs** is turned off in the popup.
- Follows Facebook's light and dark mode, colours and type. English and Vietnamese.
- No runtime dependencies or analytics.

## Contacts controls

- Hover or focus a row to see its More button. Right-click, Shift+F10 and the context-menu key
  also open the row menu. Use the arrow keys to move through it and Escape to close it.
- Pin, hide or turn on **Notify when active** for a person. Chrome sync carries these preferences
  across profiles when extension sync is enabled. In the panel’s More menu, **Show hidden people**
  lets you unhide contacts.
- The number beside **Contacts** counts visible people who are active, including people outside the
  current search. The **Only show who is active** switch in More and the extension popup filters the
  list to active people. It hides offline pins and the group section while enabled.
- Hover over a row for 400 ms or focus it with the keyboard to see the last-message preview, relative
  time and current presence when Messenger supplies them.
- An opted-in contact’s offline-to-online change can show a Chrome notification with their name and
  avatar. The first inbox snapshot is silent. Across tabs in one Chrome profile, each person can
  trigger at most one notification every 30 minutes. Click the notification to open their chat.
- **Open in new tab**, Ctrl/Cmd-click and middle-click open the conversation in a separate tab.
- **Delete conversation** is available only for threads in the inbox, including groups. The panel
  names the conversation and asks you to confirm before it uses Messenger’s own delete controls.
  This permanently deletes your copy of the whole conversation. Other participants keep their copies.
  If the extension cannot verify the delete, it gives you a link to the conversation in Messenger.
  Delete controls are identified by their exact English or Vietnamese labels, independent of
  Facebook's changing icons. Unknown or ambiguous controls are not clicked. A confirmation is
  clicked once, then the extension waits up to 10 seconds for the dialog and inbox row to disappear.
  An unverified result asks you to check Messenger before trying again.

## How it works

```
 facebook.com (your tab)                         facebook.com/messages (hidden frame)
 ┌───────────────────────────────┐               ┌────────────────────────────────┐
 │ content/  RailWatcher ─ layout │  contacts     │ frame/contacts.ts reads the    │
 │           Panel ◄──────────────┼───────────────┤ inbox rows: name, avatar,      │
 │           ContactList          │  postMessage  │ presence, unread, preview     │
 │           ChatOpener ──► Facebook's            │ frame/quiet.ts mutes its sounds│
 │                         chat window            └────────────────────────────────┘
 └───────────────────────────────┘
```

Facebook no longer sends the online list to the page, but Messenger's inbox still shows who is
active. The extension loads `facebook.com/messages` in a frame inside the panel, kept invisible and
inert, reads the conversation list from it and draws the Contacts list from that. Clicking a contact
opens Facebook's own chat window through the Messenger menu in the top bar; if the conversation is
not there, the contact list stays visible and offers a link to open the conversation in Messenger.

Facebook sends `X-Frame-Options: DENY` on Messenger, which forbids framing. One
`declarativeNetRequest` rule removes that single header, only for frames that facebook.com itself
opens on `facebook.com/messages`. Facebook's Content-Security-Policy is left untouched. The frame is
sandboxed without `allow-top-navigation`, so nothing inside it can move the page you are on, and its
message sounds and notifications are muted so nothing pings twice (call audio is not touched).
The background worker handles contact preferences and notifications, and relays a confirmed delete
to the docked inbox through Chrome’s extension messaging.

```
src/
  manifest.json            MV3 manifest (strings from _locales)
  rules/frame-headers.json the one header rule
  shared/
    settings.ts            typed settings schema + store (chrome.storage) with subscribe()
    people.ts              synced pin, hide and presence-notification preferences
    presence.ts            presence transitions and the notification cooldown
    protocol.ts            typed messages between the page and the frame; the Contact type
    dom.ts                 h() element builder, outline icon set, i18n helper
  content/                 runs on facebook.com (top frame)
    main.ts                controller: joins the parts below, applies settings
    rail.ts                finds Facebook's right column (strategy list) and watches it
    layout.ts              pure function: column + settings -> panel box
    panel.ts / panel.css   the panel shell: header, search, menu, views, frame
    contact-list.ts        the Contacts list view (sorting, search, keyboard)
    contact-actions.ts     row menu, preview card and dialogs
    menu.ts                shared keyboard handling for menus
    chat-opener.ts         ways to open Facebook's chat window (strategy list)
    pause.ts               unloads the Messenger frame in long-hidden tabs
  frame/                   runs inside the hidden Messenger frame only
    main.ts                route reporting, link hand-off, commands from the page
    contacts.ts            reads the inbox rows (named finders)
    delete.ts              finds the inbox thread and Messenger's delete controls
    quiet.ts               mutes sounds and notifications (page world)
    frame.css              compact mode for the inbox view
  background/              notification worker, inbox relay and development reload
  popup/                   settings popup (also the options page)
  _locales/en, vi          all user-facing text
scripts/
  build.mjs                esbuild bundle -> dist/   (--watch for development)
  test.mjs                 bundles test cases for Node's built-in runner
  icons.mjs                draws the PNG icons
  pack.mjs                 zips the release build for the Chrome Web Store
```

### When Facebook changes its page

Facebook-dependent UI is handled in the finders and strategies below.

| Symptom | Fix in |
| --- | --- |
| The panel does not appear | `STRATEGIES` in `content/rail.ts` |
| Names, avatars, dots, groups, previews or timestamps are wrong | `finders` in `frame/contacts.ts` |
| Clicking a contact no longer opens a chat window | `content/chat-opener.ts` (add a strategy) |
| Messenger's delete controls are no longer detected | `finders` in `frame/delete.ts` |

### Extending it

- **A new setting**: add it to `Settings` and `DEFAULTS` in `shared/settings.ts` (and to
  `ALLOWED` if it has a fixed set of values), add a control in `popup/popup.ts`.
- **A new message between page and frame**: add a variant to `FrameEvent` or `HostCommand` in
  `shared/protocol.ts`; TypeScript points at every `switch` that must handle it.
- **A new language**: copy `src/_locales/en` to the locale code and translate.

## Develop

Requires Node 22+.

```bash
npm install
npm run dev        # build to dist/, rebuild on change, auto-reload extension + Facebook tabs
npm run typecheck
npm test
npm run pack       # typecheck, release build to release/unpacked/, zip to release/
```

Load it once: `chrome://extensions` → **Developer mode** → **Load unpacked** → choose `dist/`.
With `npm run dev` running, a save reloads the extension and open Facebook tabs only after
TypeScript and every bundle succeed. A failed check keeps the previous published files and build
stamp. Dev builds open the panel's shadow root for inspection; releases keep it closed.
Changing the build script or package metadata stops the watcher and asks for a restart, so it
cannot continue publishing with an obsolete entry-point list.

For daily use, stop the watcher and run `npm run build`, then reload **Cột liên hệ / Contacts Rail**
on `chrome://extensions` and refresh existing Facebook tabs once. This keeps the same extension
ID and saved preferences, while removing automatic development reloads. Rebuilding does not
delete the loaded directory. An extension update invalidates old page scripts; v1.1.1 catches
that transition and removes the old panel, listeners and ranking frame until the page is refreshed.

## Known limits

- The list holds your recent conversations (Messenger's inbox), not every friend: Facebook no
  longer sends a full friends-online list to the page.
- The hidden Messenger frame runs Messenger's own scripts, which use noticeable CPU while the tab is
  open. Background tabs pause it (see above); a visible Facebook tab always keeps it loaded.
- Moving between conversations in the inbox view adds entries to the tab's history, so the browser's
  Back button steps through them first.
- Last-message previews, relative times and delete controls depend on the markup Messenger renders
  for your account. An unavailable notification avatar falls back to the extension icon.

## Privacy

The extension uses Chrome’s `notifications` permission for the alerts you turn on. Chrome sync
can carry contact preference IDs across your profiles. See [PRIVACY.md](PRIVACY.md).

## License

MIT
