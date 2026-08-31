import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BOAT_CAMERA_CHASE, BOAT_CAMERA_HELM, CHASE_CAMERA_SAMPLES, boatCameraPitch,
  chaseCameraBoomLimit, chaseCameraBoomStep, helmCameraDirection, nextBoatCameraMode, normalizeBoatCameraMode,
} from '../src/chasecamera.js';

const boom = (overrides = {}) => ({
  startX: 0, startY: 2.2, startZ: 0,
  endX: 0, endY: 4.2, endZ: 12,
  waterLevel: 0, clearance: 0.9, minFraction: 0.2,
  safetyMargin: 0.03, samples: CHASE_CAMERA_SAMPLES,
  ...overrides,
});

test('flat water leaves the full chase camera boom available', () => {
  assert.equal(chaseCameraBoomLimit(boom(), () => -2), 1);
});

test('a bank between the boat and ideal camera retracts before the obstruction', () => {
  const limit = chaseCameraBoomLimit(boom(), (x, z) => z >= 4.5 && z <= 7 ? 3.4 : -2);
  assert.ok(limit >= 0.2); assert.ok(limit < 0.4);
  const z = 12 * limit;
  assert.ok(z < 4.5, `resolved camera should remain before the bank, got z=${z}`);
});

test('endpoint terrain is included in the boom clearance test', () => {
  const limit = chaseCameraBoomLimit(boom(), (x, z) => z > 10 ? 5 : -2);
  assert.ok(limit < 0.9);
});

test('water level is a camera floor during storm surge', () => {
  assert.equal(chaseCameraBoomLimit(boom({ startY: 1.5, endY: 1.8, waterLevel: 1.2 }), () => -3), 0.2);
});

test('invalid terrain samples fall back to the water plane without poisoning the camera', () => {
  assert.equal(chaseCameraBoomLimit(boom(), () => Number.NaN), 1);
  assert.equal(chaseCameraBoomLimit(boom({ waterLevel: Number.NaN }), () => Number.NaN), 1);
  assert.equal(chaseCameraBoomLimit(boom({ endX: Number.NaN }), () => 10), 1);
});

test('boom response cuts inward immediately and recovers gradually', () => {
  assert.equal(chaseCameraBoomStep(1, 0.34, 1 / 60), 0.34);
  const firstRecovery = chaseCameraBoomStep(0.34, 1, 1 / 60);
  assert.ok(firstRecovery > 0.34); assert.ok(firstRecovery < 0.38);
  let recovered = 0.34;
  for (let frame = 0; frame < 120; frame++) recovered = chaseCameraBoomStep(recovered, 1, 1 / 60);
  assert.ok(recovered > 0.99); assert.ok(recovered <= 1);
});

test('boat camera modes cycle predictably and reject unknown saved values', () => {
  assert.equal(normalizeBoatCameraMode('cinematic'), BOAT_CAMERA_CHASE);
  assert.equal(normalizeBoatCameraMode(BOAT_CAMERA_HELM), BOAT_CAMERA_HELM);
  assert.equal(nextBoatCameraMode(BOAT_CAMERA_CHASE), BOAT_CAMERA_HELM);
  assert.equal(nextBoatCameraMode(BOAT_CAMERA_HELM), BOAT_CAMERA_CHASE);
});

test('helm look reuses caller output and follows yaw and constrained pitch', () => {
  const direction = {};
  assert.equal(helmCameraDirection(0, 0, direction), direction);
  assert.ok(Math.abs(direction.x) < 1e-12); assert.ok(Math.abs(direction.y) < 1e-12); assert.equal(direction.z, -1);
  helmCameraDirection(-Math.PI / 2, 0, direction);
  assert.ok(Math.abs(direction.x - 1) < 1e-12); assert.ok(Math.abs(direction.y) < 1e-12); assert.ok(Math.abs(direction.z) < 1e-12);
  helmCameraDirection(0, 5, direction);
  assert.ok(direction.y < -0.49); assert.ok(direction.z < -0.86);
  assert.equal(boatCameraPitch(-2, BOAT_CAMERA_HELM), -0.52);
  assert.equal(boatCameraPitch(-2, BOAT_CAMERA_CHASE), -0.25);
  assert.equal(boatCameraPitch(2, BOAT_CAMERA_HELM), 0.52);
  assert.equal(boatCameraPitch(2, BOAT_CAMERA_CHASE), 0.6);
});

test('the live helm camera reuses retained vectors and is wired to keyboard and controller', () => {
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const cameraState = source.indexOf('  // ---- camera state ----');
  const frameStart = source.indexOf('  function frame() {'), cameraStart = source.indexOf('    // camera', frameStart);
  const cameraEnd = source.indexOf('    // Time, tide and weather', cameraStart);
  assert.ok(cameraState >= 0 && cameraState < frameStart && cameraEnd > cameraStart);
  const liveCamera = source.slice(cameraStart, cameraEnd);
  assert.match(source, /e\.code === 'KeyV'/);
  assert.match(source, /index === GAMEPAD_BUTTON\.LEFT_STICK/);
  assert.match(liveCamera, /cameraView === BOAT_CAMERA_HELM/);
  assert.match(liveCamera, /helmCameraDirection\(camYaw, camPitch, helmDirection\)/);
  assert.doesNotMatch(liveCamera, /new THREE\.(Vector|Quaternion|Euler|Matrix)/);
});
