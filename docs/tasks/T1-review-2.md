# T1 review 2: hub links must land on the category page itself

User test: clicking "Gỡ like và bình luận" in the hub lands on the Activity Log overview
(`/me/allactivity/`, heading "Nhật ký hoạt động", a mixed list with no checkboxes). The user did not
find the bulk mode and thought it didn't exist. A text hint is not enough.

Read-only facts (coordinator, Nov 26 2026, vi UI), left nav inside `[role="navigation"]`:

- "Hoạt động của bạn trên Facebook" is a `DIV role="button"` (no href) that expands a group.
  Its textContent starts with that title followed by a description.
- "Bình luận và cảm xúc" is a `DIV role="button"` (no href). Clicking it opens a page whose heading
  is "Bình luận và cảm xúc" with **0 checkboxes and no "Gỡ"**: no bulk mode there.
- "Bình luận" and "Lượt thích và cảm xúc" (shown after expanding "Bình luận và cảm xúc") are
  `A role="link"` **with href**:
  `/<numeric id>/allactivity?activity_history=false&category_key=<15-char key>&manage_mode=false&should_load_landing_page=false`.
  These pages have the bulk mode (26 native checkbox inputs, "Tất cả", "Gỡ").

Please change:

1. Hub has two separate tools instead of one link: "Gỡ like và cảm xúc" and "Xoá bình luận"
   (vi; en "Remove likes and reactions", "Delete comments"). Keep "Bỏ theo dõi" as "Sắp có".
2. Clicking one must land on that category page:
   - If a cached href for that category exists in `chrome.storage.local` (store only the path and
     query of the sub-link, read from the nav anchor whose text is exactly the category label),
     navigate there (prefer an in-app navigation, else `location.assign`).
   - Otherwise go to `/me/allactivity/` and, once there, open the category through the left nav:
     expand "Hoạt động của bạn trên Facebook" only if the target is not visible, then "Bình luận và
     cảm xúc", then click the exact sub-link. Exact labels (vi + en), each step waits for the next
     item, timeout → stop and show the existing hint. These clicks only navigate; never click
     anything else.
   - Cache the sub-link href whenever the content script sees it in the nav (so the second time is
     direct). Validate before using a cached href: same origin, path ends with `/allactivity`,
     has `category_key`.
3. While on the overview or the "Bình luận và cảm xúc" parent page, the hub panel shows two
   buttons "Mở Lượt thích và cảm xúc" / "Mở Bình luận" (same navigation as above) instead of only
   text.
4. Tests for the pure parts (label matching for the nav steps, cached-href validation).
5. `npx tsc --noEmit`, `npm test`, `npm run build`. No commit/push, no browser.

Report with worker_done.
