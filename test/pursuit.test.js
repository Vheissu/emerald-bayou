import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canEscapePursuit, pursuitAviationAvailable, pursuitAviationDelay, pursuitAviationVisualHeld, pursuitAviationVisualRange,
  pursuitBackupDelay, pursuitChannelClosurePlan, pursuitEngineNoise, pursuitHearingRange, pursuitHornRange, pursuitLostDistance,
  pursuitLostProgress, pursuitLostTime, pursuitSearchPlan, pursuitSearchlightPlan, pursuitSearchlightVisualHeld, pursuitSearchRadius, pursuitSightSampleCount, pursuitSoundContact, pursuitSoundUncertainty, pursuitSpeed,
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

test('fog, storms, and darkness shorten visual range while moonlight restores some detail', () => {
  assert.ok(pursuitLostDistance(4, 0, 0) > pursuitLostDistance(1, 0, 0));
  assert.ok(pursuitLostDistance(3, 0.9, 0.8) < pursuitLostDistance(3, 0, 0));
  const daylight = pursuitLostDistance(1, 0, 0, 0, 0), moonlit = pursuitLostDistance(1, 0, 0, 1, 1), moonless = pursuitLostDistance(1, 0, 0, 1, 0);
  assert.ok(daylight > moonlit); assert.ok(moonlit > moonless);
  assert.ok(pursuitLostDistance(1, 0.8, 0.7, 1, 0) < moonless);
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

test('surface patrols can hear a working airboat without hearing quiet idle through a bank', () => {
  const idle = pursuitEngineNoise(0.18, 0, 0, 1), working = pursuitEngineNoise(0.72, 9, 0.65, 1), full = pursuitEngineNoise(1, 14, 1, 1);
  assert.equal(idle, 0); assert.ok(working > 0.4); assert.ok(full > working && full <= 1);
  const open = pursuitHearingRange(full, 3, 3, 0, 0, false), banked = pursuitHearingRange(full, 3, 3, 0, 0, true), storm = pursuitHearingRange(full, 3, 30, 1, 1, true);
  assert.ok(open > banked); assert.ok(banked > storm); assert.equal(pursuitHearingRange(idle, 5), 0);
  assert.equal(pursuitSoundContact(banked, banked), true); assert.equal(pursuitSoundContact(banked + 0.01, banked), false);
});

test('horn blasts carry farther than prop noise but still yield only an uncertain bearing', () => {
  const short = pursuitHornRange(false, 3, 0, 0, true), prolonged = pursuitHornRange(true, 3, 0, 0, true), masked = pursuitHornRange(true, 32, 1, 1, true);
  assert.ok(prolonged > short); assert.ok(masked < prolonged);
  assert.ok(pursuitSoundUncertainty('engine', 0.8) < pursuitSoundUncertainty('engine', 0.2));
  assert.ok(pursuitSoundUncertainty('fog horn', 0.5) > 0);
});

test('visual rapidly clears lost time while a rough sound contact only pauses escape progress', () => {
  assert.ok(Math.abs(pursuitLostProgress(3, 1, true, false) - 0.8) < 1e-9);
  assert.equal(pursuitLostProgress(3, 1, false, true), 3);
  assert.equal(pursuitLostProgress(3, 1, false, false), 4);
});

test('the last-fix search area expands with uncertainty without becoming unbounded', () => {
  const freshOneStar = pursuitSearchRadius(1, 0), freshFiveStar = pursuitSearchRadius(5, 0), lost = pursuitSearchRadius(3, 7);
  assert.ok(freshFiveStar > freshOneStar); assert.ok(lost > freshFiveStar);
  assert.ok(pursuitSearchRadius(5, 999) <= 165);
  const soundFix = pursuitSearchRadius(3, 7, true, 12, 0), staleSoundFix = pursuitSearchRadius(3, 7, true, 12, 3);
  assert.ok(soundFix < lost); assert.ok(staleSoundFix > soundFix); assert.ok(staleSoundFix <= 84);
});

test('surface units divide the visible search area into retained inner, route, and perimeter sectors', () => {
  const inner = pursuitSearchPlan(0, 4, 8, 0.35, 12, 100, -50);
  const route = pursuitSearchPlan(1, 4, 8, 0.35, 12, 100, -50);
  const perimeter = pursuitSearchPlan(2, 4, 8, 0.35, 12, 100, -50);
  assert.deepEqual([inner.sector, route.sector, perimeter.sector], ['inner fix', 'probable route', 'outer exits']);
  assert.ok(inner.radius < route.radius && route.radius < perimeter.radius);
  for (const plan of [inner, route, perimeter]) {
    assert.ok(plan.radius <= plan.areaRadius); assert.ok(plan.speed >= 7.5 && plan.speed <= 12);
    assert.ok(Math.abs(Math.hypot(plan.targetX - 100, plan.targetZ + 50) - plan.radius) < 1e-9);
  }
  assert.ok(perimeter.radius > perimeter.areaRadius * 0.72);

  const eastbound = pursuitSearchPlan(1, 4, 8, Math.PI / 2, 12, 100, -50);
  assert.ok(Math.abs(route.radius - eastbound.radius) < 1e-9);
  assert.notDeepEqual([route.targetX, route.targetZ], [eastbound.targetX, eastbound.targetZ]);

  const retained = {};
  assert.equal(pursuitSearchPlan(2, 4, 8, 0.35, 12, 100, -50, true, 12, 0, retained), retained);
  assert.ok(retained.areaRadius < perimeter.areaRadius); assert.ok(retained.radius < perimeter.radius);

  for (let elapsed = 0; elapsed <= 240; elapsed += 7) {
    const innerSweep = pursuitSearchPlan(0, 5, 20, 0.7, elapsed, 0, 0);
    const routeSweep = pursuitSearchPlan(1, 5, 20, 0.7, elapsed, 0, 0);
    const perimeterSweep = pursuitSearchPlan(2, 5, 20, 0.7, elapsed, 0, 0);
    assert.ok(innerSweep.radius < routeSweep.radius && routeSweep.radius < perimeterSweep.radius);
    assert.ok(perimeterSweep.radius <= perimeterSweep.areaRadius);
  }
});

test('pursuit searchlights lock visual targets and sweep assigned sectors only when conditions need them', () => {
  assert.equal(pursuitSearchlightPlan(true, 12, 0, 0, true, 0, 0, 0, 0, 10, 0, 4).active, false);
  assert.equal(pursuitSearchlightPlan(false, 23, 1, 1, true, 0, 0, 0, 0, 10, 0, 4).active, false);

  const night = pursuitSearchlightPlan(true, 23, 0, 0, true, 0, 0, 0, 0, 10, 0, 4);
  assert.equal(night.active, true); assert.equal(night.worldLight, true); assert.ok(Math.abs(night.worldHeading + Math.PI / 2) < 1e-9); assert.ok(night.intensity > 0);
  const backup = pursuitSearchlightPlan(true, 23, 0, 0, true, 1, 0, 0, 0, 10, 0, 4);
  assert.equal(backup.active, true); assert.equal(backup.worldLight, false); assert.equal(backup.intensity, 0);

  const clearSearch = pursuitSearchlightPlan(true, 23, 0, 0, false, 1, 0, 0, 0, 0, -50, 14);
  const outerSearch = pursuitSearchlightPlan(true, 23, 0, 0, false, 2, 0, 0, 0, 0, -50, 14);
  assert.notEqual(clearSearch.worldHeading, outerSearch.worldHeading);
  assert.ok(Math.abs(clearSearch.relativeHeading) <= Math.PI && Math.abs(outerSearch.relativeHeading) <= Math.PI);

  const fog = pursuitSearchlightPlan(true, 12, 0.8, 0.2, false, 0, 0, 0, 0, 0, -50, 14);
  const storm = pursuitSearchlightPlan(true, 12, 0.8, 0.9, false, 0, 0, 0, 0, 0, -50, 14);
  assert.equal(fog.active, true); assert.equal(storm.active, true); assert.ok(storm.length < fog.length); assert.ok(storm.intensity < fog.intensity);
  const retained = {}; assert.equal(pursuitSearchlightPlan(true, 23, 0, 0, true, 0, 0, 0, -Math.PI / 2, 10, 0, 4, retained), retained);
  assert.ok(Math.abs(retained.relativeHeading) < 1e-9);
});

test('surface searchlights reacquire only inside their weather-limited cone', () => {
  assert.equal(pursuitSearchlightVisualHeld(120, 0.08, 0, 0, true), true);
  assert.equal(pursuitSearchlightVisualHeld(146, 0, 0, 0, true), false);
  assert.equal(pursuitSearchlightVisualHeld(120, 0.2, 0, 0, true), false);
  assert.equal(pursuitSearchlightVisualHeld(120, Math.PI * 2 + 0.08, 0, 0, true), true);
  assert.equal(pursuitSearchlightVisualHeld(120, 0, 0.8, 0.9, true), false);
  assert.equal(pursuitSearchlightVisualHeld(20, 0, 0, 0, false), false);
  assert.equal(pursuitSearchlightVisualHeld(-1, 0, 0, 0, true), false);
});

test('patrol siren is distance driven, heat aware, and silent outside pursuit', () => {
  assert.equal(pursuitSirenLevel(20, 1, false), 0);
  assert.equal(pursuitSirenLevel(Infinity, 5), 0);
  assert.equal(pursuitSirenLevel(520, 5), 0);
  assert.ok(pursuitSirenLevel(45, 5) > pursuitSirenLevel(220, 5));
  assert.ok(pursuitSirenLevel(90, 5) > pursuitSirenLevel(90, 1));
  assert.ok(pursuitSirenLevel(0, 99) <= 1);
});
