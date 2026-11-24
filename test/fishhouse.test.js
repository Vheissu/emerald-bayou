import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FISH_IDS } from '../src/fishmarket.js';

function gltf(path) {
  const bytes = readFileSync(new URL(path, import.meta.url));
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)));
}

test('the Blender sign export has a writable ticket for every traded species and both shop names', () => {
  const art = gltf('../assets/environment/fish-house-signs.glb');
  for (const name of ['fascia_tower', 'fascia_bend', ...FISH_IDS.map(id => 'ticket_' + id)]) {
    const node = art.nodes.find(node => node.name === name);
    assert.ok(node, name);
    const [face] = art.meshes[node.mesh].primitives;
    assert.ok(Number.isInteger(face.attributes.TEXCOORD_0), name);
  }
  assert.ok(art.images.every(image => Number.isInteger(image.bufferView)), 'all sign textures travel with the GLB');
});

test('the buyer export retains its working arm, finger and face rig', () => {
  const art = gltf('../assets/people/fish-buyer.glb');
  const joints = new Set(art.skins.flatMap(skin => skin.joints.map(i => art.nodes[i].name)));
  for (const bone of ['spine_03', 'neck_01', 'head', 'upperarm_l', 'lowerarm_l', 'hand_l', 'middle_01_l',
    'upperarm_r', 'lowerarm_r', 'hand_r', 'middle_01_r']) assert.ok(joints.has(bone), bone);
  assert.ok(art.meshes.some(mesh => mesh.extras?.targetNames?.includes('blink_left')));
  assert.ok(art.images.every(image => Number.isInteger(image.bufferView)), 'all character textures travel with the GLB');
});
