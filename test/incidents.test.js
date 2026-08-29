import test from 'node:test';
import assert from 'node:assert/strict';
import { WorldIncidents } from '../src/incidents.js';

function makeDirector() {
  const radio = [], reputation = [], law = [], memory = [], cash = [];
  const fuelBoat = visible => ({ userData: { fuel: { visible } } });
  const agent = (speed = 0) => ({ x: 0, z: 0, heading: 0, speed, shx: 0, shz: 0, active: true });
  const director = Object.create(WorldIncidents.prototype);
  director.active = {
    type: 'shakedown', state: 'threat', choice: '', resolved: '', t: 12, region: { name: 'Blackwater' },
    patrolX: -115, patrolZ: 0, heading: 0, cargoTaken: false, victimHit: false,
  };
  director.stats = {};
  director.rigs = {
    patrol: { agent: agent() }, runner: { agent: agent(8), boat: fuelBoat(false) }, victim: { agent: agent(), boat: fuelBoat(true) },
  };
  director.clearPrompt = () => {};
  director.setAgent = (A, x, z, heading, speed) => Object.assign(A, { x, z, heading, speed, active: true });
  director.radio = { clock: 22, transmit: message => { radio.push(message); return true; } };
  director.reputation = { change: (...args) => reputation.push(args) };
  director.law = { add: (...args) => law.push(['add', ...args]), violation: (...args) => law.push(['violation', ...args]) };
  director.encounters = { remember: (...args) => memory.push(args) };
  director.audio = { horn() {}, thud() {} };
  director.game = {
    shake: 0, toast() {}, bountyToast() {}, addCash: amount => cash.push(amount), persist() {},
  };
  return { director, radio, reputation, law, memory, cash };
}

test('reporting the fuel shakedown deploys the pooled patrol and rewards a completed stop', () => {
  const { director, reputation, law, memory, cash } = makeDirector();

  assert.equal(director.chooseShakedown('fwc'), true);
  assert.equal(director.active.choice, 'fwc');
  assert.equal(director.active.state, 'reported');
  assert.equal(director.rigs.patrol.agent.active, true);
  assert.equal(director.rigs.patrol.agent.x, -115);
  assert.equal(director.resolveShakedown('captured'), true);

  assert.equal(director.stats.resolved, 1);
  assert.equal(director.stats.fwc, 1);
  assert.deepEqual(reputation.map(change => change[0]), ['fwc', 'locals', 'runners']);
  assert.deepEqual(cash, [150]);
  assert.deepEqual(law, []);
  assert.deepEqual(memory, [['fuel-theft-stopped', 'Blackwater', 'incident']]);
});

test('helping the offender transfers the visible fuel and enters the normal wanted queue', () => {
  const { director, reputation, law, memory, cash } = makeDirector();

  assert.equal(director.chooseShakedown('runners'), true);
  assert.equal(director.active.state, 'escaping');
  assert.equal(director.rigs.victim.boat.userData.fuel.visible, false);
  assert.equal(director.rigs.runner.boat.userData.fuel.visible, true);
  assert.deepEqual(law, [['add', 1.45, 'aided theft from a work skiff', true]]);
  assert.equal(director.resolveShakedown('aided'), true);

  assert.equal(director.stats.resolved, 1);
  assert.equal(director.stats.runners, 1);
  assert.deepEqual(reputation.map(change => change[0]), ['runners', 'locals', 'fwc']);
  assert.deepEqual(cash, [175]);
  assert.deepEqual(memory, [['fuel-theft-aided', 'Blackwater', 'incident']]);
});

test('a deliberate hit on the offender drives it off while a victim strike is witnessed', () => {
  const local = makeDirector(), offender = local.director.makeBoatObstacle(local.director.rigs.runner.agent, 'runner');
  local.director.hitCd = 0; offender.onHit(4.2, 1, 0);
  assert.equal(local.director.active.choice, 'locals');
  assert.equal(local.director.active.state, 'fleeing');
  assert.deepEqual(local.law, []);

  const victimCase = makeDirector(), victim = victimCase.director.makeBoatObstacle(victimCase.director.rigs.victim.agent, 'work skiff');
  victimCase.director.hitCd = 0; victim.onHit(5, 1, 0);
  assert.equal(victimCase.director.active.choice, '');
  assert.equal(victimCase.director.active.victimHit, true);
  assert.equal(victimCase.law[0][0], 'violation');
  assert.equal(victimCase.reputation[0][0], 'locals');
});

test('a reported offender can ram and damage the player but respects its contact cooldown', () => {
  const { director } = makeDirector(), damage = [];
  director.active.state = 'reported'; director.active.hostileT = 4; director.active.contactCd = 0;
  director.phys = {
    pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, hit: 0, hitNormal: { set(x, z) { this.x = x; this.z = z; } },
    hitTag: '', angVel: 0, rollVel: 0,
  };
  director.condition = { damage: (...values) => damage.push(values) };
  const offender = { x: 0, z: 5, heading: 0, speed: 10 };

  assert.equal(director.attemptShakedownRam(director.active, offender, 5), true);
  assert.ok(director.phys.vel.y < 0);
  assert.equal(director.phys.hitTag, 'boat');
  assert.equal(damage.length, 1);
  assert.equal(director.attemptShakedownRam(director.active, offender, 5), false);
  assert.equal(damage.length, 1);
});
