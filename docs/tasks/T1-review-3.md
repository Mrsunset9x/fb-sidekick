# T1 review 3: category links have a trailing slash

User test: "Gỡ like và cảm xúc" stopped on the parent "Bình luận và cảm xúc" page and showed the
hint, although both sub-links were visible in the left nav.

Coordinator inspected the live nav read-only. Both sub-links are inside `[role="navigation"]`,
visible, `role="link"`, textContent exactly "Bình luận" / "Lượt thích và cảm xúc", and their hrefs are:

`/<numeric id>/allactivity/?activity_history=false&category_key=<key>&manage_mode=false`

Note the **trailing slash** after `allactivity` (and no `should_load_landing_page` param;
category_key length 15 for comments, 10 for likes). `validateActivityHref` in
`src/hub/activity-navigation.ts` requires `url.pathname.endsWith('/allactivity')`, so both links are
rejected, `categoryLinks()` is empty and navigation times out. (My spec said "path ends with
/allactivity"; that was wrong.)

Please:
1. Accept `/allactivity` with or without the trailing slash (`isActivityPath` already does; rely on
   it, drop the extra `endsWith` check or make it slash-tolerant).
2. Add tests using the exact shape above (trailing slash, these params) for `validateActivityHref`
   and for the navigation fixture reaching the category.
3. Look for any other place that assumes no trailing slash (route identity, heading detection,
   cache) and fix it.
4. `npx tsc --noEmit`, `npm test`, `npm run build`. No commit/push, no browser.

Report with worker_done.
