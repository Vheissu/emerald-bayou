import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  MAX_MARSH_FIRES, MarshFireDirector, marshFireDynamics, marshFireFuel, marshFireIgnitionChance, normalizeMarshFireLedger,
} from '../src/marshfire.js';

test('marsh fuel requires exposed bank and dries into a stronger fire bed', () => {
  const dry = marshFireFuel({ ground: 0.8, waterLevel: 0, openness: 1, wetness: 0, rain: 0 });
  const damp = marshFireFuel({ ground: 0.8, waterLevel: 0, openness: 1, wetness: 0.9, rain: 0.7 });
  const litter = marshFireFuel({ ground: 0.8, waterLevel: 0, openness: 0, wetness: 0, rain: 0 });
  assert.ok(dry > damp); assert.ok(dry > litter); assert.ok(litter > 0);
  assert.equal(marshFireFuel({ ground: 0.02, waterLevel: 0, openness: 1 }), 0);
  assert.equal(marshFireFuel({ ground: 0.8, waterLevel: 0, openness: 1, blocked: true }), 0);
  assert.equal(marshFireFuel({ ground: 4.2, waterLevel: 0, openness: 1 }), 0);
});

test('dry lightning can ignite grass while open water and saturated rain cannot sustain it', () => {
  const dry = marshFireIgnitionChance({ ground: 0.8, waterLevel: 0, openness: 1, wetness: 0.05, rain: 0.02, wind: 14 });
  const soaked = marshFireIgnitionChance({ ground: 0.8, waterLevel: 0, openness: 1, wetness: 1, rain: 1, wind: 14 });
  assert.ok(dry > 0.35); assert.ok(soaked < 0.01); assert.ok(dry > soaked * 50);
  assert.equal(marshFireIgnitionChance({ water: true, ground: 0.8, waterLevel: 0, openness: 1 }), 0);
});

test('wind and stern wash advance fire while rain and the bank-water pump knock it down', () => {
  const input = { intensity: 0.72, radius: 4, age: 20, maxLife: 160, fuel: 0.92, wetness: 0.05, rain: 0, wind: 18 };
  const dry = marshFireDynamics(input, 1, {});
  const fanned = marshFireDynamics({ ...input, fan: 1 }, 1, {});
  const rain = marshFireDynamics({ ...input, wetness: 1, rain: 1 }, 1, {});
  const pumped = marshFireDynamics({ ...input, suppression: 1 }, 1, {});
  assert.ok(dry.intensity > input.intensity); assert.ok(dry.radius > input.radius); assert.ok(dry.advance > 0.08);
  assert.ok(fanned.intensity > dry.intensity); assert.ok(fanned.advance > dry.advance);
  assert.ok(rain.intensity < 0.5); assert.ok(pumped.intensity < dry.intensity - 0.15);
  assert.equal(marshFireDynamics({ ...input, flooded: 1 }, 1, {}).intensity < 0.25, true);
});

test('saved fire state is bounded, validated and drops expired scars', () => {
  const now = 1_800_000;
  const patch = (x, state = 'burning', expiresAt = now + 1000) => ({ state, x, z: x + 1, originX: x - 1, originZ: x, intensity: 8, radius: 80, age: -2, maxLife: 999, seed: 2, savedAt: now, expiresAt });
  const ledger = normalizeMarshFireLedger({
    stats: { ignitions: 4.9, contained: -2, pumpSeconds: 12.26, propFanned: 2 },
    patches: [null, patch(1), { state: 'burning', x: 'bad' }, patch(2, 'scar'), patch(3, 'scar', now - 1), patch(4), patch(5)],
  }, now);
  assert.equal(ledger.patches.length, MAX_MARSH_FIRES);
  assert.deepEqual(ledger.patches.map(item => item.x), [1, 2, 4]);
  assert.equal(ledger.patches[0].intensity, 1.25); assert.equal(ledger.patches[0].radius, 24); assert.equal(ledger.patches[0].age, 0); assert.equal(ledger.patches[0].maxLife, 420);
  assert.deepEqual(ledger.stats, { ignitions: 4, spotFires: 0, contained: 0, weatherOut: 0, burnedOut: 0, propFanned: 2, pumpSeconds: 12.3 });
});

function classList() {
  const values = new Set();
  return { add: value => values.add(value), remove: value => values.delete(value), contains: value => values.has(value) };
}

test('the world director keeps three patches in three shared draws and reuses existing effect pools', () => {
  const scene = new THREE.Scene(), prompt = { innerHTML: '', classList: classList() };
  let persisted = 0, smoke = 0, water = 0, audioLevel = 0;
  const phys = { pos: new THREE.Vector2(), speed: 0, rpm: 0, heading: 0, wet: 1, airborne: false };
  const game = {
    save: {}, el: { prompt }, mapMarkers: [], shake: 0, paused: false, inputLock: false, menuOpen: false, mapOpen: false, resultOpen: false,
    state: null, dockJob: null, dockCamp: null, atBoard: null, toast() {}, persist() { persisted++; }, bounties: { event() {} },
  };
  const director = new MarshFireDirector({
    scene, phys, game, profile: { id: 'balanced' },
    terrain: { heightAt: () => 0.8, openness: () => 1 }, world: { blockedAt: () => false }, water: { level: 0 },
    environment: { waterLevel: 0, surfaceWetness: 0, daylight: 1, day: 1, gust: 1, windDir: new THREE.Vector3(1, 0, 0), values: { rain: 0, wind: 12 } },
    audio: { warn() {}, marshFire(level) { audioLevel = level; } }, condition: { damage() {} },
    plume: { emit() { smoke++; } }, spray: { emit() { water++; } }, waders: { flushNear() {} }, ecology: {},
  });
  assert.deepEqual(director.resourceStats(), { pool: 3, burning: 0, scars: 0, flameCapacity: 30, renderedFlames: 0, draws: 3, geometries: 2, materials: 3, lights: 1, savedPatches: 0 });
  const patch = director.igniteAt(22, 0, { force: true, intensity: 0.9 });
  assert.ok(patch); assert.equal(persisted, 1); assert.equal(director.stats.ignitions, 1);
  for (let frame = 0; frame < 3; frame++) { game.mapMarkers.length = 0; director.update(0.1, 1 + frame * 0.1, true); }
  assert.equal(game.mapMarkers.length, 1); assert.ok(smoke > 0); assert.ok(audioLevel > 0);
  assert.equal(director.resourceStats().renderedFlames > 0, true);
  director.pumpHeld = true; director.update(0.2, 1.2, true);
  assert.equal(director.pumpActive, true); assert.ok(water > 0);
  director.dispose();
});
