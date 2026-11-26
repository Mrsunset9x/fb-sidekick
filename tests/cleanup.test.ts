import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { runBulk, type ActOutcome, type Pace, type Progress } from '../src/cleanup/runner';
import { activityCategory, activityPages, isActivityPath, isConfirmLabel, isRemoveLabel } from '../src/cleanup/activity';
import { isBlockedText } from '../src/cleanup/dom';
import { ActivityNavigation, matchesActivityNavLabel, validateActivityHref } from '../src/hub/activity-navigation';

const pace: Pace = { min: 10, max: 20, batch: 2, breakMin: 1000, breakMax: 2000 };

function deps(outcomes: ActOutcome[], options: { budget?: number } = {}) {
  let budget = options.budget ?? 100;
  const sleeps: number[] = [];
  const states: Progress['state'][] = [];
  const acted: number[] = [];
  return {
    sleeps, states, acted,
    get budget() { return budget; },
    value: {
      act: async (item: number) => {
        acted.push(item);
        return outcomes[item] ?? 'done';
      },
      budget: async () => budget,
      spend: async (n: number) => { budget -= n; },
      sleep: async (ms: number) => { sleeps.push(ms); },
      random: () => 0.5,
      onProgress: (p: Progress) => states.push(p.state),
      pace,
    },
  };
}

test('runs every item with short waits between them and a break after each batch', async () => {
  const d = deps([]);
  const result = await runBulk([0, 1, 2, 3, 4], new AbortController().signal, d.value);
  assert.deepEqual({ done: result.done, skipped: result.skipped, state: result.state }, { done: 5, skipped: 0, state: 'finished' });
  // After items 0-1 (batch of 2) and 2-3: a break; otherwise 15 ms.
  assert.deepEqual(d.sleeps, [15, 1500, 15, 1500]);
  assert.ok(d.states.includes('resting'));
  assert.equal(d.budget, 95);
});

test('skipped items do not count, and do not trigger a second break for the same batch', async () => {
  const d = deps(['done', 'done', 'skipped', 'skipped', 'done']);
  const result = await runBulk([0, 1, 2, 3, 4], new AbortController().signal, d.value);
  assert.equal(result.done, 3);
  assert.equal(result.skipped, 2);
  assert.deepEqual(d.sleeps, [15, 1500, 15, 15]);
  assert.equal(d.budget, 97);
});

for (const reason of ['blocked', 'unidentified', 'unverified'] as const) {
  test(`stops at the first ${reason} item and never acts on the rest`, async () => {
    const d = deps(['done', reason, 'done']);
    const result = await runBulk([0, 1, 2], new AbortController().signal, d.value);
    assert.equal(result.state, 'stopped');
    assert.equal(result.reason, reason);
    assert.deepEqual(d.acted, [0, 1]);
  });
}

test('an exception from the page adapter stops the run as unidentified', async () => {
  const d = deps([]);
  d.value.act = async () => { throw new Error('boom'); };
  const result = await runBulk([0, 1], new AbortController().signal, d.value);
  assert.equal(result.reason, 'unidentified');
});

test('the daily budget stops the run before acting', async () => {
  const d = deps([], { budget: 2 });
  const result = await runBulk([0, 1, 2, 3], new AbortController().signal, d.value);
  assert.equal(result.reason, 'daily-limit');
  assert.deepEqual(d.acted, [0, 1]);
});

test('Stop during a wait ends the run without another action', async () => {
  const d = deps([]);
  const run = new AbortController();
  d.value.sleep = async () => {
    run.abort();
    throw new Error('aborted');
  };
  const result = await runBulk([0, 1, 2], run.signal, d.value);
  assert.equal(result.reason, 'stopped');
  assert.deepEqual(d.acted, [0]);
});

test('recognizes Facebook limit and checkpoint messages in English and Vietnamese', () => {
  assert.ok(isBlockedText("You're Temporarily Blocked. It looks like you were misusing this feature."));
  assert.ok(isBlockedText('Bạn tạm thời bị chặn'));
  assert.ok(isBlockedText('Vui lòng thử lại sau.'));
  assert.ok(isBlockedText('Chúng tôi giới hạn tần suất bạn có thể đăng'));
  assert.ok(!isBlockedText('Bỏ lưu'));
  assert.ok(!isBlockedText('Đã bỏ lưu bài viết'));
});

