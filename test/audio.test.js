import test from 'node:test';
import assert from 'node:assert/strict';
import { cameraRelativePan, EngineAudio } from '../src/audio.js';

const audioParam = (value = 0) => ({
  value,
  setTargetAtTime(next) { this.value = next; },
  setValueAtTime(next) { this.value = next; },
  exponentialRampToValueAtTime(next) { this.value = next; },
});

function mockAudioContext() {
  const counts = { oscillators: 0, gains: 0, filters: 0 };
  const allocations = { buffers: 0, sources: [], oscillators: [], panners: [] };
  const connectable = extras => ({ ...extras, connect() { return this; }, disconnect() { this.disconnected = true; } });
  const scheduled = extras => connectable({ ...extras, start() {}, stop() {}, addEventListener(type, handler) { if (type === 'ended') this.onended = handler; }, finish() { this.onended?.(); } });
  return {
    currentTime: 0,
    state: 'running',
    counts, allocations,
    async suspend() { this.state = 'suspended'; },
    async resume() { this.state = 'running'; },
    createOscillator() { counts.oscillators++; const oscillator = scheduled({ type: 'sine', frequency: audioParam() }); allocations.oscillators.push(oscillator); return oscillator; },
    createGain() { counts.gains++; return connectable({ gain: audioParam() }); },
    createBiquadFilter() { counts.filters++; return connectable({ type: 'lowpass', frequency: audioParam(), Q: audioParam() }); },
    createStereoPanner() { const panner = connectable({ pan: audioParam() }); allocations.panners.push(panner); return panner; },
    createBuffer() { allocations.buffers++; return { getChannelData: () => new Float32Array(1) }; },
    createBufferSource() { const source = scheduled({ buffer: null, loop: false }); allocations.sources.push(source); return source; },
  };
}

test('camera-relative pan follows listener heading without allocating scene objects', () => {
  assert.equal(cameraRelativePan(0, 0, 0, -1, 10, 0), 1);
  assert.equal(cameraRelativePan(0, 0, 0, -1, -10, 0), -1);
  assert.equal(cameraRelativePan(0, 0, 0, -1, 0, -10), 0);
  assert.equal(cameraRelativePan(0, 0, 1, 0, 0, 10), 1);
  assert.equal(cameraRelativePan(4, 8, 0, -1, 4, 8), 0);
  assert.equal(cameraRelativePan(0, 0, 0, 0, 10, 0), 0);
});

test('page hibernation suspends and resumes the existing audio context idempotently', async () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx;
  assert.equal(await audio.suspend(), true);
  assert.equal(ctx.state, 'suspended');
  assert.equal(await audio.suspend(), false);
  assert.equal(await audio.resume(), true);
  assert.equal(ctx.state, 'running');
  assert.equal(await audio.resume(), false);
});

test('spatial output uses a panner when available and falls back to the shared effects bus', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(), bus = {};
  audio.ctx = ctx; audio.sfx = bus; audio.setListener(10, 20, 0, -4);
  const spatial = audio.spatialDestination(20, 20);
  assert.equal(spatial, ctx.allocations.panners[0]); assert.equal(spatial.pan.value, 1);
  assert.deepEqual(audio.spatialStats(), { supported: true, transientActive: 1, transientCreated: 1, persistentNodes: 0, listener: { x: 10, z: 20, forwardX: 0, forwardZ: -1 } });
  delete ctx.createStereoPanner;
  assert.equal(audio.spatialDestination(0, 0), bus);
});

test('a compound world sound shares one transient panner across all of its voices', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx; audio.sfx = {}; audio.noiseBuf = {};
  audio.setListener(0, 0, 0, -1); audio.plip(0.4, 12, 0);
  assert.equal(ctx.allocations.panners.length, 1); assert.equal(ctx.allocations.panners[0].pan.value, 1);
  assert.deepEqual(audio.spatialStats(), { supported: true, transientActive: 1, transientCreated: 1, persistentNodes: 0, listener: { x: 0, z: 0, forwardX: 0, forwardZ: -1 } });
  ctx.allocations.sources[0].finish();
  assert.equal(ctx.allocations.panners[0].disconnected, true); assert.equal(audio.spatialStats().transientActive, 0);
});

test('a multi-blast fog signal shares one spatial output and releases it after the last blast', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx; audio.sfx = {};
  audio.setListener(0, 0, 0, -1); audio.fogHornFishing(0.35, 18, 0);
  assert.equal(ctx.allocations.panners.length, 1);
  assert.equal(ctx.allocations.oscillators.length, 6);
  assert.equal(audio.spatialStats().transientActive, 1);
  ctx.allocations.oscillators.at(-1).finish();
  assert.equal(ctx.allocations.panners[0].disconnected, true);
  assert.equal(audio.spatialStats().transientActive, 0);
});

