import assert from 'node:assert/strict';
import test from 'node:test';
import { person, setPersonClothImage } from '../src/folk.js';
import { mulberry32 } from '../src/noise.js';

test('dock figures share the detailed meshes and keep independent eyelid and grip poses', () => {
  const one = person(mulberry32(72), { work: true }), two = person(mulberry32(72), { work: true });
  const a = one.userData, b = two.userData;
  assert.equal(a.seed, 0.07883221260271966);
  assert.equal(a.eyelids.geometry, b.eyelids.geometry);
  assert.equal(a.arms[1].hand.geometry, b.arms[1].hand.geometry);
  assert.equal(a.legs[0].boot.geometry, b.legs[0].boot.geometry);
  assert.equal(a.arms[1].hand.parent, a.arms[1].fore);
  a.eyelids.morphTargetInfluences[a.eyelids.morphTargetDictionary.blink] = 0.85;
  a.arms[1].hand.morphTargetInfluences[a.arms[1].hand.morphTargetDictionary.grip] = 1;
  assert.equal(b.eyelids.morphTargetInfluences[0], 0);
  assert.equal(b.arms[1].hand.morphTargetInfluences[0], 0.45);
  for (const { geometry } of [a.eyelids, a.arms[1].hand]) {
    assert.equal(geometry.morphAttributes.position[0].count, geometry.getAttribute('position').count);
    assert.equal(geometry.morphAttributes.normal[0].count, geometry.getAttribute('normal').count);
    assert.ok(geometry.morphAttributes.position[0].array.every(Number.isFinite));
  }
  let draws = 0, triangles = 0;
  one.traverse(node => {
    if (!node.isMesh) return;
    draws++;
    triangles += node.geometry.index.count / 3;
  });
  assert.equal(draws, 19);
  assert.ok(triangles < 14_000);
});

test('workwear shares one image and existing shader uniforms can return to the procedural fallback', () => {
  const figure = person(mulberry32(72), { work: true });
  const shirt = figure.userData.spine.getObjectByName('work jacket').material;
  const cap = figure.userData.head.children[3].material;
  const compile = (material) => {
    const shader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: '#include <common>\n#include <color_fragment>',
    };
    material.onBeforeCompile(shader);
    return shader;
  };
  const shirtShader = compile(shirt), hatShader = compile(cap);
  assert.equal(shirtShader.uniforms.workwearTexture, hatShader.uniforms.workwearTexture);
  const image = { width: 512, height: 512 };
  try {
    setPersonClothImage(image);
    const texture = shirtShader.uniforms.workwearTexture.value;
    setPersonClothImage(image);
    assert.equal(texture.image, image);
    assert.equal(hatShader.uniforms.workwearTexture.value, texture);
    assert.equal(shirtShader.uniforms.workwearHasImage.value, 1);
    let released = false;
    texture.addEventListener('dispose', () => { released = true; });
    setPersonClothImage(null);
    assert.equal(released, true);
    assert.equal(hatShader.uniforms.workwearTexture.value, null);
    assert.equal(hatShader.uniforms.workwearHasImage.value, 0);
    assert.match(shirtShader.fragmentShader, /resolveThread/);
  } finally {
    setPersonClothImage(null);
  }
});