test('recognizes allactivity routes and exact category headings in English and Vietnamese', () => {
  assert.ok(isActivityPath('/me/allactivity/'));
  assert.ok(isActivityPath('/username/allactivity'));
  assert.ok(isActivityPath('/123/allactivity/'));
  assert.ok(isActivityPath('/allactivity'));
  assert.ok(!isActivityPath('/username/allactivity/settings'));
  assert.ok(!isActivityPath('/username/notallactivity'));
  assert.equal(activityCategory(['Activity log', '  COMMENTS  ']), 'comments');
  assert.equal(activityCategory(['Bi\u0300nh luâ\u0323n']), 'comments');
  assert.equal(activityCategory(['LƯỢT THÍCH  VÀ\nCẢM XÚC']), 'reactions');
  assert.equal(activityCategory(['Likes and reactions']), 'reactions');
  assert.equal(activityCategory(['Bình luận và cảm xúc', 'Comments and reactions']), null);
  assert.equal(activityCategory(['Comments', 'Likes and reactions']), null);
});

test('matches only allowed Activity Log action labels for each category', () => {
  for (const label of ['  GỠ ', 'REMOVE']) {
    assert.ok(isRemoveLabel(label));
    assert.ok(isConfirmLabel('reactions', label));
    assert.ok(isConfirmLabel('comments', label));
  }
  for (const label of ['Xóa', 'Xoá', 'Delete']) {
    assert.ok(isConfirmLabel('comments', label));
    assert.ok(!isRemoveLabel(label));
    assert.ok(!isConfirmLabel('reactions', label));
  }
  for (const label of ['Remove all', 'Delete post', 'Cancel', 'Chặn', 'Gỡ 25']) {
    assert.ok(!isRemoveLabel(label));
    assert.ok(!isConfirmLabel('comments', label));
  }
});

test('Activity Log navigation labels match whole titles, grouped by role', () => {
  assert.ok(matchesActivityNavLabel('activity-group', '  HOẠT ĐỘNG CỦA BẠN TRÊN FACEBOOK '));
  assert.ok(matchesActivityNavLabel('activity-group', 'Your activity across Facebook'));
  assert.ok(matchesActivityNavLabel('comments-group', 'Bình luận và cảm xúc'));
  assert.ok(matchesActivityNavLabel('comments-group', 'Comments and reactions'));
  assert.ok(matchesActivityNavLabel('comments', 'Bình luận'));
  assert.ok(matchesActivityNavLabel('comments', 'Comments'));
  assert.ok(matchesActivityNavLabel('reactions', 'Lượt thích và\n cảm xúc'));
  assert.ok(matchesActivityNavLabel('reactions', 'Likes and reactions'));
  assert.ok(!matchesActivityNavLabel('activity-group', 'Hoạt động của bạn trên Facebook và tài khoản'));
  assert.ok(!matchesActivityNavLabel('comments', 'Bình luận và cảm xúc'));
  assert.ok(!matchesActivityNavLabel('reactions', 'Remove Likes and reactions'));
});

const categoryPaths = {
  comments: '/123/allactivity/?activity_history=false&category_key=commentsKey0001&manage_mode=false',
  reactions: '/123/allactivity/?activity_history=false&category_key=likesKey01&manage_mode=false',
};

test('Activity Log cache accepts same-origin category URLs with and without a trailing slash', () => {
  const origin = 'https://www.facebook.com';
  const href = categoryPaths.comments;
  for (const path of Object.values(categoryPaths)) {
    assert.equal(validateActivityHref(path, origin), path);
    assert.equal(validateActivityHref(`${origin}${path}#fragment`, origin), path);
    const withoutSlash = path.replace('/allactivity/?', '/allactivity?');
    assert.equal(validateActivityHref(withoutSlash, origin), withoutSlash);
  }
  for (const value of [
    undefined, 123, '',
    `https://example.com${href}`,
    `https://web.facebook.com${href}`,
    `//www.facebook.com.example.com${href}`,
    `https://foo@www.facebook.com${href}`,
    '/123/allactivity?category_key=',
    '/123/allactivity?category_key=one&category_key=two',
    '/123/allactivity?activity_history=false',
    '/123/allactivity/subpage?category_key=one',
    '/123/saved?category_key=one',
  ]) assert.equal(validateActivityHref(value, origin), null, String(value));
});

