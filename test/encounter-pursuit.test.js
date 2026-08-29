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
