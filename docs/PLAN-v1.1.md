# Contacts Rail v1.1: plan

Six additions to the Chrome extension in this folder (`fb-contacts-sidebar`). Read `README.md`
first: it explains the architecture (host page panel + a hidden Messenger frame + a short-lived
ranker frame) and where Facebook-dependent code lives. Keep that architecture; extend it.

## Ground rules

- TypeScript strict, no runtime dependencies, no new npm packages except as dev tools if truly needed.
- Every user-facing string goes through `chrome.i18n` (`t()`), in **both** `src/_locales/en` and
  `src/_locales/vi`.
- Facebook-markup knowledge stays in named finders/strategies (`frame/contacts.ts` `finders`,
  `content/rail.ts` `STRATEGIES`, `content/chat-opener.ts`). Prefer locale-independent hooks
  (roles, `aria-haspopup`, SVG path signatures) over visible text.
- Panel styling: Facebook's own CSS variables (see `content/panel.css`), flat, no gradients, no
  glass, a shadow only on things that float (menus, the hover card, dialogs). Sentence case.
  Icons: 16px outline from `ICONS` in `shared/dom.ts`.
- **Never delete, archive, block or message anything on a real account while developing.** You have
  no browser here; the coordinator verifies in the user's browser afterwards.
- A dev watcher (`node scripts/build.mjs --watch`) is already running and rebuilds `dist/` on save,
  which reloads the extension in the user's Chrome. Do not start another watcher, and do not write
  into `dist/` yourself.

## Features

### 1. Pin people to the top
- A per-person store in `chrome.storage.sync` (syncs across the user's Chrome profiles):
  `src/shared/people.ts` with `{ pinned: string[]; hidden: string[]; notify: string[] }` keyed by
  the contact's user id (`Contact.id`), with `get/set/subscribe` like `shared/settings.ts`.
- Pinned people are listed first, in pin order, before the online-first ordering of the rest
  (`arrange()` in `content/contact-list.ts`). A small pin mark after the name.

### 2. Tell me when they come online (Chrome notification)
- Per-person toggle "Notify when active" (pinning a person does not turn it on by itself).
- The content script compares presence snapshots: a person in `notify` going offline -> online
  triggers one notification. Never on the first snapshot after page load; at most one per person
  per 30 minutes; only from one Facebook tab (pick the most recently focused, or use a lock in
  `chrome.storage.session`).
- Add a real background service worker `src/background/main.ts` (ES module) that creates the
  notification (`chrome.notifications`, permission `notifications`) with the person's name and
  avatar. Clicking it focuses the Facebook tab and opens that person's chat (message to the tab,
  which runs the existing `ChatOpener` path).
- The dev auto-reload currently lives in `scripts/dev-reload.js` and is the dev build's only
  service worker. Move it into the background bundle behind `if (__DEV__)` (it must keep working
  exactly as now, including the `alarms` permission added only in dev builds) and update
  `scripts/build.mjs` so release builds contain no dev code.

### 3. Hide people
- Per-person "Hide from contacts". Hidden people are left out of the list; the More menu gets
  "Show hidden people (n)" which lists them with an Unhide action.

### 4. Active-only filter and online count
- Setting `onlineOnly: boolean` (default false) in `shared/settings.ts`, toggled from the panel's
  More menu ("Only show who is active") and shown in the popup.
- Header: "Contacts · 12" where 12 is the number of people active now (people only, not groups;
  hidden people excluded). The count updates live and is announced politely (`aria-live`).

### 5. Hover card: last message
- Extend `Contact` with `snippet: string` (last message preview as Messenger shows it) and
  `time: string` (the relative time Messenger shows, e.g. the `abbr` `aria-label` "30 phút
  trước"). Read them in `frame/contacts.ts` finders; empty for ranked people with no chat.
- Hovering a row for 400 ms (or focusing it with the keyboard) shows a small floating card beside
  the panel, on the feed side: avatar, name, "Active now" or nothing, the snippet (2 lines max,
  ellipsis) and the time. It never covers the row it describes, follows the row on scroll, and
  hides on leave/blur/Escape. Rows with nothing to show get no card.

### 6. Delete a conversation
The user wants to delete their copy of a conversation from the Contacts list.
- Entry point: a per-row actions menu (see "Row menu" below) item "Delete conversation", only for
  contacts that have a conversation in the inbox (`href` from the inbox). Groups included.
- **Confirmation is mandatory**: a dialog inside the panel's shadow root (role `alertdialog`,
  focus trapped, Escape and Cancel close it) that names the person and says, in plain words, that
  this deletes the user's copy of the whole conversation, it cannot be undone, and the other person
  keeps theirs. The destructive button is in the negative colour and is not the default focus.
- Then the page sends `HostCommand { type: 'delete'; href: string }` to the inbox frame. In
  `frame/` add `delete.ts`:
  1. find the conversation row: `a[role="link"]` whose `href` thread id matches; its row is
     `closest('[role="row"]')`;
  2. hover it (dispatch `mouseover`/`mouseenter`) and click its options button
     `[aria-haspopup="menu"]` (aria-label like "More options for <name>");
  3. in the opened `[role="menu"]`, pick the `[role="menuitem"]` whose icon `svg path` `d`
     starts with `M8.75.5A2.25 2.25 0 0 0 6.5 2.75v.75H1.7` (the trash icon; locale independent).
     Do not fall back to "the item before last" or to text matching in one language only;
     a small table of known labels (en "Delete chat", vi "Xóa đoạn chat") may be a second check;
  4. Facebook then shows its own confirmation `[role="dialog"]`; click its confirming button: the
     button whose text equals the menu item's text, else the dialog's last enabled button that is
     not its first (cancel). If anything is not found within a few seconds, press Escape to close
     what was opened and report failure. Never click anything you could not identify;
  5. reply `FrameEvent { type: 'deleted'; href: string; ok: boolean; reason?: string }`.
- On success the row disappears (the inbox update does that) and a quiet status line says
  "Conversation with <name> deleted". On failure: "Couldn't delete. Open it in Messenger to
  delete it there." with a link. No retries.

### Row menu (shared by 1, 2, 3, 6)
- Each row gets a "More" button (32px round, visible on hover/focus, like Facebook's own rows) and
  the same menu on right-click: Pin / Unpin, Notify when active (checkbox), Hide, Open in new tab,
  Delete conversation (last, separated, negative colour).
- Ctrl/Cmd-click or middle-click a row opens the conversation in a new tab
  (`location.origin + href`).
- Keyboard: Shift+F10 or the context-menu key opens the row menu; arrows move inside menus;
  Escape closes.

## Tests

Add `npm test` using Node's built-in runner (`node --test`, Node 23 can run `.ts` with
`--experimental-strip-types`; otherwise compile the pure modules with esbuild to a temp dir first).
Cover the pure functions: `mergeContacts` (id match, name match for encrypted threads, ambiguous
names not matched, groups kept), `arrange` with pins/hidden/onlineOnly, `fold`, the presence
transition logic for notifications (first snapshot silent, 30-minute cooldown).

## Done when

- `npx tsc --noEmit` passes.
- `npm test` passes.
- `node scripts/build.mjs --out release/unpacked` succeeds, and `release/unpacked` contains no dev
  code (`grep -r "dev-check\|build-id\|__DEV__" release/unpacked` finds nothing).
- `README.md` and `PRIVACY.md` describe the new features and the new permission (notifications)
  and the delete behaviour honestly.
- A short report: files changed, what was verified, and anything that needs checking in a real
  browser (the coordinator will do that with the user's permission).