test('a Rule 34 danger signal uses five rapid blasts on one spatial output', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx; audio.sfx = {};
  audio.setListener(0, 0, 0, -1); audio.maneuverHorn(5, 0.4, -18, 0);
  assert.equal(ctx.allocations.panners.length, 1); assert.equal(ctx.allocations.panners[0].pan.value, -0.92);
  assert.equal(ctx.allocations.oscillators.length, 10); assert.equal(audio.spatialStats().transientActive, 1);
  ctx.allocations.oscillators.at(-1).finish();
  assert.equal(ctx.allocations.panners[0].disconnected, true); assert.equal(audio.spatialStats().transientActive, 0);
});

test('patrol siren is lazy and reuses one fixed audio graph throughout a chase', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx; audio.sfx = {};
  audio.patrolSiren(0);
  assert.deepEqual(ctx.counts, { oscillators: 0, gains: 0, filters: 0 });
  audio.setListener(0, 0, 0, -1); audio.patrolSiren(0.4, 2, 20, 0);
  assert.deepEqual(ctx.counts, { oscillators: 3, gains: 2, filters: 1 });
  assert.equal(ctx.allocations.panners.length, 1); assert.equal(audio.siren.panner.pan.value, 0.95);
  const graph = audio.siren, panner = audio.siren.panner;
  audio.patrolSiren(0.9, 5, -20, 0); audio.patrolSiren(0);
  assert.equal(audio.siren, graph);
  assert.equal(audio.siren.panner, panner); assert.equal(panner.pan.value, -0.95); assert.equal(ctx.allocations.panners.length, 1);
  assert.deepEqual(ctx.counts, { oscillators: 3, gains: 2, filters: 1 });
});

test('helicopter audio reuses one spatial rotor graph while the aircraft moves', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx; audio.sfx = {}; audio.amb = { connect() {} };
  audio.helicopter(0); assert.equal(ctx.allocations.panners.length, 0);
  audio.setListener(0, 0, 0, -1); audio.helicopter(0.5, 1, 30, 0);
  assert.equal(ctx.allocations.panners.length, 1); assert.equal(audio.heli.panner.pan.value, 0.9);
  const graph = audio.heli, panner = audio.heli.panner;
  audio.helicopter(0.8, 1.1, -30, 0); audio.helicopter(0);
  assert.equal(audio.heli, graph); assert.equal(audio.heli.panner, panner); assert.equal(panner.pan.value, -0.9);
  assert.equal(ctx.allocations.panners.length, 1); assert.deepEqual(ctx.counts, { oscillators: 2, gains: 2, filters: 2 });
});

test('fishing reel audio is lazy and reuses one graph while tension changes', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx; audio.sfx = {};
  audio.fishingReel(0, 0); assert.deepEqual(ctx.counts, { oscillators: 0, gains: 0, filters: 0 });
  audio.fishingReel(1, 0.4); assert.deepEqual(ctx.counts, { oscillators: 1, gains: 1, filters: 1 });
  const graph = audio.fishingReelGraph;
  audio.fishingReel(1, 0.9); audio.fishingReel(0, 0);
  assert.equal(audio.fishingReelGraph, graph); assert.deepEqual(ctx.counts, { oscillators: 1, gains: 1, filters: 1 });
});

test('waterspout audio is lazy and reuses one spatial graph fed by the retained noise bed', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx; audio.sfx = {}; audio.amb = { connect() {} };
  audio.waterspout(0); assert.deepEqual(ctx.counts, { oscillators: 0, gains: 0, filters: 0 });
  audio.setListener(0, 0, 0, -1); audio.waterspout(0.6, 20, 0);
  assert.deepEqual(ctx.counts, { oscillators: 0, gains: 2, filters: 2 }); assert.equal(ctx.allocations.panners.length, 1);
  const graph = audio.spoutAudio, panner = graph.panner;
  audio.waterspout(0.9, -20, 0); audio.waterspout(0);
  assert.equal(audio.spoutAudio, graph); assert.equal(graph.panner, panner); assert.equal(ctx.allocations.panners.length, 1);
  assert.equal(panner.pan.value, -0.96); assert.deepEqual(ctx.counts, { oscillators: 0, gains: 2, filters: 2 });
});

test('night-life ambience changes the existing bed without allocating another graph', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx;
  audio.nightLife(2); assert.equal(audio.nightLifeLevel, 1);
  audio.nightLife(-1); assert.equal(audio.nightLifeLevel, 0);
  assert.deepEqual(ctx.counts, { oscillators: 0, gains: 0, filters: 0 });
});

test('thunder loops the retained noise sample without allocating another audio buffer', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(), retained = { id: 'noise' };
  audio.ctx = ctx; audio.sfx = {}; audio.noiseBuf = retained;
  audio.thunder(0.8); audio.thunder(1);
  assert.equal(ctx.allocations.buffers, 0);
  assert.equal(ctx.allocations.sources.length, 2);
  for (const source of ctx.allocations.sources) { assert.equal(source.buffer, retained); assert.equal(source.loop, true); }
  assert.deepEqual(ctx.counts, { oscillators: 0, gains: 2, filters: 2 });
});
