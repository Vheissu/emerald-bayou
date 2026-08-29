import test from 'node:test';
import assert from 'node:assert/strict';
import { canEscapePursuit, pursuitLostDistance, pursuitLostTime, pursuitSpeed, wantedLevel } from '../src/pursuit.js';

test('maps attention to one through five visible wanted stars', () => {
  assert.equal(wantedLevel(0), 0); assert.equal(wantedLevel(0.05), 1); assert.equal(wantedLevel(1), 1);
  assert.equal(wantedLevel(1.01), 2); assert.equal(wantedLevel(4.2), 5); assert.equal(wantedLevel(99), 5);
});

test('patrol pursuit can catch a fast player without unbounded speed', () => {
  assert.ok(pursuitSpeed(2.4, 15) > 15);
  assert.ok(pursuitSpeed(4.8, 18) > 18);
  assert.equal(pursuitSpeed(5, 40), 19.5);
});

test('fog and storms shorten visual range while higher heat widens the search', () => {
  assert.ok(pursuitLostDistance(4, 0, 0) > pursuitLostDistance(1, 0, 0));
  assert.ok(pursuitLostDistance(3, 0.9, 0.8) < pursuitLostDistance(3, 0, 0));
  assert.ok(pursuitLostTime(3, 0.9) < pursuitLostTime(3, 0));
});

test('escape requires both a minimum chase and sustained loss of visual', () => {
  const need = pursuitLostTime(2, 0.4);
  assert.equal(canEscapePursuit(2, 10, need + 1, 0.4), false);
  assert.equal(canEscapePursuit(2, 30, need - 0.1, 0.4), false);
  assert.equal(canEscapePursuit(2, 30, need + 0.1, 0.4), true);
});
