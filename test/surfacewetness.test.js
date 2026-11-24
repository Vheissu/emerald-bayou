import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Environment } from '../src/environment.js';
import { Terrain } from '../src/terrain.js';
import {
  normalizeSurfaceWetness, registerWetMaterial, setGlobalSurfaceWetness, surfaceWetMaterialStats,
  surfaceWetnessStep, surfaceWetnessTarget, terrainWetFilm, tidalBankStep, unregisterWetMaterial,
} from '../src/surfacewetness.js';

test('rain, hail and night fog leave different amounts of surface moisture', () => {
  assert.equal(surfaceWetnessTarget(0, 0, 0.00028, 1), 0);
  assert.equal(surfaceWetnessTarget(1, 0, 0, 1), 1);
  assert.equal(surfaceWetnessTarget(0, 1, 0, 1), 0.56);
  assert.ok(surfaceWetnessTarget(0, 0, 0.0034, 0) > 0.41);
  assert.equal(normalizeSurfaceWetness(4), 1);
  assert.equal(normalizeSurfaceWetness(-2), 0);
  assert.equal(normalizeSurfaceWetness('invalid', 0.37), 0.37);
});

test('surfaces wet quickly, dry slowly and ignore a paused frame', () => {
  const rainSoaked = surfaceWetnessStep(0.1, 1, 0, 0.001, 0.2, 18, 1, 1);
  assert.ok(rainSoaked > 0.95);
  assert.equal(surfaceWetnessStep(rainSoaked, 0, 0, 0, 1, 24, 0, 0), rainSoaked);

  let sunny = 1, calmNight = 1;
  for (let second = 0; second < 120; second++) {
    sunny = surfaceWetnessStep(sunny, 0, 0, 0.00028, 1, 24, 0, 1);
    calmNight = surfaceWetnessStep(calmNight, 0, 0, 0.00028, 0, 0, 0, 1);
  }
  assert.ok(sunny < 0.25);
  assert.ok(calmNight > 0.85);
});

test('the terrain wet film favours level surfaces and the tidal edge', () => {
  assert.equal(terrainWetFilm(1, 0.1, 0.3, 0), 0);
  assert.ok(terrainWetFilm(0, 1, 0.1, 0) > 0.3);
  assert.equal(terrainWetFilm(0, 1, 2, 0), 0);
  assert.ok(terrainWetFilm(0.8, 1, 2, 0) > 0.79);
});

test('a falling tide exposes damp sediment which dries from the upper edge down', () => {
  assert.equal(tidalBankStep(undefined, -0.23, 0), -0.23);
  assert.equal(tidalBankStep(-0.23, 0.45, 1), 0.45);
  assert.equal(tidalBankStep(0.45, -0.23, 0), 0.45);
  const breeze = tidalBankStep(0.45, -0.23, 55, 1);
  const shade = tidalBankStep(0.45, -0.23, 55, 0);
  assert.ok(breeze < shade && shade < 0.45 && breeze > -0.23);
  const bank = 0.23, ebb = -0.23;
  assert.ok(terrainWetFilm(0, 0.98, bank, ebb, shade) > 0.35);
  assert.equal(terrainWetFilm(0, 0.98, bank, ebb), 0);
  assert.equal(terrainWetFilm(0, 0.98, 1.75, ebb, shade), 0);
  assert.ok(terrainWetFilm(0, 1, 0.32, ebb, shade, 0.2) > terrainWetFilm(0, 1, 0.32, ebb, shade, 0.8));
});

test('shared outdoor materials stay reusable and do not trigger shader recompiles', () => {
  setGlobalSurfaceWetness(0);
  const before = surfaceWetMaterialStats();
  const material = new THREE.MeshStandardMaterial({ color: 0x806040, roughness: 0.9, metalness: 0.7 });
  const dry = material.color.clone(), version = material.version;

  assert.equal(registerWetMaterial(material), material);
  assert.equal(registerWetMaterial(material), material);
  assert.equal(surfaceWetMaterialStats().registered, before.registered + 1);
  setGlobalSurfaceWetness(1);

  assert.equal(material.version, version);
  assert.ok(material.color.r < dry.r && material.color.g < dry.g && material.color.b < dry.b);
  assert.ok(Math.abs(material.roughness - 0.16) < 1e-12);
  assert.deepEqual(
    { textures: surfaceWetMaterialStats().textures, programs: surfaceWetMaterialStats().programs },
    { textures: 0, programs: 0 },
  );

  assert.equal(unregisterWetMaterial(material), true);
  assert.equal(material.color.getHex(), dry.getHex());
  assert.equal(material.roughness, 0.9);
  assert.equal(surfaceWetMaterialStats().registered, before.registered);
  material.dispose();
});

test('terrain moisture retains the recent tide in the existing material program', () => {
  const terrain = Object.assign(Object.create(Terrain.prototype), {
    group: new THREE.Group(), surfaceWetness: 0.64, surfaceWaterLevel: 0.31, uniforms: null,
  });
  const textures = { grass: new THREE.Texture(), mud: new THREE.Texture(), sand: new THREE.Texture(), noise: new THREE.Texture() };
  terrain.buildMesh(textures);
  const shader = {
    uniforms: {},
    vertexShader: '#include <common>\nvoid main() {\n#include <worldpos_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main() {\n#include <map_fragment>\n#include <roughnessmap_fragment>\n}',
  };
  terrain.material.onBeforeCompile(shader);

  assert.equal(shader.uniforms.uSurfaceWetness.value, 0.64);
  assert.equal(shader.uniforms.uWaterLevel.value, 0.31);
  assert.match(shader.vertexShader, /vWorldUp/);
  assert.equal(shader.uniforms.uRecentWaterLevel.value, 0.31);
  assert.match(shader.fragmentShader, /recentReach/);
  assert.match(shader.fragmentShader, /roughnessFactor = mix/);
  assert.equal(terrain.material.customProgramCacheKey(), 'terrain-tidal-bank');

  const uniforms = terrain.uniforms;
  terrain.setSurfaceWetness(0.8, 0.4);
  assert.equal(terrain.uniforms, uniforms);
  assert.equal(uniforms.uSurfaceWetness.value, 0.8);
  assert.equal(uniforms.uWaterLevel.value, 0.4);
  assert.equal(uniforms.uRecentWaterLevel.value, 0.4);
  terrain.setSurfaceWetness(0, -0.12, 0);
  assert.equal(uniforms.uWaterLevel.value, -0.12);
  assert.equal(uniforms.uRecentWaterLevel.value, 0.4);

  terrain.material.dispose();
  Object.values(textures).forEach(texture => texture.dispose());
});

test('surface moisture survives a save without retaining frame data', () => {
  const environment = Object.create(Environment.prototype), game = { save: {}, persist() {} };
  Object.assign(environment, {
    game, minutes: 812, key: 'fair', from: {}, mix: 1, remaining: 71, weatherDuration: 196,
    windAngle: -1.2, surfaceWetness: 0.71337, settlementOutages: new Map(), settlementPowerFailures: 0,
  });
  environment.persistState(false);
  assert.equal(game.save.environment.surfaceWetness, 0.7134);
  assert.equal(Object.hasOwn(game.save.environment, 'surfaceWetness'), true);
});
