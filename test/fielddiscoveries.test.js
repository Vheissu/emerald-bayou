import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FIELD_DISCOVERIES,
  eligibleFieldDiscoveries,
  ensureDiscoverySave,
  fieldDiscoveryEligible,
  findFieldDiscoverySite,
  observationStep,
} from '../src/discoveries.js';

const conditions = overrides => ({ region: 'rookery', hour: 6.4, day: 2, waterLevel: -0.2, tideRate: -0.04, storm: 0.1, rain: 0.05, wind: 4, ...overrides });

test('ties each rare field sign to its real time, tide and region window', () => {
  assert.equal(fieldDiscoveryEligible('roseate-roost', conditions()), true);
  assert.equal(fieldDiscoveryEligible('roseate-roost', conditions({ hour: 12.5 })), false);
  assert.equal(fieldDiscoveryEligible('roseate-roost', conditions({ region: 'broad' })), false);

  const sawfish = conditions({ region: 'mangrove', hour: 18.2, waterLevel: 0.08, tideRate: 0.08 });
  assert.equal(fieldDiscoveryEligible('tagged-sawfish', sawfish), true);
  assert.equal(fieldDiscoveryEligible('tagged-sawfish', { ...sawfish, tideRate: -0.01 }), false);

  const wreck = conditions({ region: 'cypress', waterLevel: -0.22, tideRate: -0.08 });
  assert.equal(fieldDiscoveryEligible('logging-skiff', wreck), true);
  assert.equal(fieldDiscoveryEligible('logging-skiff', { ...wreck, waterLevel: 0.02 }), false);
});

test('completed and same-day failed discoveries stay out of the candidate pool', () => {
  const snapshot = conditions();
  assert.deepEqual(eligibleFieldDiscoveries(snapshot).map(entry => entry.id), ['roseate-roost']);
  assert.deepEqual(eligibleFieldDiscoveries(snapshot, ['roseate-roost']), []);
  assert.deepEqual(eligibleFieldDiscoveries(snapshot, [], ['roseate-roost']), []);
});

test('quiet observation builds progress while speed, range and wake bleed it away', () => {
  const roost = FIELD_DISCOVERIES.find(entry => entry.id === 'roseate-roost');
  let state = observationStep(roost, { distance: 36, speedMph: 3.2, wake: 0.005, dt: 4, progress: 0 });
  assert.equal(state.qualifies, true); assert.equal(state.progress, 4); assert.equal(state.complete, false);
  state = observationStep(roost, { distance: 36, speedMph: 3.2, wake: 0.026, dt: 1, progress: state.progress });
  assert.equal(state.qualifies, false); assert.ok(state.progress < 4);
  state = observationStep(roost, { distance: 36, speedMph: 2, wake: 0, dt: 8, progress: state.progress });
  assert.equal(state.complete, true); assert.equal(state.progress, roost.hold);

  assert.equal(observationStep('tagged-sawfish', { distance: 8, speedMph: 2, dt: 2, progress: 4 }).qualifies, false);
});

test('normalizes the bounded discovery journal without retaining unknown ids', () => {
  const save = { discoveries: { found: ['roseate-roost', 'roseate-roost', 'future-id'], records: { 'roseate-roost': { day: 2 } }, missed: { 'tagged-sawfish': { day: 1 } } } };
  const journal = ensureDiscoverySave(save);
  assert.deepEqual(journal.found, ['roseate-roost']);
  assert.equal(journal.records['roseate-roost'].day, 2);
  assert.equal(journal.missed['tagged-sawfish'].day, 1);
});

test('places a roost on shallow water ahead without creating a fixed world landmark', () => {
  const position = new THREE.Vector2(-6900, 6700);
  const context = {
    phys: {
      pos: position,
      forward(out) { return out.set(0, -1); },
      right(out) { return out.set(1, 0); },
    },
    terrain: { heightAt: () => -0.25 },
    world: { blockedAt: () => false },
    environment: { waterLevel: 0 },
  };
  const site = findFieldDiscoverySite('roseate-roost', context, false, () => 0.5);
  assert.ok(site); assert.equal(site.x, position.x); assert.ok(site.z < position.y); assert.equal(site.ground, -0.25);
});
