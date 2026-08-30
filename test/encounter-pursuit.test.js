import test from 'node:test';
import assert from 'node:assert/strict';
import { EncounterDirector } from '../src/encounters.js';

test('coordinated pursuit schedules each pooled backup once and keeps the fleet bounded', () => {
  const director = Object.create(EncounterDirector.prototype), deployed = [];
  director.rigs = { patrolBackups: [{ agent: { active: false } }, { agent: { active: false } }] };
  director.deployPatrolBackup = (e, index) => {
    deployed.push(index); director.rigs.patrolBackups[index].agent.active = true; e.backupCount++; e.units = 1 + e.backupCount; return true;
  };
  const e = { pursuit: 0, backupRequested: 0, backupCount: 0, units: 1, backupDue: [Infinity, Infinity] };

  director.schedulePatrolBackups(e, 2, 0);
  assert.equal(e.backupRequested, 1); assert.equal(e.backupDue[0], 8.5); assert.deepEqual(deployed, []);
  e.pursuit = 8.49; director.schedulePatrolBackups(e, 2, 0); assert.deepEqual(deployed, []);
  e.pursuit = 8.5; director.schedulePatrolBackups(e, 2, 0); assert.deepEqual(deployed, [0]); assert.equal(e.units, 2);

  director.schedulePatrolBackups(e, 4, 0); assert.equal(e.backupRequested, 2); assert.equal(e.backupDue[1], 20.5);
  e.pursuit = 20.5; director.schedulePatrolBackups(e, 4, 0); assert.deepEqual(deployed, [0, 1]); assert.equal(e.units, 3);
  e.pursuit = 200; director.schedulePatrolBackups(e, 5, 0); assert.deepEqual(deployed, [0, 1]);
});

test('five-star aviation schedules once and waits on unsafe weather', () => {
  const director = Object.create(EncounterDirector.prototype), deployed = [];
  director.environment = { values: { wind: 12, storm: 0.25 }, gust: 1 };
  director.deployPatrolAviation = (e, t) => { deployed.push(t); e.aviationActive = true; return true; };
  const e = { pursuit: 0, aviationRequested: false, aviationDue: Infinity, aviationActive: false };

  director.schedulePatrolAviation(e, 4, 1);
  assert.equal(e.aviationRequested, false); assert.deepEqual(deployed, []);
  director.schedulePatrolAviation(e, 5, 1);
  assert.equal(e.aviationRequested, true); assert.equal(e.aviationDue, 9.5); assert.deepEqual(deployed, []);
  e.pursuit = 9.49; director.schedulePatrolAviation(e, 5, 2); assert.deepEqual(deployed, []);
  director.environment.values.wind = 26; e.pursuit = 9.5; director.schedulePatrolAviation(e, 5, 3);
  assert.deepEqual(deployed, []); assert.equal(e.aviationDue, 12);
  director.environment.values.wind = 10; e.pursuit = 12; director.schedulePatrolAviation(e, 5, 4);
  assert.deepEqual(deployed, [4]); assert.equal(e.aviationActive, true);
  e.pursuit = 100; director.schedulePatrolAviation(e, 5, 5); assert.deepEqual(deployed, [4]);
});

test('the nearest active patrol unit holds the pursuit line', () => {
  const director = Object.create(EncounterDirector.prototype);
  director.phys = { pos: { x: 0, y: 0 } };
  director.rigs = {
    patrol: { agent: { active: true, x: 120, z: 0 } },
    patrolBackups: [{ agent: { active: true, x: 0, z: 42 } }, { agent: { active: false, x: 8, z: 0 } }],
  };
  assert.equal(director.patrolNearestDistance(), 42);
  director.rigs.patrolBackups[1].agent.active = true; assert.equal(director.patrolNearestDistance(), 8);
});

test('surface pursuit perception checks banks at AI cadence and any clear unit can hold visual', () => {
  const director = Object.create(EncounterDirector.prototype);
  director.phys = { pos: { x: 100, y: 0 } }; director.environment = { waterLevel: 0 };
  director.terrain = { heightAt(x, z) { return x > 42 && x < 58 && Math.abs(z) < 8 ? 0.2 : -2; } };
  director.rigs = {
    patrol: { agent: { active: true, x: 0, z: 0 } },
    patrolBackups: [{ agent: { active: true, x: 60, z: 100 } }, { agent: { active: false, x: 80, z: 0 } }],
  };
  director.resetPatrolSight();
  assert.equal(director.patrolSurfaceVisual(0.2, 180), true);
  assert.equal(director._patrolSight.clear, true); assert.equal(director._patrolSight.checkedUnits, 2);

  director.rigs.patrolBackups[0].agent.active = false; director._patrolSight.timer = 0;
  assert.equal(director.patrolSurfaceVisual(0.2, 180), true);
  assert.equal(director.patrolSurfaceVisual(0.2, 180), false);
  assert.equal(director._patrolSight.occluded, true); assert.ok(director._patrolSight.samples > 0);

  director.terrain.heightAt = () => -2; director._patrolSight.timer = 0;
  assert.equal(director.patrolSurfaceVisual(0.06, 180), false);
  assert.equal(director.patrolSurfaceVisual(0.06, 180), true);
});

