import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cloudShadowPotential, heatHazePotential, rainbowMoistureStep, rainbowPotential, rainbowResponse, surfaceMistEnvelope } from '../src/environment.js';
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

test('cloud shadows belong to sunlit broken cover rather than night or a solid hurricane deck', () => {
  const fair = cloudShadowPotential(0.49, 1, 0.72, 0);
  const overcast = cloudShadowPotential(0.40, 1, 0.72, 0.28);
  const squall = cloudShadowPotential(0.31, 1, 0.72, 0.68);

  assert.ok(fair > 0.45 && fair < 0.55);
  assert.ok(overcast > fair);
  assert.ok(squall > 0.3 && squall < fair);
  assert.equal(cloudShadowPotential(0.49, 0, 0.72, 0), 0);
  assert.equal(cloudShadowPotential(0.49, 1, -0.02, 0), 0);
  assert.equal(cloudShadowPotential(0.16, 1, 0.72, 1), 0);
});

test('heat haze belongs to clear calm afternoon low air rather than every bright frame', () => {
  const fair = heatHazePotential({ hour: 14, daylight: 1, sunAltitude: 0.94, cloud: 0.49, rain: 0, wind: 3.5, storm: 0, fog: 0.00028 });
  const morning = heatHazePotential({ hour: 8, daylight: 1, sunAltitude: 0.5, cloud: 0.49, rain: 0, wind: 3.5, storm: 0, fog: 0.00028 });
  const overcast = heatHazePotential({ hour: 14, daylight: 1, sunAltitude: 0.94, cloud: 0.4, rain: 0.04, wind: 6.5, storm: 0.28, fog: 0.00042 });

  assert.ok(fair > 0.95);
  assert.ok(morning < 0.02);
  assert.ok(overcast < 0.1);
  assert.equal(heatHazePotential(14, 1, 0.94, 0.49, 0.7, 3.5, 0, 0.00028), 0);
  assert.equal(heatHazePotential(14, 1, 0.94, 0.49, 0, 24, 0, 0.00028), 0);
  assert.equal(heatHazePotential(14, 1, 0.94, 0.52, 0, 1.6, 0.02, 0.0034), 0);
  assert.equal(heatHazePotential({ hour: 1, daylight: 0, sunAltitude: -0.5, cloud: 0.49, wind: 3.5 }), 0);
  assert.equal(heatHazePotential({ hour: 14, daylight: 1, sunAltitude: 0.94, cloud: 0.16, rain: 1, wind: 36, storm: 1, fog: 0.00134 }), 0);
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
