import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SHIFT_WAKE_COMPLAINTS, wakeConsequence, wakeSeverity } from '../src/wakeconduct.js';

test('only fragile or working craft object to a wake that actually reaches them', () => {
  assert.equal(wakeSeverity({ kind: 'john', working: false, playerSpeed: 12, wakeHeight: 0.2 }), 0);
  assert.equal(wakeSeverity({ kind: 'canoe', playerSpeed: 3.9, wakeHeight: 0.08 }), 0);
  assert.equal(wakeSeverity({ kind: 'canoe', playerSpeed: 5, wakeHeight: 0.011 }), 0);
  assert.equal(wakeSeverity({ kind: 'john', working: true, playerSpeed: 5, wakeHeight: 0.024 }), 1);
});

test('distinguishes a dangerous wake from an ordinary warning', () => {
  assert.equal(wakeSeverity({ kind: 'canoe', playerSpeed: 4.2, wakeHeight: 0.013 }), 1);
  assert.equal(wakeSeverity({ kind: 'canoe', playerSpeed: 8, wakeHeight: 0.03 }), 2);
  assert.equal(wakeSeverity({ kind: 'john', working: true, playerSpeed: 9, wakeHeight: 0.05 }), 2);
});

test('first mild offense is a warning while repeat or severe conduct is reported', () => {
  const warning = wakeConsequence({ severity: 1, shiftComplaints: 1, previousComplaints: 0 });
  assert.equal(warning.reported, false); assert.equal(warning.attention, 0); assert.equal(warning.reputation, -0.08);
  assert.equal(wakeConsequence({ severity: 1, shiftComplaints: 2, previousComplaints: 1 }).reported, true);
  assert.equal(wakeConsequence({ severity: 1, shiftComplaints: 1, previousComplaints: 1 }).reported, true);
  assert.equal(wakeConsequence({ severity: 2, shiftComplaints: 1, previousComplaints: 0 }).reported, true);
});

test('enforcement reports carry more attention and state stays bounded per shift', () => {
  const local = wakeConsequence({ severity: 2, shiftComplaints: 1, previousComplaints: 20 });
  const enforcement = wakeConsequence({ severity: 2, shiftComplaints: 1, previousComplaints: 20, enforcementCrew: true });
  assert.ok(enforcement.attention > local.attention); assert.ok(enforcement.attention <= 0.78);
  assert.equal(MAX_SHIFT_WAKE_COMPLAINTS, 2);
});
