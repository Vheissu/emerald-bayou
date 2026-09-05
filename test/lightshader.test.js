import test from 'node:test';
import assert from 'node:assert/strict';
import { ShaderChunk } from 'three';
import { cullZeroContributionLights, installZeroContributionLightCulling } from '../src/lightshader.js';

test('pooled light guards retain the installed renderer lighting, shadows and unrolled loops', () => {
  const original = ShaderChunk.lights_fragment_begin, patched = cullZeroContributionLights(original);
  assert.notEqual(patched, original);
  assert.equal((patched.match(/#pragma unroll_loop_start/g) || []).length, (original.match(/#pragma unroll_loop_start/g) || []).length);
  assert.equal((patched.match(/#pragma unroll_loop_end/g) || []).length, (original.match(/#pragma unroll_loop_end/g) || []).length);
  assert.ok(patched.includes('notEqual( pointLight.color, vec3( 0.0 ) )'));
  assert.ok(patched.includes('notEqual( spotLight.color, vec3( 0.0 ) )'));
  assert.equal((patched.match(/notEqual\( directLight.color/g) || []).length, 2);
  assert.ok(patched.includes('getPointShadow(')); assert.ok(patched.includes('getShadow('));
  const directional = '#if ( NUM_DIR_LIGHTS > 0 )';
  assert.equal(patched.slice(patched.indexOf(directional)), original.slice(original.indexOf(directional)));
  assert.equal(cullZeroContributionLights(patched), patched);
  assert.equal(installZeroContributionLightCulling(), true);
  assert.equal(ShaderChunk.lights_fragment_begin, patched);
});

test('an unfamiliar future shader layout is left untouched', () => {
  const unknown = 'void main() { gl_FragColor = vec4(1.0); }';
  assert.equal(cullZeroContributionLights(unknown), unknown);
});
