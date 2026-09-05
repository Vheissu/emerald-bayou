import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createParticleLighting, updateParticleLighting } from '../src/particlelighting.js';
import { Spray, Plume } from '../src/particles.js';

const fixture = () => ({
  lightDir: new THREE.Vector3(0.3, 0.8, 0.5).normalize(),
  sun: new THREE.DirectionalLight(0xfff1d6, 3),
  hemi: new THREE.HemisphereLight(0x9fc3e8, 0x3f4a2a, 0.46),
  spotlight: new THREE.SpotLight(0xfff3dc, 0, 110, 0.31, 0.58, 2),
  values: { fog: 0.001 },
});
const brightness = color => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;

test('particles follow scene daylight, moonlight, cloud shade and lightning without a permanent light floor', () => {
  const env = fixture(), camera = new THREE.PerspectiveCamera(), u = createParticleLighting();
  updateParticleLighting(u, env, camera);
  const day = brightness(u.sunCol.value) + brightness(u.skyCol.value);
  env.sun.intensity = 0.7; env.hemi.intensity = 0.22;
  updateParticleLighting(u, env, camera);
  const storm = brightness(u.sunCol.value) + brightness(u.skyCol.value);
  assert.ok(storm < day * 0.4);

  env.sun.color.set(0x91a8d5); env.sun.intensity = 0.1;
  env.hemi.color.set(0x203659); env.hemi.intensity = 0.09;
  updateParticleLighting(u, env, camera);
  const moon = brightness(u.sunCol.value) + brightness(u.skyCol.value);
  assert.ok(moon > 0 && moon < day * 0.025);
  assert.ok(u.sunCol.value.b > u.sunCol.value.r);
  env.sun.intensity = 4.5; env.sun.color.set(0xeaf5ff);
  updateParticleLighting(u, env, camera);
  assert.ok(brightness(u.sunCol.value) > day);
  env.sun.visible = false; env.hemi.visible = false;
  updateParticleLighting(u, env, camera);
  assert.equal(brightness(u.sunCol.value) + brightness(u.skyCol.value), 0);
});

test('the particle cone follows the actual spotlight through hull pitch, roll and steering', () => {
  const env = fixture(), u = createParticleLighting(), camera = new THREE.PerspectiveCamera();
  const hull = new THREE.Group(); hull.position.set(40, 0.8, -12); hull.rotation.set(0.2, 1.1, -0.15, 'YXZ');
  env.spotlight.position.set(0, 1.15, -1.45); env.spotlight.target.position.set(0, 0.1, -55);
  hull.add(env.spotlight, env.spotlight.target); env.spotlight.intensity = 1250;
  updateParticleLighting(u, env, camera);
  const origin = new THREE.Vector3(0, 1.15, -1.45).applyMatrix4(hull.matrixWorld);
  const target = new THREE.Vector3(0, 0.1, -55).applyMatrix4(hull.matrixWorld);
  assert.ok(origin.distanceTo(u.particleSpotPosition.value) < 1e-10);
  assert.ok(target.sub(origin).normalize().distanceTo(u.particleSpotDirection.value) < 1e-10);
  assert.equal(u.particleSpotShape.value.z, 110);
  assert.ok(u.particleSpotShape.value.y > u.particleSpotShape.value.x);
  assert.ok(u.particleSpotShape.value.w > 0);
  const clearExtinction = u.particleExtinction.value;
  env.values.fog = 0.024; updateParticleLighting(u, env, camera);
  assert.ok(u.particleExtinction.value > clearExtinction);
  env.spotlight.intensity = 0; updateParticleLighting(u, env, camera);
  assert.equal(u.particleSpotShape.value.w, 0);
});

test('day, night and spotlight changes share uniform records without rebuilding resources or suppressing blue fire', () => {
  const gradient = () => ({ addColorStop() {} });
  const context = { createRadialGradient: gradient, beginPath() {}, arc() {}, fill() {}, fillRect() {} };
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
  const u = createParticleLighting(), env = fixture(), camera = new THREE.PerspectiveCamera();
  const spray = new Spray(3, u), plume = new Plume(3, u);
  const sprayVersion = spray.mat.version, plumeVersion = plume.mat.version;
  const positions = [spray.pos, plume.pos], fields = Object.values(u).map(uniform => uniform.value);
  spray.mat.uniforms.bioluminescence.value = 1; plume.mat.uniforms.bioluminescence.value = 1;
  for (let i = 0; i < 120; i++) {
    env.sun.intensity = i % 2 ? 0.1 : 3; env.spotlight.intensity = i % 2 ? 1250 : 0;
    assert.equal(updateParticleLighting(u, env, camera), u);
  }
  for (const [name, uniform] of Object.entries(u)) {
    assert.equal(spray.mat.uniforms[name], uniform); assert.equal(plume.mat.uniforms[name], uniform);
  }
  Object.values(u).forEach((uniform, i) => { if (typeof fields[i] === 'object') assert.equal(uniform.value, fields[i]); });
  assert.equal(spray.pos, positions[0]); assert.equal(plume.pos, positions[1]);
  assert.equal(spray.mat.version, sprayVersion); assert.equal(plume.mat.version, plumeVersion);
  assert.equal(spray.mat.uniforms.bioluminescence.value, 1); assert.equal(plume.mat.uniforms.bioluminescence.value, 1);
  spray.geo.dispose(); spray.mat.dispose(); plume.geo.dispose(); plume.mat.dispose();
});
