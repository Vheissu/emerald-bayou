import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canEscapePursuit, pursuitAviationAvailable, pursuitAviationDelay, pursuitAviationVisualHeld, pursuitAviationVisualRange,
  pursuitBackupDelay, pursuitChannelClosurePlan, pursuitLostDistance, pursuitLostTime, pursuitSightSampleCount, pursuitSpeed,
  pursuitSirenLevel, pursuitSurfaceLineOfSight, pursuitTactic, pursuitUnitCanRam, pursuitUnitCount, pursuitVisualHeld, wantedLevel,
} from '../src/pursuit.js';

test('maps attention to one through five visible wanted stars', () => {
  assert.equal(wantedLevel(0), 0); assert.equal(wantedLevel(0.05), 1); assert.equal(wantedLevel(1), 1);
  assert.equal(wantedLevel(1.01), 2); assert.equal(wantedLevel(4.2), 5); assert.equal(wantedLevel(99), 5);
});

test('patrol pursuit can catch a fast player without unbounded speed', () => {
  assert.ok(pursuitSpeed(2.4, 15) > 15);
  assert.ok(pursuitSpeed(4.8, 18) > 18);
  assert.equal(pursuitSpeed(5, 40), 19.5);
});

test('wanted escalation adds a bounded number of physical patrol units', () => {
  assert.equal(pursuitUnitCount(0), 0); assert.equal(pursuitUnitCount(1), 1);
  assert.equal(pursuitUnitCount(2), 2); assert.equal(pursuitUnitCount(3), 2);
  assert.equal(pursuitUnitCount(4), 3); assert.equal(pursuitUnitCount(99), 3);
  assert.equal(pursuitBackupDelay(0, 1), Infinity);
  assert.ok(pursuitBackupDelay(0, 5) < pursuitBackupDelay(0, 2));
  assert.equal(pursuitBackupDelay(1, 3), Infinity); assert.equal(pursuitBackupDelay(1, 5), 9.5);
});

test('aviation is a delayed five-star response and will not launch into unsafe weather', () => {
  assert.equal(pursuitAviationAvailable(4, 8, 0), false);
  assert.equal(pursuitAviationDelay(4, 8, 0), Infinity);
  assert.equal(pursuitAviationAvailable(5, 12, 0.3), true);
  assert.equal(pursuitAviationDelay(5, 12, 0.3), 9.5);
  assert.equal(pursuitAviationAvailable(5, 24, 0.2), false);
  assert.equal(pursuitAviationAvailable(5, 12, 0.8), false);
});

test('aviation has finite region and weather visibility with a narrow searchlight reacquisition', () => {
  const prairie = pursuitAviationVisualRange(5, 0, 0, 'prairie');
  const cypress = pursuitAviationVisualRange(5, 0, 0, 'cypress');
  assert.ok(prairie > cypress);
  assert.ok(pursuitAviationVisualRange(5, 0.8, 0.6, 'cypress') < cypress);
  assert.equal(pursuitAviationVisualRange(4, 0, 0, 'broad'), 0);
  assert.equal(pursuitAviationVisualHeld(prairie - 1, Infinity, 5, 0, 0, 'prairie'), true);
  assert.equal(pursuitAviationVisualHeld(prairie + 1, Infinity, 5, 0, 0, 'prairie'), false);
  assert.equal(pursuitAviationVisualHeld(Infinity, 12, 5, 0.8, 0.6, 'cypress'), true);
  assert.equal(pursuitAviationVisualHeld(Infinity, 30, 5, 0, 0, 'prairie'), false);
  assert.equal(pursuitAviationVisualHeld(20, 2, 5, 0, 0, 'prairie', false), false);
});

test('backup patrols intercept from opposing sides without all ramming at low heat', () => {
  const right = pursuitTactic(1, 4, 80, 1), left = pursuitTactic(2, 4, 80, 1);
  assert.ok(right.fore > 20 && right.side > 0); assert.ok(left.fore > 10 && left.side < 0);
  assert.equal(pursuitUnitCanRam(0, 2), true); assert.equal(pursuitUnitCanRam(1, 2), false); assert.equal(pursuitUnitCanRam(1, 3), true);
});

test('the third patrol boat forms a bounded high-wanted channel closure with counterplay', () => {
  const four = pursuitChannelClosurePlan(2, 4, 120, 12, true), five = pursuitChannelClosurePlan(2, 5, 120, 18, true);
  assert.equal(four.eligible, true); assert.ok(four.lead >= 84 && four.lead <= 124); assert.ok(four.approachSpeed <= 19.5); assert.ok(four.setupTimeout >= 10 && four.setupTimeout <= 22);
  assert.ok(five.lead > four.lead); assert.ok(five.duration > four.duration); assert.ok(five.cooldown < four.cooldown);
  assert.equal(pursuitChannelClosurePlan(1, 5, 120, 12, true).eligible, false);
  assert.equal(pursuitChannelClosurePlan(2, 3, 120, 12, true).eligible, false);
  assert.equal(pursuitChannelClosurePlan(2, 5, 20, 12, true).eligible, false);
  assert.equal(pursuitChannelClosurePlan(2, 5, 120, 3, true).eligible, false);
  assert.equal(pursuitChannelClosurePlan(2, 5, 120, 12, false).eligible, false);
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

test('any nearby active unit holds visual during a coordinated pursuit', () => {
  assert.equal(pursuitVisualHeld(74, 180), true);
  assert.equal(pursuitVisualHeld(74, 180, false), false);
  assert.equal(pursuitVisualHeld(181, 180), false);
  assert.equal(pursuitVisualHeld(Infinity, 180), false);
});

test('emergent banks break surface visual while submerged bars do not', () => {
  const open = { heightAt: () => -2 };
  const submerged = { heightAt: x => x > 42 && x < 58 ? -0.18 : -2 };
  const island = { heightAt: x => x > 42 && x < 58 ? 0.12 : -2 };
  assert.equal(pursuitSurfaceLineOfSight(open, 0, 0, 100, 0, 0), true);
  assert.equal(pursuitSurfaceLineOfSight(submerged, 0, 0, 100, 0, 0), true);
  assert.equal(pursuitSurfaceLineOfSight(island, 0, 0, 100, 0, 0), false);
  assert.equal(pursuitSurfaceLineOfSight(island, 0, 0, 12, 0, 0), true);
  assert.ok(pursuitSightSampleCount(275) <= 20); assert.ok(pursuitSightSampleCount(30) >= 3);
});

test('patrol siren is distance driven, heat aware, and silent outside pursuit', () => {
  assert.equal(pursuitSirenLevel(20, 1, false), 0);
  assert.equal(pursuitSirenLevel(Infinity, 5), 0);
  assert.equal(pursuitSirenLevel(520, 5), 0);
  assert.ok(pursuitSirenLevel(45, 5) > pursuitSirenLevel(220, 5));
  assert.ok(pursuitSirenLevel(90, 5) > pursuitSirenLevel(90, 1));
  assert.ok(pursuitSirenLevel(0, 99) <= 1);
});
