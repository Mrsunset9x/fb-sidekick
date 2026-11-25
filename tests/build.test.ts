import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-ignore JavaScript build tooling is tested through its public behavior.
import { BuildGate } from '../scripts/build-gate.mjs';

test('build stamp waits for every bundle, stays blocked after failure, and rejects stale publication', () => {
  const gate = new BuildGate(2);
  const ok = (path: string) => ({ errors: [], outputFiles: [{ path, contents: new Uint8Array() }] });
  gate.start(0);
  gate.finish(0, ok('content.js'));
  assert.equal(gate.snapshot(), null, 'background has not built yet');
  gate.start(1);
  gate.finish(1, ok('background.js'));
  const initial = gate.snapshot();
  assert.equal(initial.files.length, 2);
  assert.equal(gate.isCurrent(initial), true);
  gate.start(0);
  assert.equal(gate.snapshot(), null);
  assert.equal(gate.isCurrent(initial), false);
  gate.finish(0, { errors: ['syntax error'], outputFiles: [] });
  gate.start(1);
  gate.finish(1, ok('background.js'));
  assert.equal(gate.snapshot(), null, 'another successful bundle must not publish a broken build');
  gate.start(0);
  gate.finish(0, ok('content.js'));
  assert.equal(gate.snapshot().files.length, 2);
});