function navigationFixture(t: TestContext, {
  cached = false, blockedGroup = false, category = 'comments',
}: { cached?: boolean; blockedGroup?: boolean; category?: keyof typeof categoryPaths } = {}) {
  const origin = 'https://www.facebook.com';
  const categoryPath = categoryPaths[category];
  const categoryLabel = category === 'comments' ? 'Bình luận' : 'Lượt thích và cảm xúc';
  const parentPath = '/123/allactivity/?category_key=parent-key';
  const cacheKey = `fbskActivityHref:${origin}:${category}`;
  const events: string[] = [];
  const hints: (string | null)[] = [];
  const storage: Record<string, string> = cached ? { [cacheKey]: categoryPath } : {};
  const session = new Map<string, string>();
  let url = new URL('/', origin);
  let activityOpen = false;
  let commentsOpen = false;
  let navigation: ActivityNavigation;
  const move = (path: string) => {
    url = new URL(path, origin);
    navigation.route(isActivityPath(url.pathname));
  };
  const widget = (textContent: string, click: () => void) => ({
    textContent,
    click,
    childNodes: [],
    closest: () => null,
    getClientRects: () => [{}],
    getAttribute: () => null,
    hasAttribute: () => false,
    matches: () => false,
    querySelectorAll: () => [],
  });
  const activityLabel = 'Hoạt động của bạn trên Facebook';
  const activity = {
    ...widget(`${activityLabel}Xem và quản lý hoạt động của bạn`, () => {
      events.push('activity-group');
      activityOpen = true;
    }),
    childNodes: [{ textContent: activityLabel }],
  };
  const group = widget(blockedGroup ? 'Bình luận và cảm xúc khác' : 'Bình luận và cảm xúc', () => {
    events.push('comments-group');
    commentsOpen = true;
    move(parentPath);
  });
  const link = {
    ...widget(categoryLabel, () => { events.push('category-anchor'); move(categoryPath); }),
    getAttribute: (name: string) => name === 'role' ? 'link' : null,
    href: origin + categoryPath,
    target: '',
  };
  const globals = {
    chrome: {
      runtime: { id: 'test-extension' },
      storage: {
        local: {
          get: async (key: string) => ({ [key]: storage[key] }),
          set: async (changes: Record<string, string>) => { Object.assign(storage, changes); },
        },
      },
    },
    sessionStorage: {
      setItem: (key: string, value: string) => session.set(key, value),
      getItem: (key: string) => session.get(key) ?? null,
      removeItem: (key: string) => session.delete(key),
    },
    location: {
      origin,
      get pathname() { return url.pathname; },
      get search() { return url.search; },
      assign: (path: string) => { events.push(`assign:${path}`); move(path); },
    },
    document: {
      body: {},
      querySelector: () => ({
        querySelectorAll: () => {
          const current = url.pathname + url.search;
          const heading = current === categoryPath ? categoryLabel
            : current === parentPath ? 'Bình luận và cảm xúc' : 'Nhật ký hoạt động';
          return [{ textContent: heading }];
        },
      }),
      querySelectorAll: (selector: string) => {
        if (!isActivityPath(url.pathname)) return [];
        if (selector === '[role="navigation"] div[role="button"]') return activityOpen ? [activity, group] : [activity];
        if (selector === '[role="navigation"] a[href]' && commentsOpen) return [link];
        return [];
      },
    },
    getComputedStyle: () => ({ visibility: 'visible' }),
    MutationObserver: class { observe() {} disconnect() {} },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  }
  navigation = new ActivityNavigation((hint) => hints.push(hint));
  t.after(() => navigation.stop());
  return { navigation, events, hints, session, storage, categoryPath, cacheKey,
    flush: () => new Promise<void>((resolve) => setImmediate(resolve)) };
}

