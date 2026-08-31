import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  FISHING_LIMITS,
  FISH_SPECIES,
  Fishing,
  alligatorFightStep,
  ensureFishingSave,
  fishingBitePotential,
  fishingFightStep,
  fishingSpeciesWeights,
  selectFishingSpecies,
} from '../src/fishing.js';

const goodWater = overrides => ({
  regionId: 'mangrove', depth: 2.2, boatSpeed: 0, storm: 0, rain: 0, wind: 3, fishActivity: 1.25,
  currentSpeed: 0.18, settleSeconds: 12, hour: 6.55, tideRate: 0.2, ...overrides,
});

test('bite quality follows quiet water, light, tide, depth and dangerous weather', () => {
  const dawn = fishingBitePotential(goodWater());
  const middaySlack = fishingBitePotential(goodWater({ hour: 13, tideRate: 0, currentSpeed: 0.01 }));
  const recentWash = fishingBitePotential(goodWater({ settleSeconds: 0 }));
  assert.ok(dawn > 0.8); assert.ok(middaySlack < dawn * 0.5); assert.ok(recentWash < dawn * 0.55);
  assert.equal(fishingBitePotential(goodWater({ storm: 1, wind: 36, rain: 1 })), 0);
  assert.equal(fishingBitePotential(goodWater({ depth: 0.3 })), 0);
  assert.equal(fishingBitePotential(goodWater({ boatSpeed: 2 })), 0);
});

test('freshwater backwaters and estuarine reaches draw from different native fish tables', () => {
  const backwater = fishingSpeciesWeights({ regionId: 'blackwater', depth: 1.5, murk: 0.9, hour: 7, tideRate: 0.1 });
  assert.ok(backwater.bowfin > backwater['florida-bass']);
  assert.equal(backwater['common-snook'], 0); assert.equal(backwater['juvenile-tarpon'], 0); assert.equal(backwater['red-drum'], 0);
  const estuary = fishingSpeciesWeights({ regionId: 'broad', depth: 2.5, murk: 0.1, hour: 19, tideRate: 0.2 });
  assert.ok(estuary['common-snook'] > 0 && estuary['juvenile-tarpon'] > 0 && estuary['red-drum'] > 0);
  assert.equal(estuary['florida-bass'], 0); assert.equal(estuary.bluegill, 0); assert.equal(estuary.bowfin, 0);
  assert.equal(selectFishingSpecies({ regionId: 'broad', depth: 0.7 }, () => 0.5).id, 'red-drum');
});

test('line tension rewards giving a powerful fish line during its runs', () => {
  const simulate = (power, policy) => {
    const state = { runT: 0, restT: 0.5, runStrength: 1, distance: 18, lineLimit: 42, stamina: 1, tension: 0.35, strain: 0, slack: 0 };
    let outcome = '', frames = 0;
    for (; frames < 60 * 45 && !outcome; frames++) outcome = fishingFightStep(state, { dt: 1 / 60, reeling: policy(state), power }, () => 0.5);
    return { state, outcome, seconds: frames / 60 };
  };
  const heldTarpon = simulate(1, () => true), managedTarpon = simulate(1, state => state.tension < 0.82), bluegill = simulate(0.25, () => true);
  assert.equal(heldTarpon.outcome, 'snapped'); assert.ok(heldTarpon.seconds < 2);
  assert.equal(managedTarpon.outcome, 'landed'); assert.ok(managedTarpon.seconds > 10 && managedTarpon.seconds < 30);
  assert.equal(bluegill.outcome, 'landed'); assert.ok(bluegill.seconds < managedTarpon.seconds);
});

