import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  DirectedNavigationLights, SMALL_POWER_NAVIGATION_LIGHT_LAYOUT,
} from '../src/vesselnavigationlights.js';

const night = { hour: 23, night: 1, restrictedVisibility: 0, values: { storm: 0 } };
const day = { hour: 12, night: 0, restrictedVisibility: 0, values: { storm: 0 } };

function sourceFor(vessels) {
  return {
    visitActiveVessels(visitor) {
      for (const vessel of vessels) visitor(vessel.x, vessel.z, vessel.speed || 0, vessel.kind || 'skiff', vessel);
    },
  };
}

function translation(mesh, index = 0) {
  const matrix = new THREE.Matrix4(); mesh.getMatrixAt(index, matrix);
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

test('directed navigation lights obey legal viewing sectors and remain off by day', () => {
  const scene = new THREE.Scene(), lights = new DirectedNavigationLights(scene, { capacity: 3, maxDistance: 100 });
  const mesh = new THREE.Group(); mesh.position.y = 0.25;
  const vessel = { x: 10, z: 20, heading: 0, speed: 5, mesh, navigationLights: true };
  const sources = [sourceFor([vessel])];

  lights.update(sources, { x: 10, z: 0 }, night);
  assert.deepEqual(lights.resourceStats(), {
    capacity: 3, active: true, vessels: 1, port: 1, starboard: 1, stern: 0,
    droppedLights: 0, drawCalls: 2, geometries: 1, materials: 3, textures: 0, pointLights: 0, instanceBytes: 576,
  });
  const port = translation(lights.port);
  assert.ok(Math.abs(port.x - (vessel.x + SMALL_POWER_NAVIGATION_LIGHT_LAYOUT.port.x)) < 1e-6);
  assert.ok(Math.abs(port.y - (mesh.position.y + SMALL_POWER_NAVIGATION_LIGHT_LAYOUT.port.y)) < 1e-6);
  assert.ok(Math.abs(port.z - (vessel.z + SMALL_POWER_NAVIGATION_LIGHT_LAYOUT.port.z)) < 1e-6);

  lights.update(sources, { x: -10, z: 20 }, night);
  assert.deepEqual([lights.port.count, lights.starboard.count, lights.stern.count], [1, 0, 0]);
  lights.update(sources, { x: 30, z: 20 }, night);
  assert.deepEqual([lights.port.count, lights.starboard.count, lights.stern.count], [0, 1, 0]);
  lights.update(sources, { x: 10, z: 40 }, night);
  assert.deepEqual([lights.port.count, lights.starboard.count, lights.stern.count], [0, 0, 1]);

  lights.update(sources, { x: 10, z: 0 }, day);
  assert.equal(lights.group.visible, false);
  assert.deepEqual([lights.port.count, lights.starboard.count, lights.stern.count], [0, 0, 0]);
});

test('dark-running, non-skiff and distant craft never enter the render pool', () => {
  const lights = new DirectedNavigationLights(new THREE.Scene(), { capacity: 3, maxDistance: 100 });
  const mesh = new THREE.Group();
  lights.update([sourceFor([
    { x: 0, z: 0, heading: 0, mesh, navigationLights: false },
    { x: 0, z: 0, heading: 0, mesh, navigationLights: true, kind: 'canoe' },
    { x: 0, z: 240, heading: 0, mesh, navigationLights: true },
  ])], { x: 0, z: 0 }, night);
  assert.deepEqual([lights.port.count, lights.starboard.count, lights.stern.count], [0, 0, 0]);
  assert.equal(lights.vessels, 0);
  assert.equal(lights.resourceStats().drawCalls, 0);
});

test('the fixed pool stays bounded and reuses all GPU-facing resources', () => {
  const scene = new THREE.Scene(), lights = new DirectedNavigationLights(scene, { capacity: 2, maxDistance: 100 });
  const mesh = new THREE.Group();
  const vessels = Array.from({ length: 5 }, () => ({ x: 0, z: 0, heading: 0, mesh, navigationLights: true }));
  const sources = [sourceFor(vessels)], observer = { x: 0, z: 0 };
  const group = lights.group, children = [...group.children];
  const geometries = children.map(child => child.geometry), materials = children.map(child => child.material);
  const matrices = children.map(child => child.instanceMatrix.array);

  for (let i = 0; i < 2_000; i++) lights.update(sources, observer, night);
  assert.equal(lights.group, group);
  assert.deepEqual(group.children, children);
  assert.deepEqual(children.map(child => child.geometry), geometries);
  assert.deepEqual(children.map(child => child.material), materials);
  assert.deepEqual(children.map(child => child.instanceMatrix.array), matrices);
  assert.deepEqual([lights.port.count, lights.starboard.count, lights.stern.count], [2, 2, 2]);
  assert.equal(lights.vessels, 2);
  assert.equal(lights.droppedLights, 9);
  assert.deepEqual(lights.resourceStats(), {
    capacity: 2, active: true, vessels: 2, port: 2, starboard: 2, stern: 2,
    droppedLights: 9, drawCalls: 3, geometries: 1, materials: 3, textures: 0, pointLights: 0, instanceBytes: 384,
  });
  assert.equal(scene.children.length, 1);
  assert.equal(group.children.length, 3);

  const second = new DirectedNavigationLights(new THREE.Scene(), { capacity: 1 });
  assert.equal(second.port.geometry, lights.port.geometry);
  assert.equal(second.port.material, lights.port.material);
  assert.equal(second.starboard.material, lights.starboard.material);
  assert.equal(second.stern.material, lights.stern.material);

  lights.clear();
  assert.deepEqual([lights.port.count, lights.starboard.count, lights.stern.count], [0, 0, 0]);
  assert.equal(lights.group.visible, false);
});