for (const category of ['comments', 'reactions'] as const) {
  test(`Activity Log reaches ${category} through its trailing-slash anchor and caches the URL`, async (t) => {
    const fixture = navigationFixture(t, { category });
    fixture.navigation.open(category);
    await fixture.flush();
    assert.deepEqual(fixture.events, ['assign:/me/allactivity/', 'activity-group', 'comments-group', 'category-anchor']);
    assert.equal(fixture.storage[fixture.cacheKey], fixture.categoryPath);
    assert.equal(fixture.session.size, 0);
    assert.deepEqual(fixture.hints, [null]);
  });
}

test('Activity Log uses a cached category directly when no in-app anchor is available', async (t) => {
  const fixture = navigationFixture(t, { cached: true });
  fixture.navigation.open('comments');
  await fixture.flush();
  assert.deepEqual(fixture.events, [`assign:${fixture.categoryPath}`]);
  assert.equal(fixture.session.size, 0);
  assert.deepEqual(fixture.hints, [null]);
});

test('Activity Log times out with a manual hint when the next group has an unrecognized label', async (t) => {
  const fixture = navigationFixture(t, { blockedGroup: true });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'] });
  fixture.navigation.open('comments');
  await fixture.flush();
  t.mock.timers.tick(6_001);
  await fixture.flush();
  assert.deepEqual(fixture.events, ['assign:/me/allactivity/', 'activity-group']);
  assert.deepEqual(fixture.hints, [null, 'comments']);
  assert.equal(fixture.session.size, 0);
});

test('batches up to 25 rows, reports and spends by row, and clips to the remaining budget', async () => {
  const setup = deps([], { budget: 53 });
  const { act: _, ...runner } = setup.value;
  const items = Array.from({ length: 72 }, (_, i) => i);
  const acted: number[][] = [];
  const result = await runBulk(items, new AbortController().signal, {
    ...runner,
    pace: { ...pace, batch: 25 },
    actBatch: async (batch) => {
      acted.push([...batch]);
      return 'done';
    },
  });
  assert.deepEqual(acted, [items.slice(0, 25), items.slice(25, 50), items.slice(50, 53)]);
  assert.deepEqual(setup.sleeps, [1500, 1500, 1500]);
  assert.equal(setup.budget, 0);
  assert.equal(result.total, 72);
  assert.equal(result.done, 53);
  assert.equal(result.reason, 'daily-limit');
});

for (const reason of ['blocked', 'unidentified', 'unverified'] as const) {
  test(`a batch that returns ${reason} stops the queue without counting it as complete`, async () => {
    const setup = deps([], { budget: 10 });
    const { act: _, ...runner } = setup.value;
    const seen: number[][] = [];
    const result = await runBulk([0, 1, 2, 3, 4], new AbortController().signal, {
      ...runner,
      actBatch: async (batch) => {
        seen.push([...batch]);
        return batch.includes(2) ? reason : 'done';
      },
    });
    assert.deepEqual(seen, [[0, 1], [2, 3]]);
    assert.deepEqual(setup.sleeps, [1500]);
    assert.equal(result.done, 2);
    assert.equal(result.reason, reason);
    assert.equal(setup.budget, 8);
  });
}

test('aborting during a budget check prevents starting the next batch', async () => {
  const setup = deps([]);
  const { act: _, ...runner } = setup.value;
  const run = new AbortController();
  const result = await runBulk([0, 1], run.signal, {
    ...runner,
    budget: async () => {
      run.abort();
      return 10;
    },
    actBatch: async () => assert.fail('no batch should start'),
  });
  assert.equal(result.reason, 'stopped');
  assert.equal(result.done, 0);
});

