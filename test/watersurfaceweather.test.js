import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WATER_RAIN_RINGS, WATER_SURFACE_RESPONSE, Water, waterSurfaceResponse } from '../src/water.js';

const makeWater = () => new Water({ getDrawingBufferSize: out => out.set(320, 180) }, new THREE.Vector3(0, 1, 0));
const dispose = water => {
  water.reflRT.dispose(); water.wakeA.dispose(); water.wakeB.dispose(); water.murkTex.dispose();
  water.mesh.geometry.dispose(); water.material.dispose(); water.simQuad.geometry.dispose(); water.simMat.dispose();
};

test('dead calm reads glassy, light rain stays sparse, and storms roughen the surface', () => {
  const calm = waterSurfaceResponse({ wind: 1.4, seaState: 0.025, rain: 0 });
  const lightRain = waterSurfaceResponse({ wind: 6.8, seaState: 0.24, rain: 0.34 });
  const storm = waterSurfaceResponse({ wind: 18, seaState: 1.05, rain: 1 });
  assert.ok(calm.calm > 0.85 && calm.roughness === 0 && calm.rings === 0);
  assert.ok(lightRain.rings === 1, 'a light shower draws fully readable rings');
  assert.ok(lightRain.density < 0.05, 'a light shower keeps rings sparse');
  assert.ok(lightRain.roughness < 0.1);
  assert.ok(storm.calm === 0 && storm.roughness > 0.7 && storm.density === 1);
});

test('surface response is monotonic, bounded and tolerates bad input', () => {
  let previous = waterSurfaceResponse({ wind: 0 });
  for (let wind = 0.5; wind <= 40; wind += 0.5) {
    const next = waterSurfaceResponse({ wind });
    assert.ok(next.calm <= previous.calm + 1e-12 && next.roughness >= previous.roughness - 1e-12);
    previous = next;
  }
  for (const input of [{ wind: NaN, seaState: -3, rain: Infinity }, {}, undefined]) {
    const r = waterSurfaceResponse(input);
    for (const v of Object.values(r)) assert.ok(Number.isFinite(v) && v >= 0 && v <= 1);
  }
  const out = {};
  assert.equal(waterSurfaceResponse({ wind: 3 }, out), out);
});

test('drizzle rings stay inside their cell so no ring is clipped at a seam', () => {
  const R = WATER_RAIN_RINGS;
  assert.ok(R.centreJitter / 2 + Math.max(R.drizzleRadius, R.denseRadius) + R.maxWidth < 0.5);
  // the lattice and rate are literals, so a rain ramp changes coverage and shape but never re-rolls the pattern
  const water = makeWater(), shader = water.material.fragmentShader;
  assert.match(shader, new RegExp(`precipitationRing\\(w, t, ${R.cell}, ${R.rate}, 7\\.3,`));
  assert.match(shader, /mod\(floor\(cycle\), 251\.0\)/);
  dispose(water);
});

test('setConditions drives the shader response uniforms without new textures', () => {
  const water = makeWater();
  assert.equal(water.uniforms.surfaceCalm.value, 1);
  water.setConditions({ seaState: 1.05, rain: 1, wind: 18 });
  assert.ok(water.uniforms.surfaceCalm.value === 0 && water.uniforms.surfaceRoughness.value > 0.7);
  water.setConditions({ seaState: 0.025, rain: 0, wind: 1.4 });
  assert.ok(water.uniforms.surfaceCalm.value > 0.85 && water.uniforms.surfaceRoughness.value === 0);
  const shader = water.material.fragmentShader;
  assert.match(shader, /uniform float surfaceCalm, surfaceRoughness;/);
  assert.match(shader, new RegExp(`smoothstep\\(${WATER_SURFACE_RESPONSE.ringRain[0]}, ${WATER_SURFACE_RESPONSE.ringRain[1]}, rainAmount\\)`));
  assert.match(shader, new RegExp(`smoothstep\\(${WATER_SURFACE_RESPONSE.denseRain[0]}, ${WATER_SURFACE_RESPONSE.denseRain[1]}, rainAmount\\)`));
  assert.equal((shader.match(/texture2D\(tNormal/g) || []).length, 4, 'detail normals keep their four existing taps');
  assert.equal((shader.match(/texture2D\(tRefl/g) || []).length, 1);
  // vertex displacement, and so buoyancy alignment, does not read the new uniforms
  assert.doesNotMatch(water.material.vertexShader, /surfaceCalm|surfaceRoughness/);
  dispose(water);
});
