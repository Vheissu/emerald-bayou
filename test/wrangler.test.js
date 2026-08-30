import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { EncounterDirector } from '../src/encounters.js';
import { setWranglePose } from '../src/folk.js';
import {
  WRANGLER_WAKE_RELEASE, wranglerAssistStep, wranglerStationQuality, wranglerWakeStep, wranglerWakeThreat,
} from '../src/wrangler.js';

test('the capture assist only advances from a calm position outside the working circle', () => {
  assert.ok(wranglerStationQuality(22, 0.6, false) > 0.98);
  assert.equal(wranglerStationQuality(9, 0.2, false), 0);
  assert.equal(wranglerStationQuality(38, 0.2, false), 0);
  assert.equal(wranglerStationQuality(22, 3.2, false), 0);
  assert.equal(wranglerStationQuality(22, 0.2, true), 0);

  let progress = 0;
  for (let frame = 0; frame < 11 * 60; frame++) progress = wranglerAssistStep(progress, 1 / 60, 22, 0.6, false);
  assert.ok(progress > 0.99);
  const held = progress;
  for (let frame = 0; frame < 120; frame++) progress = wranglerAssistStep(progress, 1 / 60, 8, 0, false);
  assert.ok(progress < held - 0.2);
});

test('a fast closing pass builds enough retained wake risk to break the grip', () => {
  assert.equal(wranglerWakeThreat(50, 14, 8, false), 0);
  assert.equal(wranglerWakeThreat(20, 0.4, 0, false), 0);
  assert.ok(wranglerWakeThreat(18, 11, 6, false) > 0.8);
  assert.ok(wranglerWakeThreat(18, 4, 2, true) > wranglerWakeThreat(18, 4, 2, false));

  let risk = 0;
  for (let frame = 0; frame < 60; frame++) risk = wranglerWakeStep(risk, 1 / 60, wranglerWakeThreat(18, 11, 6, false));
  assert.ok(risk >= WRANGLER_WAKE_RELEASE);
  const peak = risk;
  for (let frame = 0; frame < 120; frame++) risk = wranglerWakeStep(risk, 1 / 60, 0);
  assert.ok(risk < peak);
});

test('the wrangle pose is a retained scalar on an existing person', () => {
  const figure = new THREE.Group(); figure.userData.wrangle = 0;
  setWranglePose(figure, 2); assert.equal(figure.userData.wrangle, 1);
  setWranglePose(figure, -1); assert.equal(figure.userData.wrangle, 0);
});

