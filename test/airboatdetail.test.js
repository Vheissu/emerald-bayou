import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { airboatGrilleTexture, bakeParts, ditheredCoverageMips, grillePixels, propBladeGeometry, wearPixels } from '../src/airboatdetail.js';

const meanAlpha = ({ data }) => { let sum = 0; for (let i = 3; i < data.length; i += 4) sum += data[i] / 255; return sum / (data.length / 4); };

test('the fine fan guard keeps its wire coverage down the whole mip chain', () => {
  const pixels = grillePixels(64, 4, 1.5), mips = ditheredCoverageMips(pixels);
  assert.equal(mips.length, 7); assert.equal(mips.at(-1).width, 1);
  const base = meanAlpha(mips[0]);
  assert.ok(base > 0.2 && base < 0.45, `base coverage ${base}`);
  // Screen-door levels stay near the true wire coverage instead of fading to nothing or filling solid.
  for (const level of mips.slice(1, 5)) assert.ok(Math.abs(meanAlpha(level) - base) < 0.12, `level ${level.width}`);
  // Below a full dither cell the wire drops out entirely rather than turning a distant dome opaque.
  for (const level of mips.slice(5)) assert.equal(meanAlpha(level), 0);
  for (const level of mips.slice(1)) for (let i = 3; i < level.data.length; i += 4) assert.ok(level.data[i] === 0 || level.data[i] === 255);

  const texture = airboatGrilleTexture();
  assert.equal(texture.generateMipmaps, false); assert.equal(texture.mipmaps.length, 7);
  assert.equal(texture.wrapS, THREE.RepeatWrapping); assert.equal(texture.minFilter, THREE.LinearMipmapLinearFilter);
  texture.dispose();
});

test('shared weathering is deterministic and stays a mild multiplier', () => {
  const a = wearPixels(64, 9), b = wearPixels(64, 9);
  assert.deepEqual(a.map, b.map);
  let min = 255, max = 0, roughMin = 255;
  for (let i = 0; i < 64 * 64; i++) { min = Math.min(min, a.map[i * 4 + 1]); max = Math.max(max, a.map[i * 4 + 1]); roughMin = Math.min(roughMin, a.rough[i * 4 + 1]); }
  assert.ok(min > 90 && max <= 255 && max - min > 40);
  assert.ok(roughMin >= 51);
});

test('the prop is one two-blade mesh balanced about the shaft', () => {
  const geometry = propBladeGeometry({ root: 0.13, tip: 1.18 });
  geometry.computeBoundingBox();
  const box = geometry.boundingBox, color = geometry.getAttribute('color');
  assert.ok(color && color.count === geometry.getAttribute('position').count);
  assert.ok(Math.abs(box.max.y - 1.18) < 1e-6 && Math.abs(box.min.y + 1.18) < 1e-6);
  assert.ok(box.max.z < 0.12 && box.min.z > -0.12);
  geometry.dispose();
});

test('baked parts collapse into one geometry in the container frame', () => {
  const container = new THREE.Group(); container.position.set(5, 5, 5);
  const box = new THREE.BoxGeometry(1, 1, 1), ring = new THREE.TorusGeometry(1, 0.05, 6, 12);
  const a = new THREE.Mesh(box); a.position.set(2, 0, 0); container.add(a);
  const b = new THREE.Mesh(ring); b.rotation.x = Math.PI / 2; container.add(b);
  const merged = bakeParts(container);
  merged.computeBoundingBox();
  assert.equal(merged.getAttribute('position').count, box.getAttribute('position').count + ring.getAttribute('position').count);
  assert.ok(Math.abs(merged.boundingBox.max.x - 2.5) < 1e-6);
  assert.ok(merged.index);
  merged.dispose(); box.dispose(); ring.dispose();
});
