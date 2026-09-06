import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FOAM_NOISE_SHAPE, WATER_SHADOW_DISK, Water } from '../src/water.js';

test('precomputed shadow offsets retain the original six-tap disk at every pixel rotation', () => {
  assert.equal(WATER_SHADOW_DISK.length, 6);
  for (let p = 0; p < 100; p++) {
    const phase = p * 6.2831853 / 100, c = Math.cos(phase), s = Math.sin(phase);
    WATER_SHADOW_DISK.forEach(([x, y], i) => {
      const radius = Math.sqrt((i + 0.5) / 6), angle = phase + i * 2.399963;
      assert.ok(Math.abs(c * x - s * y - Math.cos(angle) * radius) < 1e-12);
      assert.ok(Math.abs(s * x + c * y - Math.sin(angle) * radius) < 1e-12);
    });
  }
});

test('the foam skip threshold cannot suppress a nonzero shaped wake from a normalized texture', () => {
  const shape = FOAM_NOISE_SHAPE;
  assert.ok(shape.maximum > shape.base + shape.coarse + shape.fine);
  for (let raw = 0; raw <= shape.edge / shape.maximum; raw += 0.0002) {
    for (const coarse of [0, 0.25, 0.75, 1]) for (const fine of [0, 0.25, 0.75, 1]) {
      const value = raw * (shape.base + shape.coarse * coarse + shape.fine * fine);
      assert.ok(value < shape.edge);
    }
  }
});

test('water skips only inactive detail and keeps gradients, storm caps, blue fire and all shadow samples', () => {
  const water = new Water({ getDrawingBufferSize: out => out.set(320, 180) }, new THREE.Vector3(0, 1, 0));
  const shader = water.material.fragmentShader;
  assert.match(shader, /if \(duck > 0\.2\)/);
  assert.match(shader, /if \(dw > 0\.0\)/);
  assert.match(shader, /fmRaw \* 2\.051 > 0\.08 \|\| th < 0\.55 \|\| seaState > 0\.45 \|\| bioluminescence > 0\.0/);
  assert.match(shader, /textureGrad\(tFoam/);
  assert.match(shader, /for \(int i = 0; i < 6; i\+\+\)/);
  assert.match(shader, /s \+= texture\(tShadow/);
  assert.match(shader, /precipitationCrown \* impactFade/);
  assert.match(shader, /col \+= bioColor \* bio/);
  assert.deepEqual(Object.keys(water.uniforms).filter(key => key.startsWith('t')).sort(), ['tRefr', 'tDepth', 'tRefl', 'tNormal', 'tFoam', 'tWake', 'tShadow', 'tMurk'].sort());
  water.reflRT.dispose(); water.wakeA.dispose(); water.wakeB.dispose(); water.murkTex.dispose();
  water.mesh.geometry.dispose(); water.material.dispose(); water.simQuad.geometry.dispose(); water.simMat.dispose();
});
