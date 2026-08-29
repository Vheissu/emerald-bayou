import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldHeight } from '../src/heightfield.js';
import { regionAt } from '../src/regions.js';
import {
  NAVIGATION_AID_LIMITS,
  NavigationAids,
  ensureNavigationAidSave,
  navigationAidFlash,
  navigationAidsForCell,
  stormFailureDecision,
} from '../src/navigationaids.js';

const heightfield = new WorldHeight(7);
const context = { computeBase: (x, z, info) => heightfield.computeBase(x, z, info), regionAtFn: regionAt, seed: 7 };

function nearbyAids(x = 20, z = -120) {
  const cell = NAVIGATION_AID_LIMITS.cell, radius = Math.ceil(NAVIGATION_AID_LIMITS.streamRadius / cell), ci = Math.floor(x / cell), cj = Math.floor(z / cell), out = [];
  for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
    for (const aid of navigationAidsForCell(ci + dx, cj + dz, context)) if (Math.hypot(aid.x - x, aid.z - z) <= NAVIGATION_AID_LIMITS.streamRadius) out.push(aid);
  }
  return out;
}

test('seeded channel aids are deterministic and use the US lateral numbering convention', () => {
  const first = nearbyAids(), second = nearbyAids();
  assert.ok(first.length >= 12 && first.length <= NAVIGATION_AID_LIMITS.active);
  assert.deepEqual(second, first);
  for (const aid of first) {
    assert.equal(aid.number % 2, aid.side === 'red' ? 0 : 1);
    assert.ok(aid.number >= 1 && aid.number <= 998);
    assert.ok(heightfield.computeBase(aid.x, aid.z).h < -0.65);
    assert.ok(Math.max(Math.abs(aid.x), Math.abs(aid.z)) < 12800);
  }
});

test('placement rejects a channel edge occupied by another world object', () => {
  const aid = nearbyAids()[0]; assert.ok(aid);
  const blocked = navigationAidsForCell(aid.ci, aid.cj, { ...context, blockedAt: () => true });
  assert.deepEqual(blocked, []);
});

test('navigation light characteristics flash, dim and fail without allocating light objects', () => {
  assert.ok(navigationAidFlash(0.07, 4, 0, 'normal') > 0.99);
  assert.ok(navigationAidFlash(0.07, 4, 0, 'dim') < 0.43);
  assert.equal(navigationAidFlash(0.07, 4, 0, 'dark'), 0);
  assert.equal(navigationAidFlash(0.07, 4, 0, 'damaged'), 0);
  assert.equal(navigationAidFlash(1, 4, 0, 'normal'), 0);
});

test('storm failures are deterministic, bounded and guaranteed under hurricane force', () => {
  const a = stormFailureDecision('hurricane', 917, 8), b = stormFailureDecision('hurricane', 917, 8);
  assert.deepEqual(a, b); assert.ok(a); assert.ok(a.index >= 0 && a.index < 8);
  assert.ok(['off-station', 'damaged'].includes(a.state));
  assert.equal(stormFailureDecision('fair', 917, 8), null);
  assert.equal(stormFailureDecision('hurricane', 917, 0), null);
});

test('save normalization bounds damage and report history and keeps the latest record per aid', () => {
  const damage = [], reports = [];
  for (let index = 0; index < 24; index++) {
    damage.push({ id: `nav-${index}`, state: index % 2 ? 'dark' : 'off-station', dx: 99, dz: -99, tilt: 9, day: 2 });
    reports.push({ id: `nav-${index}`, number: index + 1, side: index % 2 ? 'red' : 'green', state: 'dark', x: index, z: -index, day: 2, hour: 8 });
  }
  damage.push({ id: 'nav-23', state: 'normal', day: 3 });
  const save = { navigationAids: { damage, reports, stats: { strikes: 4.8, reports: 3.2 } } }, journal = ensureNavigationAidSave(save);
  assert.equal(journal.damage.length, NAVIGATION_AID_LIMITS.damage); assert.equal(journal.reports.length, NAVIGATION_AID_LIMITS.reports);
  assert.equal(journal.damage.at(-1).id, 'nav-23'); assert.equal(journal.damage.at(-1).state, 'normal');
  assert.ok(journal.damage.every(record => Math.abs(record.dx) <= 18 && Math.abs(record.dz) <= 18 && Math.abs(record.tilt) <= 0.8));
  assert.equal(journal.stats.strikes, 4); assert.equal(journal.stats.reports, 3);
});

test('the live network is one bounded six-draw instanced pool with no point lights', () => {
  const previousWindow = globalThis.window; globalThis.window = { addEventListener() {} };
  try {
    const scene = new THREE.Scene(), phys = { pos: new THREE.Vector2(20, -120), speed: 0, addObs(key, list) { this.key = key; this.list = list; } };
    const prompt = { dataset: {}, innerHTML: '', classList: { add() {}, remove() {} } };
    const game = { save: {}, jobs: [], el: { prompt }, persist() {}, mapMarkers: [], tricks: { bust() {} } };
    const radio = {}, navigation = new NavigationAids({
      scene, terrain: { hf: heightfield }, world: { blockedAt: () => false }, water: { waveHeight: () => 0 }, phys, game, radio,
      audio: {}, environment: { key: 'fair', values: { sea: 0, storm: 0 }, hour: 12, restrictedVisibility: 0, minutes: 0, day: 1 },
      currents: { flowAt(x, z, out) { return out.set(0, 0); } }, regions: {}, law: {}, reputation: {}, condition: {},
    });
    const stats = navigation.resourceStats(); let lights = 0, instanced = 0;
    navigation.root.traverse(object => { if (object.isLight) lights++; if (object.isInstancedMesh) instanced++; });
    assert.equal(stats.drawCalls, NAVIGATION_AID_LIMITS.drawCalls); assert.equal(instanced, 6); assert.equal(lights, 0);
    assert.ok(stats.active > 0 && stats.active <= NAVIGATION_AID_LIMITS.active); assert.equal(phys.key, 'navigation-aids'); assert.equal(phys.list, navigation.obs);
  } finally { globalThis.window = previousWindow; }
});
