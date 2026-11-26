# T1 review 1: Activity Log checkboxes are native inputs

Coordinator checked the real Activity Log markup read-only (Nov 26 2026, vi UI), in both
"Bình luận" and "Lượt thích và cảm xúc":

- `[role="checkbox"]` count in `[role="main"]`: **0**.
- `input[type="checkbox"]` count: **26** (1 header + 25 rows). They carry `aria-checked="false"`
  but **no `role` attribute**.
- Row inputs: `aria-label="Chọn bài viết từ HH:MM D Tháng M, YYYY, bài..."`. This prefix is used
  in **both** categories, also for comments (not "Chọn bình luận từ").
- Header input: **no `aria-label` attribute at all**. Its 4th ancestor's text is "Tất cảGỡ" ("All"
  label and the Remove button live together).
- The Remove control is a `DIV` with `role="button"`, text "Gỡ", and `aria-disabled="true"` until
  something is selected.
- Main headings: first heading text is exactly "Bình luận" or "Lượt thích và cảm xúc"; date
  headings follow ("26 Tháng 11, 2026").

So `CHECK = '[role="checkbox"]'` in `src/cleanup/activity.ts` finds nothing, and the tool would show
0 items. Please fix:

1. Match both forms: `input[type="checkbox"], [role="checkbox"]`. Read the state from the `checked`
   property for inputs (fall back to `aria-checked` for role=checkbox); treat a mismatch between
   the two as unknown → `'unidentified'`.
2. Toggle a native input in the way React notices (a real `click()` on the input is fine; verify
   the state changed as you already do).
3. Header detection must work with a missing `aria-label` and a container whose text is
   "Tất cả" + "Gỡ" (you already check span/label children; make sure that path covers it, and add
   a fixture for exactly this shape).
4. Update fixtures/tests for native inputs, the shared "Chọn bài viết từ" prefix for comments,
   and the disabled-then-enabled "Gỡ" DIV.
5. Re-run `npx tsc --noEmit`, `npm test`, `npm run build`. Still no commit/push, no browser.

Report with worker_done when done.