test('an old bull tows the hull unless the player gives line during each run', () => {
  const simulate = policy => {
    const state = { runT: 1.15, restT: 1.2, runStrength: 1.18, distance: 16, lineLimit: 58, stamina: 1, tension: 0.46, strain: 0, slack: 0, fightT: 0, pull: 1 };
    let outcome = '', frames = 0;
    for (; frames < 60 * 60 && !outcome; frames++) outcome = alligatorFightStep(state, { dt: 1 / 60, reeling: policy(state), power: 1.55 }, () => 0.5);
    return { state, outcome, seconds: frames / 60 };
  };
  const lockedDrag = simulate(() => true), managed = simulate(state => state.runT <= 0 && state.tension < 0.82);
  assert.equal(lockedDrag.outcome, 'snapped'); assert.ok(lockedDrag.seconds < 2);
  assert.equal(managed.outcome, 'alongside'); assert.ok(managed.seconds > 20 && managed.seconds < 40); assert.ok(managed.state.stamina < 0.25);
});

test('save normalization keeps known species and a twelve-entry catch ledger only', () => {
  const recent = [];
  for (let index = 0; index < 20; index++) recent.push({ species: FISH_SPECIES[index % FISH_SPECIES.length].id, lengthIn: 20 + index, region: `Region ${index}`, day: index, hour: 7.5 });
  recent.splice(3, 0, { species: 'future-fish', lengthIn: 999, region: 'unknown' });
  const save = { fishing: { total: 2, released: 4.9, missed: -3, snapped: 2.2, gatorLosses: 3.8, gatorHooks: 6.4, species: { 'florida-bass': { caught: 7.8, bestIn: 99 }, 'future-fish': { caught: 99 } }, recent } };
  const journal = ensureFishingSave(save);
  assert.equal(journal.total, 7); assert.equal(journal.released, 4); assert.equal(journal.missed, 0); assert.equal(journal.snapped, 2); assert.equal(journal.gatorLosses, 3); assert.equal(journal.gatorHooks, 6);
  assert.equal(journal.species['florida-bass'].caught, 7); assert.ok(journal.species['florida-bass'].bestIn <= 29);
  assert.equal(Object.keys(journal.species).length, FISH_SPECIES.length); assert.equal(journal.species['future-fish'], undefined);
  assert.equal(journal.recent.length, FISHING_LIMITS.recent); assert.ok(journal.recent.every(record => FISH_SPECIES.some(species => species.id === record.species)));
});

