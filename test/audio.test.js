import test from 'node:test';
import assert from 'node:assert/strict';
import { EngineAudio } from '../src/audio.js';

const audioParam = (value = 0) => ({ value, setTargetAtTime(next) { this.value = next; } });

function mockAudioContext() {
  const counts = { oscillators: 0, gains: 0, filters: 0 };
  const connectable = extras => ({ ...extras, connect() { return this; } });
  return {
    currentTime: 0,
    counts,
    createOscillator() { counts.oscillators++; return connectable({ type: 'sine', frequency: audioParam(), start() {} }); },
    createGain() { counts.gains++; return connectable({ gain: audioParam() }); },
    createBiquadFilter() { counts.filters++; return connectable({ type: 'lowpass', frequency: audioParam(), Q: audioParam() }); },
  };
}

test('patrol siren is lazy and reuses one fixed audio graph throughout a chase', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx; audio.sfx = {};
  audio.patrolSiren(0);
  assert.deepEqual(ctx.counts, { oscillators: 0, gains: 0, filters: 0 });
  audio.patrolSiren(0.4, 2);
  assert.deepEqual(ctx.counts, { oscillators: 3, gains: 2, filters: 1 });
  const graph = audio.siren;
  audio.patrolSiren(0.9, 5); audio.patrolSiren(0);
  assert.equal(audio.siren, graph);
  assert.deepEqual(ctx.counts, { oscillators: 3, gains: 2, filters: 1 });
});

test('fishing reel audio is lazy and reuses one graph while tension changes', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx; audio.sfx = {};
  audio.fishingReel(0, 0); assert.deepEqual(ctx.counts, { oscillators: 0, gains: 0, filters: 0 });
  audio.fishingReel(1, 0.4); assert.deepEqual(ctx.counts, { oscillators: 1, gains: 1, filters: 1 });
  const graph = audio.fishingReelGraph;
  audio.fishingReel(1, 0.9); audio.fishingReel(0, 0);
  assert.equal(audio.fishingReelGraph, graph); assert.deepEqual(ctx.counts, { oscillators: 1, gains: 1, filters: 1 });
});

test('night-life ambience changes the existing bed without allocating another graph', () => {
  const audio = new EngineAudio(), ctx = mockAudioContext(); audio.ctx = ctx;
  audio.nightLife(2); assert.equal(audio.nightLifeLevel, 1);
  audio.nightLife(-1); assert.equal(audio.nightLifeLevel, 0);
  assert.deepEqual(ctx.counts, { oscillators: 0, gains: 0, filters: 0 });
});
