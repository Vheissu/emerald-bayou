import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game } from '../src/game.js';
import { Law, pursuitStatusLabel } from '../src/law.js';

test('wanted status distinguishes an active visual from a last-fix search', () => {
  assert.equal(pursuitStatusLabel(false, false), 'Wanted');
  assert.equal(pursuitStatusLabel(true, true), 'Wanted · FWC pursuit');
  assert.equal(pursuitStatusLabel(true, false), 'Wanted · FWC searching');
});

function lawFixture() {
  const calls = [], law = Object.create(Law.prototype);
  const game = { save: {}, persist() {}, toast() {}, tricks: { bust() {} } };
  Object.assign(law, {
    game, stats: {}, attention: 0, sinceEvent: 0, violationCd: 0, hotCargoT: 0, hudT: 0,
    phys: { pos: { x: 0, y: 0 }, y: 0, heading: 0.4 },
    environment: { waterLevel: 0, hour: 12, values: { storm: 0 } },
    terrain: { heightAt: () => -2 }, witnessPosition: new THREE.Vector3(),
    traffic: { boats: [] }, world: { liveCamps: new Map(), liveSites: new Map() },
    audio: { warn() {} }, radio: { transmit: call => calls.push(call) },
  });
  game.law = law;
  return { calls, law, game };
}

test('unoccupied docks and crews screened by a bank cannot report a wake', () => {
  const { law, game } = lawFixture();
  const near = { key: 'camp:west', label: 'West Dock', kind: 'camp', limit: 8 };
  Object.assign(game, { noWakeScan: near, noWakeOverT: 3, noWakeCooldown: 0, manateeWarnCooldown: 0, mph: () => 24, el: {} });
  const camp = { userData: { site: { name: 'West Dock', x: 42, z: 0 }, people: [] } };
  law.world.liveCamps.set('west', camp);
  Game.prototype.updateNoWake.call(game, 0.1, true);
  assert.equal(law.stats.wakeWarnings, 1);
  assert.equal(law.stats.pendingReport, undefined);

  const person = new THREE.Object3D(); person.position.set(42, 0.8, 0);
  camp.userData.people.push(person);
  law.terrain.heightAt = x => x > 15 && x < 28 ? 3 : -2;
  assert.equal(law.findWitness(), '');
  law.terrain.heightAt = () => -2;
  assert.equal(law.findWitness(), 'West Dock');
  game.noWakeOverT = 3; game.noWakeCooldown = 0;
  Game.prototype.updateNoWake.call(game, 0.1, true);
  assert.equal(law.stats.pendingReport.source, 'West Dock');
  assert.equal(law.attention, 0);
});

test('a named collision report takes time and retains the original position after the boat leaves', () => {
  const { calls, law, game } = lawFixture();
  Game.prototype.boatHit.call(game, { profile: { id: 'marsh-ice', callsign: 'MARSH ICE', operator: 'ROSA' } }, 5.5);
  assert.equal(law.stats.pendingReport.source, 'MARSH ICE');
  law.phys.pos.x = 180;
  law.update(1, false);
  law.update(3, true);
  assert.equal(law.attention, 0);
  assert.equal(calls.length, 0);
  law.update(2, true);
  assert.ok(law.attention > 0.6);
  assert.equal(law.stats.pendingReport, null);
  assert.equal(law.stats.witnessReports, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /MARSH ICE reported a collision/);
  assert.deepEqual([law.stats.dispatchReport.x, law.stats.dispatchReport.z, law.stats.dispatchReport.heading], [0, 0, 0.4]);
  assert.equal(law.takeDispatchReport().source, 'MARSH ICE');
  assert.equal(law.stats.dispatchReport, null);
});
