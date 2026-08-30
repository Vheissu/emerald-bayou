import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

const previousDocument = globalThis.document;
globalThis.document = {
  createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ fillRect() {}, fillText() {}, strokeRect() {} }),
  }),
};
const { createTrafficDriverPoseInput, updateTrafficDriverPose } = await import('../src/life.js');
if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;

function trafficAirboat() {
  const driver = new THREE.Group(); driver.position.set(0, 1.7, 0.4);
  return {
    driver, driverPoseInput: createTrafficDriverPoseInput(), speed: 0, max: 12,
    turn: 0, pitch: 0, roll: 0, heading: 0, surfaceWind: { x: 0, z: 0, speed: 0 },
    collision: { active: false },
  };
}

test('ambient airboat driver reuses retained state while bracing for acceleration, turns and weather', () => {
  const boat = trafficAirboat(), input = boat.driverPoseInput;
  const state = updateTrafficDriverPose(boat, 1 / 60, 0, 30);
  for (let frame = 1; frame <= 90; frame++) {
    boat.speed = frame / 90 * 9; boat.turn = 0.9; boat.pitch = 0.04; boat.roll = -0.06;
    boat.surfaceWind.x = 1; boat.surfaceWind.speed = 24;
    assert.equal(updateTrafficDriverPose(boat, 1 / 60, frame / 60, 30), state);
    assert.equal(boat.driverPoseInput, input);
  }
  assert.ok(input.apparentWind > 20);
  assert.ok(input.rpm > 0.7);
  assert.ok(boat.driver.rotation.z > 0.04);
  assert.ok(Math.abs(boat.driver.rotation.y) > 0.025);
});

test('ambient driver absorbs a collision once and animation LOD skips distant operators', () => {
  const boat = trafficAirboat(); boat.speed = 8; boat.turn = -0.7;
  const state = updateTrafficDriverPose(boat, 1 / 60, 1, 25);
  const beforePitchVelocity = state.pitchVelocity, beforeRollVelocity = state.rollVelocity;
  boat.driverPoseInput.hit = 9; boat.driverPoseInput.hitNormal.set(1, 0);
  updateTrafficDriverPose(boat, 1 / 60, 1.1, 25);
  assert.ok(state.pitchVelocity < beforePitchVelocity);
  assert.ok(state.rollVelocity > beforeRollVelocity);
  assert.equal(boat.driverPoseInput.hit, 0);

  const position = boat.driver.position.clone(), rotation = boat.driver.rotation.clone();
  boat.speed = 0; boat.turn = 1;
  assert.equal(updateTrafficDriverPose(boat, 1 / 60, 2, 121), null);
  assert.deepEqual(boat.driver.position.toArray(), position.toArray());
  assert.deepEqual(boat.driver.rotation.toArray(), rotation.toArray());
});
