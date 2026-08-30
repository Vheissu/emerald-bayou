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

test('an aligned patrol searchlight can reacquire beyond unaided night range but not through a bank', () => {
  const director = Object.create(EncounterDirector.prototype);
  director.phys = { pos: { x: 130, y: 0 } };
  director.environment = { waterLevel: 0, restrictedVisibility: 0, values: { storm: 0 } };
  director.terrain = { heightAt: () => -2 };
  const searchlight = { plan: { active: true, worldHeading: -Math.PI / 2 } };
  director.rigs = {
    patrol: { agent: { active: true, x: 0, z: 0 }, searchlight },
    patrolBackups: [{ agent: { active: false } }, { agent: { active: false } }],
  };

  director.resetPatrolSight();
  assert.equal(director.patrolSurfaceVisual(0.2, 100), true);
  assert.equal(director._patrolSight.directHeld, false); assert.equal(director._patrolSight.beamHeld, true);

  director.terrain.heightAt = x => x > 42 && x < 58 ? 0.2 : -2; director._patrolSight.timer = 0;
  assert.equal(director.patrolSurfaceVisual(0.2, 100), true);
  assert.equal(director.patrolSurfaceVisual(0.2, 100), false);
  assert.equal(director._patrolSight.occluded, true); assert.equal(director._patrolSight.beamHeld, false);

  director.terrain.heightAt = () => -2; searchlight.plan.worldHeading = 0; director.resetPatrolSight();
  assert.equal(director.patrolSurfaceVisual(0.2, 100), true);
  assert.equal(director.patrolSurfaceVisual(0.2, 100), false);
  assert.equal(director._patrolSight.occluded, false); assert.equal(director._patrolSight.beamUnits, 0);
});

test('engine noise behind a bank gives patrols an uncertain search fix without granting visual', () => {
  const director = Object.create(EncounterDirector.prototype), toasts = [], calls = [];
  director.phys = { pos: { x: 100, y: 0 }, rpm: 1, speed: 13, throttle: 1, wet: 1 };
  director.environment = { values: { wind: 3, rain: 0, storm: 0 } };
  director.rigs = { patrol: { agent: { active: true, x: 0, z: 0 } }, patrolBackups: [{ agent: { active: false } }, { agent: { active: false } }] };
  director.game = { toast: (...args) => toasts.push(args) }; director.radio = { transmit: call => calls.push(call) }; director.law = { stats: {} };
  director.resetPatrolSound();
  const e = { type: 'patrol', state: 'pursuit', pursuit: 4, lostT: 0.6, surfaceOccluded: true, lastKnownX: 0, lastKnownZ: 0, lastKnownHeading: 1.2 };

  assert.equal(director.patrolSurfaceSound(e, 0.25, 3, false), true);
  assert.equal(director._patrolSound.source, 'engine'); assert.equal(director._patrolSound.contact, true);
  assert.equal(e.lastKnownX, director._patrolSound.fixX); assert.equal(e.lastKnownZ, director._patrolSound.fixZ);
  assert.equal(e.lastKnownHeading, 1.2);
  assert.ok(Math.hypot(e.lastKnownX - director.phys.pos.x, e.lastKnownZ - director.phys.pos.y) >= 8);
  assert.equal(toasts.length, 1); assert.equal(calls.length, 1); assert.equal(director.law.stats.soundContacts, 1);

  director.phys.rpm = 0.18; director.phys.speed = 0; director.phys.throttle = 0; director._patrolSound.timer = 0;
  assert.equal(director.patrolSurfaceSound(e, 0.25, 3, false), false);
});

test('a prolonged horn can betray a quiet hull farther away than a normal blast', () => {
  const director = Object.create(EncounterDirector.prototype);
  director.phys = { pos: { x: 280, y: 0 }, rpm: 0.18, speed: 0, throttle: 0, wet: 1 };
  director.environment = { values: { wind: 3, rain: 0, storm: 0 } };
  director.rigs = { patrol: { agent: { active: true, x: 0, z: 0 } }, patrolBackups: [{ agent: { active: false } }, { agent: { active: false } }] };
  director.game = { toast() {} }; director.law = { stats: {} }; director.resetPatrolSound();
  const e = { type: 'patrol', state: 'pursuit', pursuit: 5, lostT: 0, surfaceOccluded: true, lastKnownX: 0, lastKnownZ: 0 }; director.active = e;

  assert.equal(director.notePlayerHorn(false), true); assert.equal(director.patrolSurfaceSound(e, 0.1, 3, false), false);
  director.resetPatrolSound(); assert.equal(director.notePlayerHorn(true), true);
  assert.equal(director.patrolSurfaceSound(e, 0.1, 3, false), true); assert.equal(director._patrolSound.source, 'fog horn');
  director.active = null; assert.equal(director.notePlayerHorn(true), false);
});

