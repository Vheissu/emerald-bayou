import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Sky } from '../src/sky.js';

test('cumulus banks stand on the horizon with seamless, light-shaded silhouettes in the single sky draw', () => {
  const sky = new Sky(new THREE.Vector3(-0.42, 0.72, -0.55), { skyWeatherDetail: 0 });
  const fs = sky.mesh.material.fragmentShader;
  assert.match(fs, /vec4 cumulusBank\(/);
  // azimuth lattice wraps, so towers never tear at the atan seam
  assert.match(fs, /mod\(i\.x, period\)/);
  // lobes are lit by the active sun or moon, not a fixed sun vector
  assert.match(fs, /lightLocal = vec3\(dot\(lightDir/);
  // tier 0 drops only the distant bank; nothing is dithered per pixel, so reflections stay coherent
  assert.match(fs, /layer == 0 && weatherDetail < 0\.01/);
  assert.doesNotMatch(fs, /gl_FragCoord/);
  assert.deepEqual(sky.resourceStats(), { objects: 1, geometries: 1, materials: 1, textures: 0, rain: 0, rainbow: 0, weatherDetail: 0 });
  sky.mesh.geometry.dispose(); sky.mesh.material.dispose();
});

test('a decoded cloud bank is shared by the sky passes and released when returning to procedural clouds', () => {
  const sky = new Sky(new THREE.Vector3(0, 1, 0));
  const image = { width: 640, height: 320 };
  sky.setCloudBank(image);
  const texture = sky.mesh.material.uniforms.tCloudBank.value;
  assert.equal(texture.image, image);
  assert.equal(sky.resourceStats().textures, 1);
  let disposed = false;
  texture.addEventListener('dispose', () => { disposed = true; });
  sky.setCloudBank(null);
  assert.equal(disposed, true);
  assert.equal(sky.mesh.material.uniforms.tCloudBank.value, null);
  assert.equal(sky.resourceStats().textures, 0);
  sky.mesh.geometry.dispose(); sky.mesh.material.dispose();
});

test('sky curtain follows the same advecting centre as the rain falling in the world', async () => {
  const { createWeatherBand } = await import('../src/weatherfronts.js');
  const sky = new Sky(new THREE.Vector3(0, 1, 0));
  const band = createWeatherBand('lightRain', 120, -38, Math.PI / 2);
  band.age = 9;
  sky.setRainField(band, 1, 0.33);
  assert.ok(Math.abs(sky.uniforms.bandCenter.value.x - 120) < 1e-8);
  assert.equal(sky.uniforms.bandCenter.value.y, -38 + 9 * band.shape.speed);
  assert.equal(sky.uniforms.bandRain.value, 0.33);
  sky.setRainField(null, 1, 0);
  assert.equal(sky.uniforms.bandRain.value, 0);
  sky.mesh.geometry.dispose(); sky.mesh.material.dispose();
});
