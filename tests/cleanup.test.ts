import assert from 'node:assert/strict';
import test from 'node:test';
import { runBulk, type ActOutcome, type Pace, type Progress } from '../src/cleanup/runner';
import { isBlockedText } from '../src/cleanup/dom';

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