function activityFixture(t: TestContext, confirmLabel: string, {
  removesRows = true,
  initiallyChecked = true,
  category = 'comments',
  roleCheckbox = false,
  noAriaChecked = false,
  plainHeaderText = false,
  mismatch = null,
}: {
  removesRows?: boolean;
  initiallyChecked?: boolean;
  category?: 'reactions' | 'comments';
  roleCheckbox?: boolean;
  noAriaChecked?: boolean;
  plainHeaderText?: boolean;
  mismatch?: 'row' | 'header' | 'after-toggle' | null;
} = {}) {
  const events: string[] = [];
  const selector = {
    input: 'input[type="checkbox"]',
    check: 'input[type="checkbox"], [role="checkbox"]',
    button: 'button, [role="button"]',
    disabled: ':disabled, [aria-disabled="true"]',
    dialogs: '[role="dialog"], [role="alertdialog"], dialog[open]',
  };
  const node = (label: string | null = null, textContent = '') => ({
    textContent,
    getAttribute: (attribute: string) => attribute === 'aria-label' ? label : null,
    getClientRects: () => [{}],
    closest: () => null,
    matches: (_selector: string) => false,
    querySelector: (_selector: string): unknown => null,
    querySelectorAll: (_selector: string): unknown[] => [],
  });
  let dialogOpen = false;
  const main = { ...node(), isConnected: true };
  const rows = [0, 1].map((i) => {
    const label = `Chọn bài viết từ 10:0${i} 26 Tháng 11, 2026, bài viết`;
    let selected = initiallyChecked;
    let clicked = false;
    let present = true;
    const option = { ...node('Lựa chọn khác cho mục'), get isConnected() { return present || !removesRows; } };
    const checkbox = {
      ...node(label),
      getAttribute: (attribute: string) => {
        if (attribute === 'aria-label') return label;
        if (attribute === 'role') return roleCheckbox ? 'checkbox' : null;
        if (attribute !== 'aria-checked' || noAriaChecked) return null;
        return String(i === 0 && (mismatch === 'row' || (mismatch === 'after-toggle' && clicked)) ? !selected : selected);
      },
      get isConnected() { return present; },
      get checked() { return selected; },
      matches: (name: string) => !roleCheckbox && name === selector.input,
      click: () => { selected = !selected; clicked = true; events.push(`${i}:${selected}`); },
      get parentElement() { return box; },
    };
    const box = {
      ...node(),
      get isConnected() { return present || !removesRows; },
      parentElement: main,
      querySelectorAll: (name: string) => name === selector.check ? [checkbox] : [option],
    };
    return { checkbox, option, remove: () => { if (selected) present = false; } };
  });
  const attachedAndChecked = () => rows.filter(({ checkbox }) => checkbox.isConnected && checkbox.checked);
  const remove = {
    ...node(null, 'Gỡ'),
    getAttribute: (name: string) => name === 'role' ? 'button' : name === 'aria-disabled' ? String(!attachedAndChecked().length) : null,
    matches: (name: string) => name === selector.disabled && !attachedAndChecked().length,
    click: () => {
      assert.ok(attachedAndChecked().length, 'Remove must be enabled when clicked');
      events.push('Gỡ');
      dialogOpen = true;
    },
  };
  const header = {
    ...node(),
    getAttribute: (name: string) => {
      if (name !== 'aria-checked') return null;
      if (mismatch === 'header') return String(!header.checked);
      return header.indeterminate ? 'mixed' : String(header.checked);
    },
    get checked() { return rows.every(({ checkbox }) => checkbox.isConnected && checkbox.checked); },
    get indeterminate() { return attachedAndChecked().length === 1 && rows.every(({ checkbox }) => checkbox.isConnected); },
    matches: (name: string) => name === selector.input,
    get parentElement() { return headerWrappers; },
  };
  const headerBox = {
    ...node(null, 'Tất cảGỡ'), parentElement: main,
    querySelectorAll: (name: string) => {
      if (name === selector.check) return [header];
      if (name === selector.button) return [remove];
      return name === 'span, label' && !plainHeaderText ? [node(null, 'Tất cả')] : [];
    },
  };
  let headerWrappers = headerBox;
  for (let depth = 0; depth < 3; depth++) {
    headerWrappers = {
      ...node(), parentElement: headerWrappers,
      querySelectorAll: (name: string) => name === selector.check ? [header] : [],
    };
  }
  const confirm = {
    ...node('', confirmLabel),
    click: () => { events.push(confirmLabel); rows.forEach((row) => row.remove()); dialogOpen = false; },
  };
  const dialog = { ...node('', 'Xoá bình luận?'), querySelectorAll: (name: string) =>
    name === selector.button ? [node('', 'Huỷ'), confirm] : [] };
  main.querySelectorAll = (name) => {
    if (name.includes('[role="heading"]')) {
      return [node(null, category === 'comments' ? 'Bình luận' : 'Lượt thích và cảm xúc'), node(null, '26 Tháng 11, 2026')];
    }
    if (name === selector.check) return [header, ...rows.map((row) => row.checkbox).filter((check) => check.isConnected)];
    return name === selector.button ? [remove, ...rows.map((row) => row.option).filter((option) => option.isConnected)] : [];
  };
  const location = new URL('https://www.facebook.com/me/allactivity/');
  const globals = {
    location,
    document: {
      URL: location.href,
      querySelector: () => main,
      querySelectorAll: (name: string) => name === selector.dialogs && dialogOpen ? [dialog] : [],
    },
    getComputedStyle: () => ({ visibility: 'visible' }),
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : Reflect.deleteProperty(globalThis, key));
  }
  let tick = 0;
  t.mock.method(Date, 'now', () => tick += 4_000);
  t.mock.method(performance, 'now', () => tick += 500);
  const page = activityPages[category];
  const items = page.read(main as unknown as HTMLElement);
  assert.equal(items.length, 2);
  return {
    events,
    disabled: () => remove.getAttribute('aria-disabled') === 'true',
    checked: () => page.native!.checked(items[0]!),
    execute: () => page.native!.actBatch(items.slice(0, 1), new AbortController().signal),
  };
}

