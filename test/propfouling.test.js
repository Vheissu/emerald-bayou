import test from 'node:test';
import assert from 'node:assert/strict';
import { cageFoulingImpact, cageFoulingPower, cageFoulingStep } from '../src/propfouling.js';

test('only hazards that can reach an air prop foul its cage', () => {
  assert.equal(cageFoulingImpact('log', 12, false), 0);
  assert.equal(cageFoulingImpact('monofilament net', 12, false), 0);
  assert.equal(cageFoulingImpact('storm-debris', 12, false), 0);
  assert.ok(cageFoulingImpact('snag', 8, false) > 0.25);
  assert.ok(cageFoulingImpact('storm-debris', 8, true) > 0.35);
});

test('a wrapped cage progressively chokes propulsion and a near seizure stalls it', () => {
  assert.equal(cageFoulingPower(0), 1);
  assert.ok(cageFoulingPower(0.45) < 0.55);
  assert.ok(cageFoulingPower(0.8) < cageFoulingPower(0.45));
  assert.equal(cageFoulingPower(0.97), 0);
});

test('cutting works only with the prop settled while throttle abuse tightens the wrap', () => {
  const out = {};
  let fouling = 0.48, progress = 0;
  for (let i = 0; i < 360; i++) {
    const result = cageFoulingStep(fouling, progress, { dt: 1 / 60, throttle: 0, rpm: 0.2, speed: 1.1, cutting: true }, out);
    fouling = result.fouling; progress = result.progress;
    if (result.cleared) break;
  }
  assert.equal(fouling, 0); assert.equal(progress, 0); assert.equal(out.cleared, true);

  const unsafe = cageFoulingStep(0.48, 0.3, { dt: 0.1, throttle: 0.9, rpm: 0.92, speed: 8, cutting: true }, out);
  assert.equal(unsafe, out);
  assert.equal(unsafe.ready, false); assert.ok(unsafe.progress < 0.3); assert.ok(unsafe.fouling > 0.48); assert.ok(unsafe.engineWear > 0);
});
