import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BoatCondition } from '../src/condition.js';
import {
  HullDamageMaterial, MAX_HULL_SCARS, hullScarFromImpact, hullScarTarget, normalizeHullScars, repairHullScars,
} from '../src/hulldamage.js';

test('saved hull scars are normalized and bounded to the newest six records', () => {
  const raw = Array.from({ length: 9 }, (_, index) => [index - 4, 99, -9, index ? 4 : 0, index ? 3 : 0, 4, 9, 8]);
  const scars = normalizeHullScars(raw);
  assert.equal(scars.length, MAX_HULL_SCARS);
  assert.ok(scars.every(scar => scar.length === 8 && scar.every(Number.isFinite)));
  assert.ok(scars.every(scar => scar[0] >= -1.34 && scar[0] <= 1.34 && scar[1] <= 0.58 && scar[5] <= 0.52 && scar[7] <= 1));
  assert.ok(scars.every(scar => Math.abs(Math.hypot(scar[3], scar[4]) - 1) < 0.0001));
});

test('collision bearings put scars on the struck side of the asymmetric hull', () => {
  const starboard = hullScarFromImpact({ normalX: -1, normalZ: 0, forwardX: 0, forwardZ: -1, rightX: 1, rightZ: 0, severity: 4, serial: 1 });
  const bow = hullScarFromImpact({ normalX: 0, normalZ: 1, forwardX: 0, forwardZ: -1, rightX: 1, rightZ: 0, severity: 4, serial: 2 });
  const stern = hullScarFromImpact({ normalX: 0, normalZ: -1, forwardX: 0, forwardZ: -1, rightX: 1, rightZ: 0, severity: 4, serial: 3 });
  assert.ok(starboard[0] > 1.2 && Math.abs(starboard[2]) < 0.01);
  assert.ok(bow[2] < -2.7);
  assert.ok(stern[2] > 2.37);
});

test('repair work clears or reduces visible scar history with hull health', () => {
  const scars = normalizeHullScars(Array.from({ length: MAX_HULL_SCARS }, (_, index) => [1.2, 0.3, index * 0.2 - 0.5, 1, 0, 0.2, 0, 0.7]));
  assert.equal(hullScarTarget(100), 0);
  assert.equal(hullScarTarget(70), 2);
  assert.equal(hullScarTarget(15), MAX_HULL_SCARS);
  assert.equal(repairHullScars(scars, 70).length, 2);
  assert.equal(repairHullScars(scars, 100).length, 0);
});

test('the hull material carries six scars without decals, textures or draw calls', () => {
  const material = new THREE.MeshStandardMaterial({ color: 0xd8dcda, roughness: 1, metalness: 0.72 });
  const damage = new HullDamageMaterial(material, { hullDamageDetail: 0.78 });
  const scars = [
    [1.22, 0.3, -1.2, 1, 0, 0.24, 0.2, 0.8],
    [-1.22, 0.4, 0.7, -1, 0, 0.28, -0.4, 0.6],
  ];
  assert.equal(damage.setScars(scars), 2);
  assert.deepEqual(damage.resourceStats(), {
    scars: 2, capacity: 6, detail: 0.78, uniformBytes: 200, customPrograms: 1,
    extraObjects: 0, extraGeometries: 0, extraMaterials: 1, extraTextures: 0, extraDrawCalls: 0, extraRenderTargets: 0,
  });

  const version = material.version;
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  assert.equal(shader.uniforms.uHullScarCenters, damage.uniforms.centers);
  assert.match(shader.vertexShader, /vHullDamagePosition = transformed/);
  assert.match(shader.fragmentShader, /uHullScarCenters\[6\]/);
  assert.match(shader.fragmentShader, /hullScarMetal/);
  assert.equal(damage.setQuality({ hullDamageDetail: 0 }), 0);
  damage.setScars([]);
  assert.equal(material.version, version);
  material.dispose();
});

test('boat condition keeps exact and fallback scars in one bounded retained ledger', () => {
  const condition = Object.create(BoatCondition.prototype), applied = [];
  condition.state = { hull: 40, scars: [], scarSerial: 0 };
  condition.hullDamage = { setScars: scars => applied.push(scars.length) };
  condition.hullScarRevision = 0; condition.hullScarAppliedRevision = -1;
  condition._forward = new THREE.Vector2(); condition._right = new THREE.Vector2();
  condition.phys = {
    hitNormal: new THREE.Vector2(-1, 0),
    forward: out => out.set(0, -1), right: out => out.set(1, 0),
  };
  assert.equal(condition.ensureHullScars(), 4);
  for (let i = 0; i < 8; i++) condition.recordHullScar(2 + i * 0.1);
  assert.equal(condition.state.scars.length, MAX_HULL_SCARS);
  assert.ok(condition.state.scars.at(-1)[0] > 1.2);
  condition.state.hull = 100;
  assert.equal(condition.repairHullVisuals(40), true);
  assert.equal(condition.state.scars.length, 0);
  assert.equal(applied.at(-1), 0);
});