test('backup rams use one shared contact window and damage the player craft', () => {
  const director = Object.create(EncounterDirector.prototype), damage = [];
  director.phys = {
    pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 }, hit: 0, hitNormal: { set(x, z) { this.x = x; this.z = z; } },
    hitTag: '', angVel: 0, rollVel: 0,
  };
  director.condition = { damage: (...values) => damage.push(values) };
  director.law = { stats: {} }; director.audio = { thud() {} }; director.game = { shake: 0, toast() {} };
  const e = { contactCd: 0, ramCd: 0 }, R = { agent: { x: 0, z: 5, heading: 0, speed: 10 } };

  assert.equal(director.attemptPatrolRam(e, R, 1, 5, 3, 3), true);
  assert.ok(e.contactCd > 0 && e.ramCd > 0); assert.ok(director.phys.vel.y < 0); assert.equal(director.phys.hitTag, 'boat');
  assert.equal(damage.length, 1); assert.equal(director.law.stats.backupContacts, 1);
  assert.equal(director.attemptPatrolRam(e, R, 2, 5, 4, 4), false); assert.equal(damage.length, 1);
});

test('a high-wanted shallow-water unit places its closure ahead and broadside in clear water', () => {
  const director = Object.create(EncounterDirector.prototype);
  director.phys = { pos: { x: 10, y: 20 }, vel: { x: 0, y: -12 }, heading: 0, speed: 12 };
  director.environment = { waterLevel: 0 }; director.terrain = { heightAt: () => -2 }; director.world = { blockedAt: () => false };
  director.law = { stats: {} };
  const closure = { active: false, holding: false, announced: false, x: 0, z: 0, courseX: 0, courseZ: -1, heading: 0, remaining: 0, cooldown: 0, plan: {} };
  const R = { role: 2, agent: { active: true, x: 130, z: 60, heading: 0 }, closure };

  assert.equal(director.beginPatrolChannelClosure({ tacticSide: 1 }, R, 4, true), true);
  assert.equal(closure.active, true); assert.ok(closure.z < director.phys.pos.y - 80);
  const patrolForwardX = -Math.sin(closure.heading), patrolForwardZ = -Math.cos(closure.heading);
  assert.ok(Math.abs(patrolForwardX * closure.courseX + patrolForwardZ * closure.courseZ) < 1e-9);
  assert.equal(director.law.stats.channelClosures, 1);
});

test('the channel-closing backup deploys farther ahead and closer to the working cut', () => {
  const director = Object.create(EncounterDirector.prototype);
  director.phys = { pos: { x: 0, y: 0 }, vel: { x: 0, y: -12 }, heading: 0 };
  director.environment = { waterLevel: 0 }; director.terrain = { heightAt: () => -2 }; director.world = { blockedAt: () => false };
  const intercept = director.patrolBackupSpot(0, { tacticSide: 1 }), closure = director.patrolBackupSpot(1, { tacticSide: 1 });
  assert.ok(-intercept.z >= 52 && -intercept.z <= 67); assert.ok(Math.abs(intercept.x) >= 118 && Math.abs(intercept.x) <= 130);
  assert.ok(-closure.z >= 132 && -closure.z <= 152); assert.ok(Math.abs(closure.x) >= 78 && Math.abs(closure.x) <= 88);
});

test('a channel closure is deferred when the predicted line is shallow or obstructed', () => {
  const director = Object.create(EncounterDirector.prototype);
  director.phys = { pos: { x: 0, y: 0 }, vel: { x: 0, y: -10 }, heading: 0, speed: 10 };
  director.environment = { waterLevel: 0 }; director.terrain = { heightAt: () => -0.2 }; director.world = { blockedAt: () => false };
  const closure = { active: false, holding: false, cooldown: 0, plan: {} };
  const R = { role: 2, agent: { active: true, x: 100, z: 40, heading: 0 }, closure };

  assert.equal(director.beginPatrolChannelClosure({ tacticSide: -1 }, R, 5, true), false);
  assert.equal(closure.active, false); assert.equal(closure.cooldown, 2.5);
});
