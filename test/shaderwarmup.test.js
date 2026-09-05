import test from 'node:test';
import assert from 'node:assert/strict';
import { deferredShaderObjects, prepareRenderShaders, shaderVariantKey, warmDeferredShaders, warmRetainedObject } from '../src/shaderwarmup.js';

const material = (id, shader = true, source = id) => ({ uuid: id, isShaderMaterial: shader, vertexShader: `vertex:${source}`, fragmentShader: `fragment:${source}` });
const object = (id, ownMaterial = null, children = []) => ({
  id, material: ownMaterial, children,
  traverse(visitor) { visitor(this); for (const child of children) child.traverse(visitor); },
});

test('deferred shader collection deduplicates shared programs and skips standard materials', () => {
  const shared = material('shared'), standard = material('standard', false);
  const scene = object('scene', null, [
    object('spray', shared), object('plume', shared), object('spray-copy', material('spray-copy', true, 'shared')),
    object('boat', standard), object('beacon', material('beacon')),
  ]);
  const result = deferredShaderObjects([scene]);
  assert.equal(result.materials, 3); assert.equal(result.variants, 2);
  assert.deepEqual(result.objects.map(entry => entry.object.id), ['spray', 'beacon']);
  assert.ok(result.objects.every(entry => entry.targetScene === scene));
});

test('shader variants distinguish primitive paths and sorted defines but ignore uniforms', () => {
  const a = { ...material('a', true, 'same'), defines: { ZED: 2, ALPHA: 1 }, uniforms: { color: { value: 1 } } };
  const b = { ...material('b', true, 'same'), defines: { ALPHA: 1, ZED: 2 }, uniforms: { color: { value: 9 } } };
  assert.equal(shaderVariantKey(a, {}), shaderVariantKey(b, {}));
  assert.notEqual(shaderVariantKey(a, {}), shaderVariantKey(b, { isPoints: true }));
});

test('deferred shader warm-up compiles behind loading and contains individual failures', async () => {
  const scene = object('scene', null, [object('spray', material('spray')), object('beacon', material('beacon'))]);
  const calls = [], renderer = {
    async compileAsync(target, camera, targetScene) {
      calls.push([target.id, camera.id, targetScene.id]);
      if (target.id === 'beacon') throw new Error('bad optional shader');
    },
  };
  let clock = 20;
  const result = await warmDeferredShaders(renderer, { id: 'camera' }, [scene], () => (clock += 5));
  assert.deepEqual(calls, [['spray', 'camera', 'scene'], ['beacon', 'camera', 'scene']]);
  assert.deepEqual(result, { objects: 2, materials: 2, variants: 2, completed: 1, failures: 1, durationMs: 5 });
});

test('deferred shader warm-up falls back to the synchronous compiler', async () => {
  const scene = object('scene', material('sky'));
  const calls = [], renderer = { compile(target, camera, targetScene) { calls.push([target.id, camera.id, targetScene.id]); } };
  const result = await warmDeferredShaders(renderer, { id: 'camera' }, [scene], () => 0);
  assert.deepEqual(calls, [['scene', 'camera', 'scene']]);
  assert.equal(result.completed, 1); assert.equal(result.failures, 0);
});

test('an explicit retained stock-material object warms once and restores visibility', async () => {
  const target = { id: 'prop-wrap', visible: false }, scene = { id: 'scene' }, camera = { id: 'camera' }, calls = [];
  const renderer = { async compileAsync(object, view, targetScene) { calls.push([object.id, object.visible, view.id, targetScene.id]); } };
  let clock = 10;
  const result = await warmRetainedObject(renderer, camera, scene, target, () => (clock += 3));
  assert.deepEqual(calls, [['prop-wrap', true, 'camera', 'scene']]); assert.equal(target.visible, false);
  assert.deepEqual(result, { attempted: 1, completed: 1, failures: 0, durationMs: 3 });
});

test('explicit retained warm-up contains failure and still restores a visible object', async () => {
  const target = { visible: true }, renderer = { compile() { throw new Error('compile failed'); } };
  const result = await warmRetainedObject(renderer, {}, {}, target, () => 0);
  assert.equal(target.visible, true); assert.deepEqual(result, { attempted: 1, completed: 0, failures: 1, durationMs: 0 });
});

test('HDR preparation restores the live target before waiting and finishes driver queries after readiness', async () => {
  const hdr = {}, live = {}, scene = {}, camera = {}, mat = {}, calls = [];
  const root = { traverse(visit) { visit({ material: mat }); visit({ material: mat }); } };
  let target = live, release;
  const ready = new Promise(resolve => { release = resolve; });
  const program = { getUniforms() { calls.push('uniforms'); }, getAttributes() { calls.push('attributes'); } };
  const renderer = {
    getRenderTarget: () => target, getActiveCubeFace: () => 3, getActiveMipmapLevel: () => 2,
    setRenderTarget(next, face, mip) { target = next; if (next === live) assert.deepEqual([face, mip], [3, 2]); },
    compileAsync(object, view, destination) { assert.equal(target, hdr); assert.equal(object, root); assert.equal(view, camera); assert.equal(destination, scene); calls.push('compile'); return ready; },
    properties: { get: () => ({ programs: new Map([['hdr', program]]) }) },
  };
  const preparation = prepareRenderShaders(renderer, camera, scene, root, hdr);
  assert.equal(target, live); assert.deepEqual(calls, ['compile']);
  release(); assert.equal(await preparation, root);
  assert.deepEqual(calls, ['compile', 'uniforms', 'attributes']);
});

test('a compiler error cannot leave the game rendering into its warm-up target', async () => {
  const live = {}, hdr = {}; let target = live;
  const renderer = { getRenderTarget: () => target, setRenderTarget: value => { target = value; }, compile() { throw new Error('compile failed'); } };
  await assert.rejects(prepareRenderShaders(renderer, {}, {}, {}, hdr), /compile failed/);
  assert.equal(target, live);
});
