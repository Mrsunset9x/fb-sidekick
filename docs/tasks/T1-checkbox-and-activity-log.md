# Task T1: faster, polished selection checkboxes + bulk remove likes/comments (Activity Log)

Repo: `D:\All_TINHPN\Codes\fb-contacts-sidebar` (branch `main`, clean at `d8a4ede`).
Chrome MV3 extension "FB Sidekick / Contacts Rail", TypeScript strict, esbuild, no runtime deps.
Read first: `README.md`, `docs/PLAN-cleanup.md`, `src/cleanup/*`, `src/hub/*`.

## Hard rules

- **Never act on a real Facebook account.** Do not open a browser, do not click, like, unlike,
  delete or unsave anything. All Facebook knowledge you need is below; the coordinator verifies in
  the user's browser afterwards.
- **Do not commit or push.** Leave changes in the working tree; the coordinator reviews and commits.
- Every user-facing string through `t()`, in both `src/_locales/en` and `src/_locales/vi`.
- Click only controls identified by **exact label** (normalized, case-insensitive) from an explicit
  table, never by position ("first/last button"). Unknown or ambiguous → stop with `'unidentified'`.
  Follow the style of `src/frame/delete.ts` and `src/cleanup/saved.ts`.
- Keep the existing runner rules (`src/cleanup/runner.ts`): pace, 25-item break, 200/day budget
  shared via `dailyBudget`, stop on blocked/unidentified/unverified.
- No new permissions. No new npm packages.
- If a decision is genuinely ambiguous, ask the coordinator (Orca `ask`) rather than guess.

## Part A: selection checkboxes on /saved appear faster and look professional

User feedback: "checkbox takes a while to appear and doesn't look professional".

Current code: `src/cleanup/toolbar.ts` `#attach` injects a `label > input[type=checkbox]` with
inline styles; `#schedule` debounces a `MutationObserver` on the whole `document.body` with a
300 ms timeout.

Do:
1. Speed: first sync immediately on mount; then coalesce syncs with `requestAnimationFrame`
   (one per frame) instead of a 300 ms timer; observe `[role="main"]` (re-attach if Facebook
   replaces it) rather than the whole body; keep `#sync` idempotent and cheap (no layout reads per
   item beyond what `readSaved` needs).
2. Look: replace the native checkbox with a Facebook-style round selection control:
   - 24px circle at the card's top-left (8px inset), white fill + subtle ring/shadow when
     unselected, Facebook accent (`var(--primary-button-background, #0866ff)`) fill with a white
     check SVG when selected; 32px hit target; short fade/scale-in (≤120 ms, respect
     `prefers-reduced-motion`).
   - Selected card gets a 2px accent outline (no layout shift, e.g. `box-shadow` / `outline`).
   - Accessible: `role="checkbox"`, `aria-checked`, `aria-label` = existing `bulkSelectItem`,
     focusable, Space/Enter toggle, visible focus ring; clicks never reach Facebook's card.
   - Styles: one injected `<style data-fb-sidekick>` with namespaced classes (`fbsk-*`) instead
     of long inline strings; removed on `destroy()`. Light and dark mode via Facebook variables.
   - Shift-click selects the range between the last toggled and this item.
3. Disabled look while a run is active.

## Part B: bulk remove likes/reactions and delete comments via Activity Log

Observed on the user's real account (Nov 2026, Vietnamese UI), read-only:

- Page: `https://www.facebook.com/<user id or name>/allactivity?...&category_key=...` (keys
  redacted; do not rely on them). Left nav: "Hoạt động của bạn trên Facebook" → "Bình luận và
  cảm xúc" → sub-items **"Bình luận"** and **"Lượt thích và cảm xúc"**. Main column heading text
  equals the selected category name.
- **Facebook's own bulk mode exists** in both categories:
  - each row has `role="checkbox"` with `aria-label="Chọn bài viết từ <HH:MM> <D> Tháng <M>..."`
    (likes; comments similar), plus one header checkbox with empty label next to the text
    **"Tất cả"**, and one button **"Gỡ"** (Remove).
  - each row also has a button `aria-label="Lựa chọn khác cho <name>"`; for comments its menu
    holds a single item **"Xóa"**.
  - Rows load ~25 at a time while scrolling.
- Unknown (do not guess, handle safely): the confirmation dialog shown after "Gỡ", its button
  labels, and how rows disappear afterwards. Use an exact-label table (vi + en candidates such as
  "Gỡ", "Xóa", "Xoá", "Remove", "Delete") and stop with `'unidentified'` otherwise. In dev builds
  (`__DEV__`) log the dialog's title and button labels (no user content) so the coordinator can
  extend the table after a real test.

Do:
1. New page adapter(s) in `src/cleanup/activity.ts` for the two categories, detected by the
   heading text (vi + en: "Bình luận"/"Comments", "Lượt thích và cảm xúc"/"Likes and reactions")
   on `/allactivity` routes. Register them in `src/hub/main.ts` `adapterFor` (route + heading;
   the heading may render after the route change, so re-check when the main column changes).
2. Selection UI: reuse the toolbar from Part A, but select items through **Facebook's own row
   checkboxes** (tick/untick them) so the native "Gỡ" acts on exactly the user's selection.
   Item key = the row checkbox's aria-label + row link href if any.
3. Execution: batches of at most 25 selected rows: ensure only this batch is ticked in Facebook's
   own state, click "Gỡ", confirm via exact label, verify every row of the batch left the list
   (timeout → `'unverified'`). Budget counts rows, not batches. Pace between batches like the
   runner's break logic (you may extend `runBulk` with a batch mode; keep it unit-tested).
4. Strings: titles "Gỡ like và cảm xúc" / "Xoá bình luận", actions, confirm texts that say clearly
   it cannot be undone (comments are deleted permanently; reactions are removed from posts).
5. Hub: the two "Sắp có" links become real: navigate to the Activity Log category. If you cannot
   build a reliable URL without category keys, navigate to `/me/allactivity/` and show a short
   hint in the panel telling the user which category to open.
6. Update `README.md` and `docs/PLAN-cleanup.md`.

## Done when (evidence to report)

- `npx tsc --noEmit` passes, `npm test` passes (add tests for any new pure logic: batch planning,
  label tables, heading detection with string inputs).
- `npm run build` succeeds and `dist/manifest.json` version is bumped to `1.3.0` (also
  `package.json`, `package-lock.json`, `src/manifest.json`).
- A short report: files changed, design choices, anything uncertain that must be checked in a real
  browser (especially the confirmation dialog after "Gỡ").