test('visual loss emits one retained last-fix uncertainty area and clears it on reacquisition', () => {
  const director = Object.create(EncounterDirector.prototype); director.game = { mapMarkers: [] };
  director._patrolSound = { uncertainty: 16, fixAge: 0.4 }; director.resetPatrolSearch();
  const e = { state: 'pursuit', visual: false, soundContact: true, lostT: 2.5, lastKnownX: 84, lastKnownZ: -31 };
  const area = director.markPatrolSearch(e, 3);
  assert.equal(director.pursuitSearchArea(), area); assert.equal(area.active, true); assert.deepEqual([area.x, area.z], [84, -31]); assert.ok(area.r > 22);
  assert.equal(director.game.mapMarkers.length, 1); assert.equal(director.game.mapMarkers[0].kind, 'search'); assert.equal(director.game.mapMarkers[0].r, area.r);
  e.visual = true; assert.equal(director.markPatrolSearch(e, 3), null); assert.equal(director.pursuitSearchArea(), null);
});

test('a patrol backup consumes its retained perimeter assignment when visual is broken', () => {
  const director = Object.create(EncounterDirector.prototype), movement = [];
  const agent = { active: true, x: 20, z: 10, heading: 0, speed: 4, decisionT: 0, search: { active: false }, tactic: {} };
  const backup = { role: 2, index: 0, agent, blueBulb: { visible: false }, redBulb: { visible: false } };
  director.phys = { pos: { x: 200, y: 180 }, heading: 0, speed: 9, vel: { x: 0, y: -9 } };
  director.rigs = { patrol: { agent: { active: false } }, patrolBackups: [backup] };
  director._patrolSound = { uncertainty: 0, fixAge: Infinity };
  director.updateAgent = (unit, dt, t, x, z, speed, holdRadius) => movement.push({ unit, x, z, speed, holdRadius });
  director.addPatrolBackupObstacle = () => {}; director.markPatrolBackup = () => {}; director.attemptPatrolRam = () => false;
  const e = { pursuit: 14, lostT: 6, lastKnownX: 120, lastKnownZ: 90, lastKnownHeading: 0.4, soundContact: false, tacticSide: 1 };

  director.updatePatrolBackup(e, backup, 0.1, 20, 4, 4, false);
  assert.equal(agent.search.active, true); assert.equal(agent.search.sector, 'outer exits'); assert.equal(movement.length, 1);
  assert.deepEqual([movement[0].x, movement[0].z, movement[0].speed, movement[0].holdRadius], [agent.search.targetX, agent.search.targetZ, agent.search.speed, agent.search.holdRadius]);
  assert.ok(agent.search.radius <= agent.search.areaRadius);
});

test('the retained pursuit spotlight follows a visual target and shuts down in clear daylight', () => {
  const director = Object.create(EncounterDirector.prototype), transforms = {};
  director.environment = { hour: 23, restrictedVisibility: 0.1, values: { storm: 0.15 } };
  director.water = { waveHeight: () => 0.4 };
  const searchlight = {
    active: false, plan: {}, rig: { visible: false, rotation: { y: 0 } }, light: { intensity: 0 },
    beam: {
      visible: false,
      scale: { set: (...values) => { transforms.scale = values; } },
      position: { set: (...values) => { transforms.position = values; } },
      rotation: { set: (...values) => { transforms.rotation = values; } },
    },
  };
  const R = { role: 0, agent: { active: true, x: 10, z: 20, heading: 0 }, searchlight };
  const e = { state: 'pursuit', pursuit: 8 };
  assert.equal(director.updatePatrolSearchlight(e, R, 4, true, 30, 20), true);
  assert.equal(searchlight.active, true); assert.equal(searchlight.rig.visible, true); assert.equal(searchlight.beam.visible, true); assert.ok(searchlight.light.intensity > 0);
  assert.deepEqual(transforms.scale, [searchlight.plan.width, searchlight.plan.length, 1]); assert.equal(transforms.position[1], 0.455);
  assert.equal(transforms.rotation[0], -Math.PI / 2); assert.equal(transforms.rotation[3], 'YXZ');

  director.environment.hour = 12; director.environment.restrictedVisibility = 0; director.environment.values.storm = 0;
  assert.equal(director.updatePatrolSearchlight(e, R, 5, true, 30, 20), false);
  assert.equal(searchlight.active, false); assert.equal(searchlight.rig.visible, false); assert.equal(searchlight.beam.visible, false); assert.equal(searchlight.light.intensity, 0);
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
