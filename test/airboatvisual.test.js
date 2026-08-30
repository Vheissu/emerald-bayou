import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  airboatSprayExposure,
  airboatWetnessStep,
  prepareAirboatWetSurfaces,
  registerAirboatEnvironmentWetness,
  setAirboatWetness,
  updateAirboatWetness,
} from '../src/airboat.js';
import { setGlobalSurfaceWetness, surfaceWetMaterialStats, unregisterWetMaterial } from '../src/surfacewetness.js';

test('rain, spray and splash wet the hull while fair sun and wind dry it', () => {
  let wetness = 0.05;
  for (let i = 0; i < 180; i++) wetness = airboatWetnessStep(wetness, { rain: 1, dt: 1 / 60 });
  assert.ok(wetness > 0.94);

  const rainSoaked = wetness;
  for (let i = 0; i < 600; i++) wetness = airboatWetnessStep(wetness, { daylight: 1, wind: 18, dt: 0.25 });
  assert.ok(wetness < rainSoaked - 0.8);
  assert.ok(wetness >= 0 && wetness <= 1);

  const splashed = airboatWetnessStep(0.1, { splash: 1, dt: 1 / 60 });
  assert.ok(splashed > 0.74);
});

test('chine spray requires a wet moving hull and grows with prop wash', () => {
  assert.equal(airboatSprayExposure({ speed: 14, wet: 0, rpm: 1 }), 0);
  assert.equal(airboatSprayExposure({ speed: 0, wet: 1, rpm: 1 }), 0);
  const cruise = airboatSprayExposure({ speed: 9, wet: 1, rpm: 0.6 });
  const flatOut = airboatSprayExposure({ speed: 14, wet: 1, rpm: 1 });
  assert.ok(cruise > 0 && cruise < flatOut);
  assert.equal(flatOut, 1);
});

test('the player wet pass clones each unique material once and keeps textures shared', () => {
  const texture = new THREE.Texture();
  const shared = new THREE.MeshStandardMaterial({ color: 0xb9bdbc, roughness: 0.8, metalness: 0.2, map: texture });
  const basic = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const group = new THREE.Group();
  const first = new THREE.Mesh(new THREE.BoxGeometry(), shared), second = new THREE.Mesh(new THREE.BoxGeometry(), shared);
  const excluded = new THREE.Mesh(new THREE.BoxGeometry(), basic); group.add(first, second, excluded);

  const surfaces = prepareAirboatWetSurfaces(group);
  assert.equal(surfaces.length, 1);
  assert.notEqual(first.material, shared);
  assert.equal(first.material, second.material);
  assert.equal(first.material.map, texture);
  assert.equal(excluded.material, basic);

  const boat = { wetSurfaceMaterials: surfaces, surfaceWetness: 0 };
  const material = first.material, version = material.version, dryColor = material.color.r;
  setAirboatWetness(boat, 1);
  assert.ok(material.roughness < shared.roughness);
  assert.ok(material.envMapIntensity > shared.envMapIntensity);
  assert.ok(material.color.r < dryColor);
  assert.equal(material.version, version);
  assert.equal(updateAirboatWetness(boat, { rain: 0, wind: 18, daylight: 1, dt: 0.25 }), boat.surfaceWetness);
  assert.equal(first.material, material);

  first.geometry.dispose(); second.geometry.dispose(); excluded.geometry.dispose();
  material.dispose(); shared.dispose(); basic.dispose(); texture.dispose();
});

test('the marked player hull gets one independent wet material without splitting traffic materials', () => {
  const shared = new THREE.MeshStandardMaterial({ color: 0xd8dcda, roughness: 1, metalness: 0.72 });
  const group = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(), shared), chine = new THREE.Mesh(new THREE.BoxGeometry(), shared);
  hull.userData.hullDamageSurface = true; group.add(hull, chine);
  const surfaces = prepareAirboatWetSurfaces(group);
  assert.equal(surfaces.length, 2);
  assert.notEqual(hull.material, chine.material);
  assert.equal(surfaces.filter(surface => surface.damageSurface).length, 1);
  assert.equal(hull.material.map, chine.material.map);
  hull.geometry.dispose(); chine.geometry.dispose(); hull.material.dispose(); chine.material.dispose(); shared.dispose();
});

test('persistent traffic airboats share one storm-wet material without clones or shader recompiles', () => {
  setGlobalSurfaceWetness(0);
  const material = new THREE.MeshStandardMaterial({ color: 0xd8dcda, roughness: 0.9, metalness: 0.72 });
  const group = new THREE.Group(), first = new THREE.Mesh(new THREE.BoxGeometry(), material), second = new THREE.Mesh(new THREE.BoxGeometry(), material);
  group.add(first, second); group.userData.airboatDynamicWetness = false;
  const before = surfaceWetMaterialStats(), version = material.version, dryColor = material.color.r;

  assert.equal(registerAirboatEnvironmentWetness(group), 1);
  assert.equal(registerAirboatEnvironmentWetness(group), 1);
  assert.equal(first.material, second.material);
  assert.equal(surfaceWetMaterialStats().registered, before.registered + 1);
  setGlobalSurfaceWetness(1);
  assert.ok(material.roughness < 0.3);
  assert.ok(material.color.r < dryColor);
  assert.equal(material.version, version);
  assert.deepEqual({ textures: surfaceWetMaterialStats().textures, programs: surfaceWetMaterialStats().programs }, { textures: 0, programs: 0 });

  const playerMaterial = new THREE.MeshStandardMaterial({ color: 0xd8dcda, roughness: 0.9 });
  const player = new THREE.Group(); player.userData.airboatDynamicWetness = true; player.add(new THREE.Mesh(new THREE.BoxGeometry(), playerMaterial));
  assert.equal(registerAirboatEnvironmentWetness(player), 0);
  assert.equal(surfaceWetMaterialStats().registered, before.registered + 1);

  unregisterWetMaterial(material); setGlobalSurfaceWetness(0);
  first.geometry.dispose(); second.geometry.dispose(); player.children[0].geometry.dispose(); material.dispose(); playerMaterial.dispose();
});
