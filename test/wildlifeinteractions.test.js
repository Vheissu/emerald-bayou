import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Ecology } from '../src/ecology.js';
import { Gators, Waders } from '../src/wildlife.js';

const bird = (x, z, visible = true) => ({
  x, z, y: 0, fly: 0, vx: 0, vz: 0, vy: 0, mesh: { visible, rotation: { x: 0, y: 0, z: 0 } },
});

test('ambient flushes reuse retained waders and report their source', () => {
  const near = bird(8, 0), far = bird(80, 0), sources = [];
  const waders = Object.assign(Object.create(Waders.prototype), {
    list: [near, far], rand: () => 0.25, onFlush: (w, distance, source) => sources.push([w, distance, source]),
  });

  assert.equal(waders.flushNear(0, 0, 20, 'traffic'), 1);
  assert.ok(near.fly > 5); assert.equal(far.fly, 0); assert.equal(sources[0][2], 'traffic');
  assert.equal(waders.flushNear(0, 0, 20, 'traffic'), 0);
});

const gator = (x, z, options = {}) => ({
  pos: new THREE.Vector3(x, 0, z), bask: options.bask ?? false, slide: 0, dive: 0, toWater: 1.2, heading: 0,
  towed: false, parked: false, preySource: options.preySource ?? null, charge: 0, hitT: 0, wakeKick: 0,
  mesh: { visible: true, scale: new THREE.Vector3(1, 1, 1) },
});

test('a resident hull sends basking and swimming alligators clear without touching active prey pursuits', () => {
  const basker = gator(10, 0, { bask: true }), swimmer = gator(8, 0), pursuing = gator(6, 0, { preySource: {} });
  const slides = [], gators = Object.assign(Object.create(Gators.prototype), {
    list: [basker, swimmer, pursuing], rand: () => 0.5, spooked: 0, audio: null,
    disturbanceStats: { slides: 0, dives: 0 }, onSlide: (animal, distance, source) => slides.push([animal, distance, source]),
  });

  const stats = gators.disturbByBoat(0, 0, 6, 'traffic');
  assert.equal(stats, gators.disturbanceStats); assert.deepEqual(stats, { slides: 1, dives: 1 });
  assert.equal(basker.heading, basker.toWater); assert.ok(basker.slide > 0); assert.ok(swimmer.dive >= 7);
  assert.equal(pursuing.dive, 0); assert.equal(slides[0][2], 'traffic');
});

test('the low-frequency traffic pass coordinates wildlife without allocating a new stats record', () => {
  let manateeAlerts = 0, flushSource = '', gatorSource = '';
  const manatee = { pos: new THREE.Vector3(12, 0, 0), trafficAlertT: 0 };
  const ecology = new Ecology({
    life: { traffic: { boats: [{ active: true, x: 0, z: 0, speed: 7, kind: 'john', state: 'transit', assisting: false, collision: { active: false } }] } },
    waders: { flushNear(x, z, radius, source) { flushSource = source; return 2; } },
    gators: { disturbByBoat(x, z, speed, source) { gatorSource = source; return { slides: 1, dives: 1 }; } },
    manatees: { list: [manatee], alert() { manateeAlerts++; } },
  });
  const stats = ecology.trafficWildlifeStats;

  assert.equal(ecology.updateTrafficWildlife(0.21), stats);
  assert.deepEqual(stats, { passes: 1, boats: 1, directedBoats: 0, manateeAlerts: 1, waderFlushes: 2, gatorSlides: 1, gatorDives: 1 });
  assert.equal(manateeAlerts, 1); assert.equal(manatee.trafficAlertT, 5); assert.equal(flushSource, 'traffic'); assert.equal(gatorSource, 'traffic');
  assert.equal(ecology.updateTrafficWildlife(0.02), stats); assert.equal(stats.passes, 1);
});

test('police, race, mission and story craft disturb wildlife as traffic without charging the player', () => {
  let manateeAlerts = 0, offenses = 0, visits = 0;
  const manatee = { pos: new THREE.Vector3(12, 0, 0), trafficAlertT: 0 };
  const source = {
    visitActiveVessels(visitor) { visits++; visitor(0, 0, 7, 'skiff'); visitor(80, 80, 0, 'skiff'); },
    wakeHeightAt() { return 0; },
  };
  const sources = [source];
  const ecology = new Ecology({
    life: { traffic: { boats: [] } },
    waders: { flushNear(x, z, radius, origin) { if (origin === 'player') offenses++; return origin === 'traffic' ? 2 : 0; } },
    gators: { disturbByBoat(x, z, speed, origin) { if (origin === 'player') offenses++; return { slides: origin === 'traffic' ? 1 : 0, dives: 1 }; } },
    manatees: { list: [manatee], alert() { manateeAlerts++; } },
  });

  assert.equal(ecology.setDirectedVesselSources(sources), ecology);
  assert.equal(ecology.directedVesselSources, sources);
  const stats = ecology.updateTrafficWildlife(0.21);
  assert.deepEqual(stats, { passes: 1, boats: 1, directedBoats: 1, manateeAlerts: 1, waderFlushes: 2, gatorSlides: 1, gatorDives: 1 });
  assert.equal(visits, 1); assert.equal(manateeAlerts, 1); assert.equal(manatee.trafficAlertT, 5); assert.equal(offenses, 0);
});
