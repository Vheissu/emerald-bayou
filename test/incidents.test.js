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
  assert.ok(local.director.rigs.runner.agent.shx < 0);
  assert.ok(local.director.rigs.runner.agent.impactCd > 0);
  assert.deepEqual(local.law, []);

  const victimCase = makeDirector(), victim = victimCase.director.makeBoatObstacle(victimCase.director.rigs.victim.agent, 'work skiff');
  victimCase.director.hitCd = 0; victim.onHit(5, 1, 0);
  assert.equal(victimCase.director.active.choice, '');
  assert.equal(victimCase.director.active.victimHit, true);
  assert.equal(victimCase.law[0][0], 'violation');
  assert.equal(victimCase.reputation[0][0], 'locals');
});

test('one player contact cannot repeatedly drain a pooled incident hull through duplicate callbacks', () => {
  const { director } = makeDirector(), hull = director.rigs.runner.agent, obstacle = director.makeBoatObstacle(hull, 'runner');
  director.hitCd = 2; hull.speed = 8;

  obstacle.onHit(5, 1, 0);
  const speedAfterImpact = hull.speed, shoveAfterImpact = hull.shx;
  obstacle.onHit(5, 1, 0);

  assert.equal(speedAfterImpact, 4.4);
  assert.equal(hull.speed, speedAfterImpact);
  assert.equal(hull.shx, shoveAfterImpact);
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
  assert.ok(offender.shz > 0);
  assert.ok(Math.hypot(offender.shx, offender.shz) <= 5.2);
  assert.ok(offender.impactCd > 0);
  assert.equal(damage.length, 1);
  assert.equal(director.attemptShakedownRam(director.active, offender, 5), false);
  assert.equal(damage.length, 1);
});

test('pooled incident hulls take bounded shove, yaw, and heel then reset cleanly', () => {
  const { director } = makeDirector(), hull = director.rigs.runner.agent;
  director.phys = { pos: { x: 3, y: -2 } };
  Object.assign(hull, { x: 0, z: 0, heading: 0.35, speed: 8, yawKick: 0, heelKick: 0, impactCd: 0 });

  assert.equal(director.impactAgent(hull, 10, 0.8, 0.6, 0.48, 1.6), true);
  const shove = Math.hypot(hull.shx, hull.shz), yaw = Math.abs(hull.yawKick), heel = Math.abs(hull.heelKick);
  assert.ok(shove > 4.7 && shove <= 5.2);
  assert.ok(yaw > 0 && yaw <= 1.1);
  assert.ok(heel > 0 && heel <= 0.22);
  assert.equal(director.impactAgent(hull, 10, 0.8, 0.6, 0.48, 1.6), false);

  director.decayAgentImpact(hull, 0.2);
  assert.ok(Math.hypot(hull.shx, hull.shz) < shove);
  assert.ok(Math.abs(hull.yawKick) < yaw);
  assert.ok(Math.abs(hull.heelKick) < heel);
  assert.equal(hull.impactCd, 0);

  const retained = hull; director.resetAgentImpact(hull);
  assert.equal(hull, retained);
  assert.deepEqual([hull.shx, hull.shz, hull.yawKick, hull.heelKick, hull.impactCd], [0, 0, 0, 0, 0]);
});

test('a recycled incident hull clears its old impact pose before becoming visible', () => {
  const director = Object.create(WorldIncidents.prototype), pose = { position: null, rotation: null };
  director.water = { waveHeight: () => 1.4 };
  const hull = {
    mesh: {
      position: { set: (...values) => { pose.position = values; } },
      rotation: { set: (...values) => { pose.rotation = values; } },
      visible: false,
    },
    shx: 2, shz: -1, yawKick: 0.7, heelKick: -0.18, impactCd: 0.12,
  };

  director.setAgent(hull, 18, -9, 0.65, 7);

  assert.deepEqual([pose.position[0], pose.position[2]], [18, -9]);
  assert.ok(Math.abs(pose.position[1] - 1.35) < 1e-9);
  assert.deepEqual(pose.rotation, [0, 0.65, 0, 'YXZ']);
  assert.deepEqual([hull.shx, hull.shz, hull.yawKick, hull.heelKick, hull.impactCd], [0, 0, 0, 0, 0]);
  assert.equal(hull.mesh.visible, true);
});

test('FWC incident intercepts exchange opposite impulses across the same pooled hulls', () => {
  const { director } = makeDirector(), patrol = director.rigs.patrol.agent, runner = director.rigs.runner.agent;
  director.phys = { pos: { x: 40, y: 40 } };
  director.active = { type: 'pursuit', state: 'running', resolved: '', interceptCd: 0, intercepts: 0, catchT: 0 };
  Object.assign(patrol, { x: 0, z: 0, heading: Math.PI / 2, speed: 12, active: true, shx: 0, shz: 0, yawKick: 0, heelKick: 0, impactCd: 0 });
  Object.assign(runner, { x: -4, z: 2, heading: Math.PI / 2, speed: 7, active: true, shx: 0, shz: 0, yawKick: 0, heelKick: 0, impactCd: 0 });
  const distance = Math.hypot(runner.x - patrol.x, runner.z - patrol.z);

  assert.equal(director.attemptIncidentIntercept(director.active, patrol, runner, distance), true);
  assert.equal(director.active.intercepts, 1);
  assert.ok(director.active.interceptCd > 0);
  assert.ok(patrol.shx > 0 && patrol.shz < 0);
  assert.ok(runner.shx < 0 && runner.shz > 0);
  assert.ok(patrol.shx * runner.shx + patrol.shz * runner.shz < 0);
  assert.ok(Math.hypot(patrol.shx, patrol.shz) <= 5.2);
  assert.ok(Math.hypot(runner.shx, runner.shz) <= 5.2);
  assert.ok(Math.abs(patrol.yawKick) <= 1.1 && Math.abs(runner.yawKick) <= 1.1);
  assert.ok(Math.abs(patrol.heelKick) <= 0.22 && Math.abs(runner.heelKick) <= 0.22);
  assert.equal(director.attemptIncidentIntercept(director.active, patrol, runner, distance), false);
});

test('incident collision telemetry keeps the fixed three-boat and one-kayak pools', () => {
  const { director } = makeDirector();
  director.agents = [director.rigs.patrol.agent, director.rigs.runner.agent, director.rigs.victim.agent];
  director.obs = [{}, {}];
  director.active = { type: 'pursuit', intercepts: 3 };
  director.rigs.runner.agent.shx = 0.8;

  assert.deepEqual(director.resourceStats(), {
    active: true,
    type: 'pursuit',
    pooledAgents: 3,
    pooledBoats: 3,
    pooledKayaks: 1,
    activeAgents: 3,
    reactingAgents: 1,
    obstacles: 2,
    intercepts: 3,
  });
});