test('starting the scene reuses the three boats, four people and existing gator', async () => {
  const director = Object.create(EncounterDirector.prototype), bulb = new THREE.Object3D();
  const workBoat = new THREE.Group(), worker = new THREE.Group(), fireBoat = new THREE.Group(), operator = new THREE.Group(), crowdBoat = new THREE.Group(), gator = new THREE.Group();
  worker.userData.wrangle = 0; operator.userData.waveT = 0; crowdBoat.userData.people = [new THREE.Group()];
  director.rigs = {
    distress: { boat: workBoat, survivor: worker, passenger: new THREE.Group(), echoAgent: { active: false }, flare: { group: new THREE.Group(), light: { intensity: 0 }, bulb } },
    fire: { boat: fireBoat, operator, swimmer: new THREE.Group(), fire: { visible: false, userData: { fire: { light: { intensity: 0 } } } } },
    smuggler: { boat: crowdBoat, agent: { active: false }, pack: new THREE.Group() },
    spotlight: { gator, gunner: new THREE.Group(), light: { intensity: 0 }, pool: new THREE.Group(), eyes: new THREE.Group() },
  };
  director.water = { waveHeight: () => 0 }; director.environment = { values: { sea: 0 } }; director.distressEcho = null;
  director.updateWranglerRig = () => {};
  const refs = { workBoat, worker, fireBoat, operator, crowdBoat, gator };
  director.startWrangler({ x: 20, z: -40, heading: 0.3 });

  assert.equal(director.active.type, 'wrangler');
  assert.equal(director.rigs.distress.boat, refs.workBoat); assert.equal(director.rigs.distress.survivor, refs.worker);
  assert.equal(director.rigs.fire.boat, refs.fireBoat); assert.equal(director.rigs.fire.operator, refs.operator);
  assert.equal(director.rigs.smuggler.boat, refs.crowdBoat); assert.equal(director.rigs.spotlight.gator, refs.gator);
  assert.deepEqual(director.wranglerSnapshot().extraRenderResources, { objects: 0, geometries: 0, materials: 0, textures: 0, lights: 0 });

  const source = await readFile(new URL('../src/encounters.js', import.meta.url), 'utf8');
  const startSource = source.slice(source.indexOf('  startWrangler(at)'), source.indexOf('  floatWranglerBoat(', source.indexOf('  startWrangler(at)')));
  assert.doesNotMatch(startSource, /new THREE\.|buildSkiff\(|gatorMesh\(|person\(/);
});

test('player wake releases the gator once and leaves a bounded incident record', () => {
  const director = Object.create(EncounterDirector.prototype), violations = [], standings = [], toasts = [];
  const worker = new THREE.Group(), operator = new THREE.Group(); worker.userData.wrangle = 1; operator.userData.waveT = 0;
  director.rigs = { distress: { survivor: worker }, fire: { operator } };
  director.phys = { pos: { x: 3, y: 4 } }; director.departureHeading = () => 1.7;
  director.game = { save: {}, persist() {}, toast: (...args) => toasts.push(args), addCash() {}, bountyToast() {} };
  director.audio = { warn() {} }; director.radio = { transmit() {} };
  director.law = { add: (...args) => violations.push(args) };
  director.reputation = { change: (...args) => standings.push(args) };
  const e = { type: 'wrangler', state: 'helping', gatorX: 0, gatorZ: 0, gatorHeading: 0, bet: 0 };
  director.active = e;

  assert.equal(director.releaseWrangler(e, 'wake', true), true);
  assert.equal(e.state, 'loose'); assert.equal(e.playerCaused, true); assert.equal(e.escapeHeading, 1.7);
  assert.equal(director.game.save.wranglerWakeBreaks, 1); assert.equal(violations.length, 1); assert.equal(standings.length, 2); assert.equal(toasts.length, 1);
  assert.equal(director.releaseWrangler(e, 'wake', true), false); assert.equal(violations.length, 1);
});

test('a completed assist clears the working prompt and pays the capture once', () => {
  const director = Object.create(EncounterDirector.prototype), cash = [], toasts = [];
  let promptClears = 0;
  director.clearPrompt = () => { promptClears++; };
  director.game = { save: {}, persist() {}, toast: (...args) => toasts.push(args), addCash: amount => cash.push(amount), bountyToast() {} };
  director.audio = { complete() {} }; director.radio = { transmit() {} };
  const e = { type: 'wrangler', state: 'helping', assist: 0.8, workerProgress: 0, bet: 0 };

  assert.equal(director.secureWrangler(e, true), true);
  assert.equal(e.state, 'secured'); assert.equal(e.assist, 1); assert.equal(promptClears, 1);
  assert.deepEqual(cash, [180]); assert.equal(toasts.length, 1);
  assert.equal(director.secureWrangler(e, true), false); assert.deepEqual(cash, [180]);
});

test('weather releases the gator without blame and refunds the side bet', () => {
  const director = Object.create(EncounterDirector.prototype), cash = [], violations = [], standings = [];
  const worker = new THREE.Group(), operator = new THREE.Group(); worker.userData.wrangle = 1; operator.userData.waveT = 0;
  director.rigs = { distress: { survivor: worker }, fire: { operator } };
  director.phys = { pos: { x: 3, y: 4 } }; director.departureHeading = () => 0.4;
  director.game = { save: {}, persist() {}, toast() {}, addCash: amount => cash.push(amount), bountyToast() {} };
  director.audio = { warn() {} }; director.radio = { transmit() {} };
  director.law = { add: (...args) => violations.push(args) };
  director.reputation = { change: (...args) => standings.push(args) };
  const e = { type: 'wrangler', state: 'waiting', gatorX: 0, gatorZ: 0, gatorHeading: 0, bet: 50 };
  director.active = e;

  assert.equal(director.releaseWrangler(e, 'weather', false), true);
  assert.equal(e.state, 'loose'); assert.equal(e.playerCaused, false); assert.equal(e.outcome, 'wrangler-weather-break');
  assert.deepEqual(cash, [50]); assert.equal(e.bet, 0); assert.equal(violations.length, 0); assert.equal(standings.length, 0);
});
