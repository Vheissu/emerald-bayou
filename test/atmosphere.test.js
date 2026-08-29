import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { rainbowMoistureStep, rainbowPotential, rainbowResponse, surfaceMistEnvelope } from '../src/environment.js';
import { Sky } from '../src/sky.js';

test('surface mist follows calm dawn cooling and real fog without surviving hurricane wind', () => {
  const midday = surfaceMistEnvelope({ hour: 13, fog: 0.00028, rain: 0, wind: 3.5, storm: 0 });
  const dawn = surfaceMistEnvelope({ hour: 6.35, fog: 0.00028, rain: 0, wind: 3.5, storm: 0 });
  const windyDawn = surfaceMistEnvelope({ hour: 6.35, fog: 0.00028, rain: 0, wind: 19, storm: 0 });
  const denseFog = surfaceMistEnvelope({ hour: 3, fog: 0.0034, rain: 0, wind: 1.6, storm: 0.02 });
  const hurricane = surfaceMistEnvelope({ hour: 6.35, fog: 0.00134, rain: 1, wind: 36, storm: 1 });

  assert.ok(midday < 0.01);
  assert.ok(dawn > 0.5);
  assert.ok(windyDawn < 0.01);
  assert.ok(denseFog > 0.85);
  assert.ok(hurricane < 0.2);
});

test('a rainbow needs a clearing rain curtain and a low unobscured sun', () => {
  const clearing = rainbowPotential({ moisture: 0.8, rain: 0.28, storm: 0.42, daylight: 1, sunAltitude: 0.25, cloudLight: 0.99 });
  assert.ok(clearing > 0.9);
  assert.equal(rainbowPotential({ moisture: 0, rain: 0, storm: 0, daylight: 1, sunAltitude: 0.25, cloudLight: 1 }), 0);
  assert.equal(rainbowPotential({ moisture: 0.8, rain: 0.28, storm: 0.42, daylight: 0, sunAltitude: 0.25, cloudLight: 1 }), 0);
  assert.equal(rainbowPotential({ moisture: 0.8, rain: 0.28, storm: 0.42, daylight: 1, sunAltitude: 0.8, cloudLight: 1 }), 0);
  assert.ok(rainbowPotential({ moisture: 1, rain: 0.95, storm: 0.95, daylight: 1, sunAltitude: 0.25, cloudLight: 1 }) < 0.02);
  assert.equal(rainbowPotential({ moisture: 0.8, rain: 0.28, storm: 0.42, daylight: 1, sunAltitude: 0.25, cloudLight: 0.82 }), 0);
});

test('rain moisture clears slowly while the visible bow fades without popping', () => {
  const soaked = rainbowMoistureStep(0, 0.9, 4);
  assert.ok(soaked > 0.9);
  const trailingCurtain = rainbowMoistureStep(soaked, 0, 30);
  assert.ok(trailingCurtain > 0.5 && trailingCurtain < soaked);
  const appearing = rainbowResponse(0, 1, 1);
  const fading = rainbowResponse(1, 0, 1);
  assert.ok(appearing > 0.3 && appearing < 0.5);
  assert.ok(fading > 0.8 && fading < 0.9);
});

test('the rainbow reuses the existing textureless sky object', () => {
  const sky = new Sky(new THREE.Vector3(-0.42, 0.72, -0.55));
  sky.uniforms.rainbow.value = 0.75;
  assert.deepEqual(sky.resourceStats(), { objects: 1, geometries: 1, materials: 1, textures: 0, rainbow: 0.75 });
  sky.mesh.geometry.dispose(); sky.mesh.material.dispose();
});