for (const category of ['comments', 'reactions'] as const) {
  test(`Activity Log uses the native inputs in ${category} and clicks the DIV once enabled`, async (t) => {
    const confirm = category === 'comments' ? 'Xoá' : 'Gỡ';
    const { disabled, checked, events, execute } = activityFixture(t, confirm, {
      category, initiallyChecked: false, plainHeaderText: category === 'reactions',
    });
    assert.equal(disabled(), true);
    assert.equal(checked(), false);
    assert.equal(await execute(), 'done');
    assert.deepEqual(events, ['0:true', 'Gỡ', confirm]);
  });
}

test('Activity Log reads the native checked property when aria-checked is absent', async (t) => {
  const { checked, events, execute } = activityFixture(t, 'Xoá', { noAriaChecked: true });
  assert.equal(checked(), true);
  assert.equal(await execute(), 'done');
  assert.deepEqual(events, ['1:false', 'Gỡ', 'Xoá']);
});

test('Activity Log also accepts ARIA row checkboxes', async (t) => {
  const { checked, events, execute } = activityFixture(t, 'Xoá', { roleCheckbox: true });
  assert.equal(checked(), true);
  assert.equal(await execute(), 'done');
  assert.deepEqual(events, ['1:false', 'Gỡ', 'Xoá']);
});

for (const mismatch of ['row', 'header', 'after-toggle'] as const) {
  test(`Activity Log stops before Remove on a native checked and ARIA mismatch (${mismatch})`, async (t) => {
    const { events, execute } = activityFixture(t, 'Xoá', { mismatch, initiallyChecked: false });
    assert.equal(await execute(), 'unidentified');
    assert.deepEqual(events, mismatch === 'after-toggle' ? ['0:true'] : []);
  });
}

test('Activity Log clears other selections before Remove and verifies the target row left', async (t) => {
  const { events, execute } = activityFixture(t, 'Xoá');
  assert.equal(await execute(), 'done');
  assert.deepEqual(events, ['1:false', 'Gỡ', 'Xoá']);
});

test('Activity Log leaves an unknown confirmation button untouched', async (t) => {
  const { events, execute } = activityFixture(t, 'Tiếp tục');
  assert.equal(await execute(), 'unidentified');
  assert.deepEqual(events, ['1:false', 'Gỡ']);
});

test('Activity Log cannot verify deletion when only the checkbox disappears', async (t) => {
  const { events, execute } = activityFixture(t, 'Xóa', { removesRows: false });
  assert.equal(await execute(), 'unverified');
  assert.deepEqual(events, ['1:false', 'Gỡ', 'Xóa']);
});
