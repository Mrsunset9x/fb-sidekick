import assert from 'node:assert/strict';
import test from 'node:test';
import { BackgroundPause, canPause, type PauseConditions } from '../src/content/pause';

const base: PauseConditions = { enabled: true, hidden: true, notifying: 0, view: 'contacts', busy: false };

test('pauses only a hidden contacts view with the setting on, no alerts and nothing in progress', () => {
  assert.equal(canPause(base), true);
  assert.equal(canPause({ ...base, enabled: false }), false);
  assert.equal(canPause({ ...base, hidden: false }), false);
  assert.equal(canPause({ ...base, notifying: 1 }), false);
  assert.equal(canPause({ ...base, view: 'inbox' }), false);
  assert.equal(canPause({ ...base, busy: true }), false);
});

function harness(t: test.TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const target = new EventTarget();
  const state = { ...base };
  const calls: string[] = [];
  const pause = new BackgroundPause({
    conditions: () => canPause(state),
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
    delay: 1000,
    target,
  });
  const visibility = (hidden: boolean) => {
    state.hidden = hidden;
    target.dispatchEvent(new Event('visibilitychange'));
  };
  return { pause, state, calls, visibility, tick: (ms: number) => t.mock.timers.tick(ms) };
}

test('unloads after the delay and reloads when the tab is shown', (t) => {
  const { pause, calls, visibility, tick } = harness(t);
  visibility(false);
  pause.start();
  visibility(true);
  tick(999);
  assert.deepEqual(calls, []);
  tick(1);
  assert.deepEqual(calls, ['pause']);
  assert.equal(pause.paused, true);
  visibility(false);
  assert.deepEqual(calls, ['pause', 'resume']);
  assert.equal(pause.paused, false);
});

test('coming back before the delay cancels the pause', (t) => {
  const { pause, calls, visibility, tick } = harness(t);
  visibility(true);
  pause.start();
  tick(500);
  visibility(false);
  tick(5000);
  assert.deepEqual(calls, []);
});

test('turning on an alert while paused reloads the frame, and stop() leaves nothing armed', (t) => {
  const { pause, state, calls, tick } = harness(t);
  pause.start();
  tick(1000);
  assert.deepEqual(calls, ['pause']);
  state.notifying = 1;
  pause.evaluate();
  assert.deepEqual(calls, ['pause', 'resume']);
  state.notifying = 0;
  pause.evaluate();
  pause.stop();
  tick(5000);
  assert.deepEqual(calls, ['pause', 'resume']);
});

test('a condition that stops holding when the timer fires prevents the pause', (t) => {
  const { pause, state, calls, tick } = harness(t);
  pause.start();
  state.busy = true; // changed without evaluate(), as a delete starting would before it settles
  tick(1000);
  assert.deepEqual(calls, []);
  assert.equal(pause.paused, false);
});
