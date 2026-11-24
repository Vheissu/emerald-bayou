import test from 'node:test';
import assert from 'node:assert/strict';
import { drawEncounter, riverCallObjective, updateRiverCall } from '../src/rivercalls.js';
import { EncounterDirector } from '../src/encounters.js';
import * as THREE from 'three';
import { person } from '../src/folk.js';
import { mulberry32 } from '../src/noise.js';

function scene(type) {
  const rig = { crew: person(mulberry32(23)), skiff: new THREE.Group(), sensor: new THREE.Group(), head: new THREE.Group(), blink: { material: {} }, flash: {} };
  const payouts = [];
  const director = { rigs: { riverCall: rig }, phys: { pos: new THREE.Vector2(10, 0), speed: 0 }, water: { waveHeight: () => 0 },
    _personBoat: {}, fixedObs: {}, obs: [], terrain: { heightAt: () => -2 }, environment: { waterLevel: 0 },
    audio: { pickup() {} }, point() {}, setPrompt() {}, game: { toast() {} }, canInteract: () => true,
    complete(title, line, prize) { payouts.push(prize); }, interact: true };
  const event = { type, state: 'offer', x: 0, z: 0, tx: 45, tz: 0, lane: { dx: 1, dz: 0 }, heading: 0, known: true, t: 0, prize: 155 };
  const tick = (x, z, speed, interact = false) => {
    director.phys.pos.set(x,z); director.phys.speed = speed; director.interact = interact; event.t += 0.2;
    updateRiverCall(director, event, 0.2, event.t);
  };
  return { event, payouts, tick, rig };
}

test('chance encounters retain weather weights and give recent sightings a rest', () => {
  const weights = { race: 0, sounder: 1, fire: 1, bogus: NaN };
  for (const roll of [0, 0.48, 0.999]) assert.equal(drawEncounter(weights, ['sounder'], () => roll), 'fire');
  assert.equal(drawEncounter(weights, [], () => 0.9), 'fire');
  assert.equal(drawEncounter(weights, [], () => 0.1), 'sounder');
  assert.equal(drawEncounter({ race: 2 }, ['race'], () => 0), 'race');
  const fixture = { environment: { key: 'calm', hour: 12, tideRate: 0.2, waterLevel: 0, tideRange: 1, values: { storm: 0, wind: 5 }, restrictedVisibility: 0 }, game: { save: {} } };
  const seen = new Set();
  const random = Math.random;
  try { for (let i = 0; i < 4000; i++) { Math.random = () => i / 4000; seen.add(EncounterDirector.prototype.pickType.call(fixture)); } }
  finally { Math.random = random; }
  assert.ok(seen.has('sounder') && seen.has('photoboat') && seen.has('race'));
  assert.ok(!seen.has('spotlight'));
});

test('the surveyor pays for a slow pickup and a separate handover', () => {
  const { event, tick, payouts, rig } = scene('sounder');
  tick(9, 0, 0, true); assert.equal(event.state, 'recover');
  tick(44, 0, 6, true); assert.equal(event.state, 'recover');
  tick(44, 0, 0.3, true); assert.equal(rig.sensor.visible, false);
  assert.match(riverCallObjective(event).obj, /Return the recorder/);
  assert.deepEqual(payouts, []);
  tick(9, 0, 0.4, true); assert.deepEqual(payouts, [155]);
});

test('a camera pass needs a run-up, speed and room abeam of the skiff', () => {
  const { event, tick, payouts, rig } = scene('photoboat');
  tick(9, 0, 0, true); tick(44, 0, 5);
  tick(6, 0, 11); assert.equal(event.state, 'lineup');
  tick(45, 0, 10); tick(18, 5, 3); assert.equal(event.state, 'pass');
  tick(12, 0, 10); tick(13, 5, 10);
  assert.equal(rig.flash.visible, true); assert.deepEqual(payouts, []);
  tick(30, 0, 11); tick(33, 0, 11); assert.deepEqual(payouts, [155]);
});
