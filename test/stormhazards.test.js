import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { StormHazards, stormDebrisCanFly, stormDebrisFlightChance } from '../src/stormhazards.js';

globalThis.document ??= { getElementById: () => null };
globalThis.window ??= { addEventListener() {} };

function makeHazards() {
  const scene = new THREE.Scene();
  const phys = {
    pos: new THREE.Vector2(), vel: new THREE.Vector2(), heading: 0, angVel: 0, rollVel: 0, vy: 0, wipeT: 0,
    addObs(name, obstacles) { this.obstacleName = name; this.obstacles = obstacles; },
    forward(out) { return out.set(-Math.sin(this.heading), -Math.cos(this.heading)); },
    right(out) { return out.set(Math.cos(this.heading), -Math.sin(this.heading)); },
  };
  const game = { save: {}, mapMarkers: [], shake: 0, toast() {}, persist() {} };
  const environment = {
    key: 'hurricane', gust: 1, windDir: new THREE.Vector3(1, 0, 0), values: { wind: 36, storm: 1, rain: 1 },
    alert() {}, triggerLightning() {}, camera: { position: new THREE.Vector3() },
  };
  const hazards = new StormHazards({
    scene, phys, game, environment,
    terrain: { heightAt: () => -1 }, world: { blockedAt: () => false },
    water: { level: 0, waveHeight: () => 0 }, currents: { flowAt: (x, z, out) => out.set(0, 0) },
    audio: { knock() {}, splash() {}, shot() {}, warn() {} }, condition: { damage() {}, powerCut: 0 },
    plume: { emit() {} }, spray: { emit() {} },
  });
  return { hazards, phys, game };
}

test('storm debris lift requires severe weather and excludes heavy logs', () => {
  assert.equal(stormDebrisFlightChance('log', 1, 40), 0);
  assert.equal(stormDebrisFlightChance('sheet', 0.7, 40), 0);
  assert.equal(stormDebrisFlightChance('sheet', 1, 17), 0);
  assert.ok(stormDebrisFlightChance('sheet', 1, 30) > stormDebrisFlightChance('plank', 1, 30));
  assert.equal(stormDebrisCanFly('sheet', 1, 30, 0.81), true);
  assert.equal(stormDebrisCanFly('sheet', 1, 30, 0.83), false);
  assert.equal(stormDebrisCanFly('plank', 1, 30, 0.53), false);
});

test('twelve storm bodies share six geometries and seven materials', () => {
  const { hazards, phys } = makeHazards(), stats = hazards.resourceStats();
  assert.equal(phys.obstacleName, 'storm-hazards');
  assert.deepEqual(
    { pool: stats.pool, objects: stats.objects, meshes: stats.meshes, geometries: stats.geometries, materials: stats.materials },
    { pool: 12, objects: 56, meshes: 44, geometries: 6, materials: 7 },
  );
  assert.deepEqual(stats.wakeStamps, { active: 0, capacity: 17, droppedFrame: 0, droppedTotal: 0 });
});

test('forced windborne debris uses the fixed pool, stays non-solid aloft and lands into the channel', () => {
  const { hazards } = makeHazards();
  assert.equal(hazards.spawnDebris(true, true), true);
  const debris = hazards.debris.find(item => item.active);
  assert.notEqual(debris.kind, 'log'); assert.equal(debris.airborne, true); assert.equal(hazards.stats.airborneSpawns, 1);
  hazards.updateDebris(1 / 60, 0);
  assert.equal(hazards.obstacles.length, 0);
  debris.flightT = 0; debris.y = 0.01; debris.vy = -2;
  hazards.updateDebris(1 / 30, 1);
  assert.equal(debris.active, true); assert.equal(debris.airborne, false);
  hazards.updateDebris(1 / 60, 2);
  assert.ok(hazards.obstacles.includes(debris.obs));
});

test('storm wake stamps reuse their retained objects and omit debris while it is airborne', () => {
  const { hazards } = makeHazards(), debris = hazards.debris[0];
  debris.active = true; debris.airborne = false; debris.x = 0; debris.z = 0;
  const firstFrame = []; hazards.stamps(firstFrame); const retained = firstFrame[0];
  const secondFrame = []; hazards.stamps(secondFrame);
  assert.equal(secondFrame[0], retained);
  debris.airborne = true;
  const airborneFrame = []; hazards.stamps(airborneFrame);
  assert.equal(airborneFrame.length, 0);
});
