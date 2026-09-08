import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { sampleHullSurface } from '../src/hullsurface.js';
import { SkiffAI } from '../src/npc.js';
import { EncounterDirector } from '../src/encounters.js';
import { WorldIncidents } from '../src/incidents.js';

const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);
const slope = (x, z) => 0.4 + x * 0.04 - z * 0.06;

test('five hull probes recover the real water plane in boat-local pitch and roll', () => {
  const out = {}, receiver = {}, calls = [];
  const field = { boatWaveHeight(x, z, t, own) { assert.equal(this, field); calls.push({ x, z, t, own }); return slope(x, z); } };
  assert.equal(sampleHullSurface(out, field, 0, 0, 0, 7, receiver), out);
  near(out.waterHeight, 0.4); near(out.waterPitch, Math.atan(0.06)); near(out.waterRoll, Math.atan(0.04));
  assert.equal(calls.length, 5); assert.ok(calls.every(p => p.own === receiver && p.t === 7));
  sampleHullSurface(out, field, 0, 0, Math.PI / 2, 7, receiver);
  near(out.waterPitch, Math.atan(-0.04)); near(out.waterRoll, Math.atan(0.06));
  sampleHullSurface(out, field, 0, 0, Math.PI, 7, receiver);
  near(out.waterPitch, Math.atan(-0.06)); near(out.waterRoll, Math.atan(-0.04));
});

test('uniform surge does not invent a tilt and malformed samples cannot poison the hull transform', () => {
  const out = {};
  sampleHullSurface(out, () => 1.8, 10, 20, 1.7, 0);
  near(out.waterHeight, 1.8); near(out.waterPitch, 0); near(out.waterRoll, 0);
  sampleHullSurface(out, (x, z) => x * 100 + z * 100, 0, 0, 0, 0);
  assert.ok(Math.abs(out.waterPitch) <= 0.2); assert.ok(Math.abs(out.waterRoll) <= 0.2);
  sampleHullSurface(out, () => NaN, 0, 0, 0, 0);
  assert.ok(Number.isFinite(out.waterHeight)); near(out.waterPitch, 0); near(out.waterRoll, 0);
});

function stationaryAgent() {
  return { active: true, x: 0, z: 0, heading: 0, navHeading: 0, speed: 0, turn: 0, decisionT: 100,
    targetX: 0, targetZ: -100, choice: 0, safe: true, backing: false, groundT: 0,
    shx: 0, shz: 0, yawKick: 0, heelKick: 0.08, mesh: new THREE.Group(),
    enforcement: true, windHeel: 0.03, windDrift: { x: 0, z: 0 }, weatherTactic: { speedScale: 1, avoidance: 0 },
  };
}
function context(Type) {
  return Object.assign(Object.create(Type.prototype), { water: { level: 0.4, waveHeight: slope }, terrain: { heightAt: () => -5 }, currents: null,
    environment: { waterLevel: 0.4 }, world: { blockedAt: () => false }, phys: { pos: { x: 100, y: 100 } },
  });
}

test('patrol and mission controllers follow wave tilt while preserving wind and impact heel', () => {
  const patrol = context(EncounterDirector), incident = context(WorldIncidents);
  for (const [owner, wind] of [[patrol, 0.03], [incident, 0]]) {
    const a = stationaryAgent();
    owner.updateAgent(a, 0, 7, 0, -100, 0);
    near(a.mesh.position.y, 0.35); near(a.mesh.rotation.x, Math.atan(0.06));
    near(a.mesh.rotation.z, Math.atan(0.04) + 0.08 + wind);
    near(a.x, 0); near(a.z, 0); near(a.heading, 0);
  }
  const blocker = stationaryAgent(); blocker.enforcement = false;
  patrol.holdPatrolChannel(blocker, { x: 0, z: 0, heading: 0 }, 0, 7);
  near(blocker.mesh.rotation.x, Math.atan(0.06)); near(blocker.mesh.rotation.z, Math.atan(0.04) + 0.08);
});

test('the rival skiff filters wave attitude through its retained pitch and roll response', () => {
  const motor = new THREE.Group(); motor.userData.prop = new THREE.Group();
  const mesh = new THREE.Group(); mesh.userData.motor = motor;
  const skiff = Object.assign(Object.create(SkiffAI.prototype), { mesh, pos: new THREE.Vector2(), vel: new THREE.Vector2(),
    heading: 0, speed: 0, maxSpeed: 0, active: true, done: false, path: [{ x: 0, z: 0 }, { x: 0, z: -100 }], i: 1,
    lookAhead: 8, roll: 0, pitch: 0, dist: 0, shoveX: 0, shoveZ: 0, yawKick: 0, heelKick: 0, _forward: new THREE.Vector2(),
  });
  let probes = 0;
  skiff.waveFn = (x, z, t, receiver) => { assert.equal(receiver, skiff); probes++; return slope(x, z); };
  skiff.update(0.1, 7);
  assert.equal(probes, 5);
  near(skiff.pitch, Math.atan(0.06) * (1 - Math.exp(-0.3)));
  near(skiff.roll, Math.atan(0.04) * (1 - Math.exp(-0.6)));
  near(mesh.position.y, 0.35);
});

test('live resident and directed boat wiring uses the shared surface without changing player physics', async () => {
  const [main, life, water] = await Promise.all(['main', 'life', 'water'].map(name => readFile(new URL(`../src/${name}.js`, import.meta.url), 'utf8')));
  assert.match(main, /new SkiffAI\(\(x, z, t, receiver\) => water\.boatWaveHeight/);
  assert.match(main, /boatWaveFn: \(x, z, t, receiver\) => water\.boatWaveHeight/);
  assert.match(main, /const playerWater = \(x, z, t\) => water\.waveHeight\(x, z, t\) \+ sampleWakeFields/);
  assert.match(life, /this\.fx\.boatWaveFn\(x, z, t, excludeBoat\)/);
  assert.match(water, /this\.vesselWakes\.heightAt\(x, z, t, receiver\)/);
});
