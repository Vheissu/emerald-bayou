import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WorldHeight } from '../src/heightfield.js';
import { buildMooredSkiffs, mooringSag, stepMooringMotion, updateMooredSkiffs } from '../src/mooredskiffs.js';
import { COVE_MOORINGS, MOORING_TRAVEL, waterfrontWaterOccupied } from '../src/waterfrontlayout.js';

test('slack produces sag and a gust can pull the line straight', () => {
  assert.ok(mooringSag(0.75, 0.89) > 0.14);
  assert.ok(mooringSag(0.85, 0.89) < mooringSag(0.75, 0.89));
  assert.equal(mooringSag(0.91, 0.89), 0);
});

test('boat spring lines and fenders limit travel and recenter the skiff', () => {
  for (const side of [-1, 1]) {
    const motion = { x: 0, z: 0, vx: 0, vz: 0, yaw: 0, yawRate: 0, side };
    for (let i = 0; i < 280; i++) stepMooringMotion(motion, 1 / 60, 6, -9 * side, 6);
    assert.equal(motion.x, MOORING_TRAVEL.end);
    assert.equal(motion.z, -side * MOORING_TRAVEL.inward);
    assert.equal(motion.yaw, MOORING_TRAVEL.yaw);
    for (let i = 0; i < 280; i++) stepMooringMotion(motion, 1 / 60, 0, 0, 0);
    assert.ok(Math.hypot(motion.x, motion.z, motion.yaw) < 0.005);
  }
});

test('skiffs follow the water with lines attached and hull collisions outside swimming water', () => {
  const boats = buildMooredSkiffs(new THREE.Group()), h = new WorldHeight(7);
  const ctx = { bx: -16, bz: 13, residentDt: 1 / 60, playerWakeAt: (x, z) => 0.12 + 0.04 * (x - COVE_MOORINGS[0].x) };
  const environment = { gust: 1.2, windDir: new THREE.Vector3(0, 0, 1), sampleWindAt: () => 18 };
  assert.equal(boats.length, 2);
  for (let t = 0; t < 180; t++) updateMooredSkiffs(boats, t / 60, () => 0.42, ctx, environment);
  for (const boat of boats) {
    const { pier, side } = boat.berth;
    const { x, y, z } = boat.mesh.position;
    assert.ok(y > 0.43, 'elevated tide reaches the hull');
    assert.ok(Math.abs(boat.pitch) > 0.01, 'wake slope pitches the hull');
    assert.ok(boat.obstacle.bx < x && boat.obstacle.ax > x);
    assert.ok(pier.z < 0 ? z + boat.obstacle.r < 2 : z - boat.obstacle.r > 25);
    assert.ok(h.compute(x - 2.1, z) < -2);
    assert.equal(waterfrontWaterOccupied(x, z), true);
    assert.equal(waterfrontWaterOccupied(5, z), false);
    for (const line of boat.lines) {
      const vertices = line.mesh.geometry.attributes.position, ring = vertices.count / 13;
      const center = new THREE.Vector3(), vertex = new THREE.Vector3();
      for (let i = vertices.count - ring; i < vertices.count; i++) center.add(vertex.fromBufferAttribute(vertices, i));
      center.divideScalar(ring);
      assert.ok(center.distanceTo(boat.mesh.localToWorld(line.eye.clone())) < 0.00001);
      assert.ok(Math.sign(line.post.z - pier.z) === side);
    }
  }
});

test('a crew leaves its lines on the pier, fishes at anchor and ties up again in a squall', () => {
  const boats = buildMooredSkiffs(new THREE.Group()), [boat] = boats;
  const terrain = new WorldHeight(7);
  const ctx = { bx: 31, bz: 39, vx: 0, vz: 0, speed: 0, residentDt: .05, ob: 0,
    heightAt: (x,z) => terrain.compute(x,z) };
  const weather = { daylight: 1, waterLevel: 0, sampleWindAt: () => 3,
    windDir: new THREE.Vector3(1,0,0), values: {storm: 0} };
  let time = 0;
  function until(check, limit) {
    const stop = time + limit;
    while (!check() && time < stop) {
      time += ctx.residentDt;
      updateMooredSkiffs(boats, time, () => 0, ctx, weather);
    }
    assert.ok(check(), 'expected trip event by ' + stop + 's');
  }
  until(() => boat.crew.rigging === 'soaking' && boat.anchor.paid === 1, 65);
  assert.ok(boat.trip.active && boat.lines.every(line => line.coil.visible && !line.mesh.visible));
  assert.ok(ctx.ob > 0 && boat.anchor.mesh.visible && boat.crew.float.visible);
  const bottom = boat.anchor.bottom.clone();
  assert.equal(bottom.y, terrain.compute(bottom.x, bottom.z));
  assert.ok(boat.mesh.position.distanceTo(new THREE.Vector3(boat.berth.x,0,boat.berth.z)) > 45);
  assert.ok(Math.hypot(boat.obstacle.ax - boat.mesh.position.x, boat.obstacle.az - boat.mesh.position.z) < 1.5);
  weather.values.storm = .8;
  until(() => boats.every(b => b.trip.secured), 90);
  assert.ok(boat.lines.every(line => line.mesh.visible && !line.coil.visible));
  assert.equal(boat.anchor.mesh.visible, false);
  assert.equal(boat.crew.line.visible, false);
  assert.equal(boat.trip.active, false);
});

test('helping unload secures a line to the nearest player cleat and holds the berth', () => {
  const group = new THREE.Group(), boats = buildMooredSkiffs(group);
  const [boat] = boats, playerHull = new THREE.Group();
  playerHull.position.set(boat.berth.x + 8, .2, boat.berth.z + 1);
  playerHull.rotation.y = -.45;
  const ctx = { bx: playerHull.position.x, bz: playerHull.position.z, residentDt: .05,
    catchHelp: {at: {index: 0}}, playerHull };
  boat.trip.timer = 0;
  updateMooredSkiffs(boats, 1, () => 0, ctx);
  assert.ok(boat.trip.secured && boat.trip.timer > 7);
  assert.ok(boat.workLine.mesh.visible && !boats[1].workLine.mesh.visible);
  const local = playerHull.worldToLocal(boat.workLine.end.clone());
  assert.ok(Math.abs(Math.abs(local.x) - 1.05) < 1e-8);
  const cleat = boat.workLine.eye.clone();
  playerHull.position.z += .17;
  updateMooredSkiffs(boats, 1.05, () => 0, ctx);
  assert.ok(boat.workLine.end.distanceTo(playerHull.localToWorld(cleat)) < 1e-8);
  ctx.catchHelp = null;
  updateMooredSkiffs(boats, 1.1, () => 0, ctx);
  assert.equal(boat.workLine.mesh.visible, false);
});