test('the live activity reuses one fixed rod, line, lure and landing fish', () => {
  const previousWindow = globalThis.window, listeners = new Map();
  globalThis.window = {
    addEventListener(type, handler) { listeners.set(`${type}:${listeners.size}`, handler); },
    removeEventListener(type, handler) { for (const [key, value] of listeners) if (key.startsWith(`${type}:`) && value === handler) listeners.delete(key); },
  };
  try {
    const scene = new THREE.Scene(), boat = new THREE.Group(), threat = { pos: new THREE.Vector3() }, bull = { pos: new THREE.Vector3(30, -0.6, -130), mesh: new THREE.Object3D(), big: true, towed: false, hookSource: null, wakeKick: 0, wakeSpeed: 0 };
    bull.mesh.scale.setScalar(1.55);
    const calls = { persisted: 0, splashes: 0, bounty: [], attracted: 0, released: 0, hooked: 0, releasedGator: 0 };
    const phys = {
      pos: new THREE.Vector2(20, -120), vel: new THREE.Vector2(), heading: 0, speed: 0, throttle: 0, wet: 1, landFac: 0, airborne: false, wipeT: 0, hit: 0, angVel: 0, rollVel: 0, towDrag: 0,
      forward(out) { return out.set(-Math.sin(this.heading), -Math.cos(this.heading)); },
      right(out) { return out.set(-Math.cos(this.heading), Math.sin(this.heading)); },
    };
    const game = {
      save: {}, playing: true, paused: false, state: null, menuOpen: false, mapOpen: false, resultOpen: false,
      persist() { calls.persisted++; }, toast() {}, bounties: { event(kind, value) { calls.bounty.push([kind, value]); } },
      story: { blocking: () => false }, aftermath: { blocking: () => false }, encounters: { active: null }, incidents: { active: null }, discoveries: { active: null }, law: { pursuit: false }, life: { traffic: { activeCollision: () => false } },
    };
    const gators = {
      attractToHookedFish(source, x, z) { calls.attracted++; threat.pos.set(x + 12, 0, z); return threat; },
      releaseHookedFish() { calls.released++; },
      hookAlligator(source, gator) { calls.hooked++; gator.hookSource = source; gator.towed = true; return true; },
      releaseHookedAlligator(source) { if (bull.hookSource !== source) return 0; bull.hookSource = null; bull.towed = false; calls.releasedGator++; return 1; },
    };
    const fishing = new Fishing({
      scene, boat, terrain: { heightAt: () => -2 }, world: { blockedAt: () => false }, water: { murkAt: () => 0.2, waveHeight: () => 0 }, phys, game,
      audio: {}, environment: { waterLevel: 0, hour: 6.5, day: 1, tideRate: 0.18, gust: 1, values: { storm: 0, rain: 0, wind: 3, hail: 0 } },
      currents: { flowAt(x, z, out) { return out.set(0.08, 0); } }, life: { fish: { splash() { calls.splashes++; } } },
      regionAtFn: () => ({ id: 'mangrove', name: 'Mangrove Reach', ecology: { fish: 1.25 } }), random: () => 0.5, gators,
    });
    const idle = fishing.resourceStats(); assert.deepEqual({ meshes: idle.meshes, geometries: idle.geometries, materials: idle.materials, linePoints: idle.linePoints }, { meshes: 5, geometries: 5, materials: 5, linePoints: FISHING_LIMITS.linePoints });
    assert.equal(fishing.capturesInput({ code: 'KeyC', preventDefault() {} }), true); assert.equal(fishing.state, 'casting');
    for (let index = 0; index < 55; index++) fishing.update(1 / 60, index / 60, true);
    assert.equal(fishing.state, 'waiting'); fishing.session.waitT = 0.001; fishing.update(1 / 60, 1, true); assert.equal(fishing.state, 'bite');
    fishing.capturesInput({ code: 'KeyC', preventDefault() {} }); assert.equal(fishing.state, 'fight'); assert.equal(fishing.session.alligator, threat); assert.equal(calls.attracted, 1); assert.equal(fishing.hud().warn, true);
    const active = fishing.resourceStats(); assert.deepEqual({ objects: active.objects, meshes: active.meshes, geometries: active.geometries, materials: active.materials, geometryBytes: active.geometryBytes }, { objects: idle.objects, meshes: idle.meshes, geometries: idle.geometries, materials: idle.materials, geometryBytes: idle.geometryBytes });
    assert.ok(active.visibleDraws <= active.meshes); assert.ok(calls.splashes >= 2);
    assert.equal(fishing.alligatorTake(threat), true); assert.equal(fishing.state, 'idle'); assert.equal(fishing.store.gatorLosses, 1); assert.equal(fishing.store.missed, 1); assert.ok(calls.released >= 1);
    fishing.state = 'fight'; Object.assign(fishing.session, { species: FISH_SPECIES[4], alligator: bull, x: bull.pos.x, z: bull.pos.z, regionName: 'Mangrove Reach' });
    assert.equal(fishing.alligatorTake(bull), 'hooked'); assert.equal(fishing.state, 'gator'); assert.equal(calls.hooked, 1); assert.equal(fishing.store.gatorHooks, 1);
    fishing.update(1 / 60, 2, true); assert.ok(phys.towDrag > 0.02); assert.ok(phys.vel.length() > 0); assert.equal(fishing.resourceStats().predator, 'alligator');
    assert.equal(fishing.cutLine(), true); assert.equal(fishing.state, 'idle'); assert.equal(bull.towed, false); assert.equal(calls.releasedGator, 1); assert.equal(phys.towDrag, 0);
    fishing.dispose(); assert.equal(scene.children.length, 0); assert.equal(boat.children.length, 0); assert.equal(listeners.size, 0);
  } finally { globalThis.window = previousWindow; }
});
