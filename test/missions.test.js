import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Game, buildMissions } from '../src/game.js';
import { WorldHeight } from '../src/heightfield.js';

function missionGame() {
  const height = new WorldHeight(7);
  const T = {
    bars: height.bars, lagoon: height.lagoon,
    heightAt: (x, z) => height.compute(x, z),
    riverCenterX: z => height.riverCenterX(z), riverHalfWidth: z => height.riverHalfWidth(z),
  };
  const startZ = 70, startX = T.riverCenterX(startZ);
  const skiff = {
    pos: new THREE.Vector2(), heading: 0, speed: 0, i: 0, active: false, done: false, starts: 0, updates: 0, stops: 0,
    start(path, speed, lookAhead) { this.path = path; this.speed = speed; this.lookAhead = lookAhead; this.pos.set(path[0].x, path[0].z); this.heading = Math.atan2(-(path[1].x - path[0].x), -(path[1].z - path[0].z)); this.i = 0; this.active = true; this.done = false; this.starts++; },
    update() { this.updates++; },
    stop() { this.active = false; this.stops++; },
  };
  return {
    T, startX, startZ, dockTie: { x: startX + 8, z: startZ - 12 }, scene: new THREE.Scene(), boat: new THREE.Group(),
    phys: { loaded: 0, pos: new THREE.Vector2(startX, startZ), heading: 0 }, skiff,
    beacon: { set() {}, hide() {} }, beacon2: { set() {}, hide() {} },
    audio: { checkpoint() {}, warn() {}, pickup() {} }, toast() {},
    beginMissionRival() { this.rivalCollider = true; }, syncMissionRival() { this.rivalSyncs = (this.rivalSyncs || 0) + 1; }, endMissionRival() { this.rivalCollider = false; },
    dist(x, z) { return Math.hypot(this.phys.pos.x - x, this.phys.pos.y - z); },
    river(z, side = 0) { return { x: T.riverCenterX(z) + side * T.riverHalfWidth(z) * 0.45, z }; },
    headingTo(ax, az, bx, bz) { return Math.atan2(-(bx - ax), -(bz - az)); },
    findSpot(seed, zMin) { return { x: T.riverCenterX(zMin) + 60, z: zMin, h: -1 }; },
  };
}

test('adds the three race formats after the existing campaign', () => {
  const G = missionGame(), missions = buildMissions(G);
  assert.deepEqual(missions.slice(-3).map(m => m.id), ['splits', 'rampcircuit', 'relay']);
  assert.equal(missions.length, 16);

  const splitState = {}; missions.at(-3).setup(splitState, G);
  assert.ok(splitState.limitOverride > 0);

  const rampStart = missions.at(-2).start(G);
  assert.ok(Number.isFinite(rampStart.x) && Number.isFinite(rampStart.z) && Number.isFinite(rampStart.heading));
});

test('campaign sprint and grand tour reuse one physical rival and fail when it crosses first', () => {
  for (const id of ['sprint', 'tour']) {
    const G = missionGame(), mission = buildMissions(G).find(candidate => candidate.id === id), state = {};
    mission.setup(state, G);
    assert.equal(state.rivalRace, true);
    assert.equal(G.skiff.starts, 1);
    assert.equal(G.skiff.speed, 11.4);
    assert.equal(G.skiff.lookAhead, 8);
    assert.equal(G.rivalCollider, true);
    assert.ok(G.skiff.path.length > 2);

    G.skiff.done = true; G.skiff.i = G.skiff.path.length - 1;
    assert.deepEqual(mission.update(state, G, 1 / 60, 0), { fail: 'Mud Hen crossed first.' });
    assert.match(mission.hud(state, G).sub, /Mud Hen/);
    const markers = []; mission.markers(state, G, markers);
    assert.equal(markers.at(-1).x, G.skiff.pos.x);
    assert.equal(markers.at(-1).z, G.skiff.pos.y);

    mission.cleanup(state, G);
    assert.equal(G.skiff.active, false);
    assert.equal(G.skiff.stops, 1);
    assert.equal(G.rivalCollider, false);
  }
});

test('mission rival contact slows the johnboat once per cooldown and leaves a retained collider record', () => {
  const impacts = [];
  const game = Object.assign(Object.create(Game.prototype), {
    state: { rivalRace: true, rivalHitCd: 0, rivalRams: 0 },
    skiff: { active: true, pos: new THREE.Vector2(8, 12), heading: 0, speed: 10, applyImpact(...args) { impacts.push(args); } },
    phys: { pos: new THREE.Vector2(7, 9) },
    missionRivalObstacles: [], missionRivalObstacle: { ax: 0, az: 0, bx: 0, bz: 0 },
    shake: 0, audio: { warn() {} }, toast() {},
  });
  game.beginMissionRival();
  assert.equal(game.missionRivalObstacles[0], game.missionRivalObstacle);
  assert.deepEqual([game.missionRivalObstacle.ax, game.missionRivalObstacle.az, game.missionRivalObstacle.bx, game.missionRivalObstacle.bz], [8, 10, 8, 14]);

  game.hitMissionRival(4, -1, 0);
  assert.equal(game.state.rivalRams, 1);
  assert.ok(game.skiff.speed < 10);
  assert.deepEqual(impacts, [[4, -1, 0, 3]]);
  const speed = game.skiff.speed; game.hitMissionRival(8, 1, 0);
  assert.equal(game.state.rivalRams, 1);
  assert.equal(game.skiff.speed, speed);
  assert.equal(impacts.length, 1);
  game.endMissionRival();
  assert.equal(game.missionRivalObstacles.length, 0);
});

test('dispatch relay removes every temporary case during cleanup', () => {
  const G = missionGame(), relay = buildMissions(G).at(-1), state = {};
  relay.setup(state, G);
  assert.equal(state.cases.length, 3);
  assert.equal(G.scene.children.length, 3);

  relay.attach(state, G);
  assert.equal(state.stage, 'route');
  assert.equal(state.cases[0].m.parent, G.boat);
  assert.equal(G.phys.loaded, 0.42);

  relay.eject(state, G, 'Test collision');
  assert.equal(state.stage, 'recover');
  assert.equal(state.cases[0].m.parent, G.scene);
  relay.attach(state, G, true);
  assert.equal(state.cases[0].m.parent, G.boat);

  relay.cleanup(state, G);
  assert.equal(G.scene.children.length, 0);
  assert.ok(state.cases.every(box => box.m.parent === null));
});
