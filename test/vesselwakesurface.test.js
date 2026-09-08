import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VesselWakeSurface, VESSEL_WAKE_GLSL, MAX_SURFACE_WAKE_SOURCES } from '../src/vesselwakesurface.js';
import { clampWakeHeight, sampleWakeFields, wakeSampleAt } from '../src/wakefield.js';
const previousDocument = globalThis.document;
globalThis.document = { createElement: () => ({ width: 0, height: 0,
  getContext: () => ({ fillRect() {}, fillText() {}, strokeRect() {} }),
}) };
const [{ Traffic }, { SkiffAI }, { EncounterDirector }, { WorldIncidents }, { StoryDirector }, { FalsePassage }, { StormLine }, { ResidentContracts }, { StormRecovery }] = await Promise.all(
  ['life', 'npc', 'encounters', 'incidents', 'story', 'passage', 'stormline', 'contracts', 'aftermath'].map(name => import(`../src/${name}.js`)),
);
if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;

const agent = (extra = {}) => ({ active: true, x: 0, z: 0, heading: 0, speed: 10, ...extra });
const director = (Type, state) => Object.assign(Object.create(Type.prototype), state);
function fixture() {
  const traffic = director(Traffic, { boats: [agent({ kind: 'air', max: 14 }), agent({ kind: 'cruiser', max: 12 }), agent({ kind: 'canoe', max: 4 })] });
  const skiff = director(SkiffAI, { active: true, pos: { x: 0, y: 0 }, heading: 0, speed: 10, maxSpeed: 11.6 });
  const encounters = director(EncounterDirector, { agents: [agent({ wakeScale: 0.16, wakeMaxSpeed: 13 }), agent({ max: 10 }), agent({ maxSpeed: 12 }), agent()] });
  const incidents = director(WorldIncidents, { agents: [agent(), agent({ backing: true })] });
  const story = director(StoryDirector, {
    passage: director(FalsePassage, { chaseActive: true, agent: agent() }),
    stormLine: director(StormLine, { agents: [agent(), agent()] }),
    contracts: director(ResidentContracts, { agents: [agent(), agent()] }),
    departT: 5, departPoint: { x: 0, z: 0, heading: 0 }, departSpeed: 5.5,
  });
  const aftermath = director(StormRecovery, {
    sites: [{ id: 'tow', type: 'blockage', stage: 'marked' }, { id: 'rescue', type: 'survivor', stage: 'reported' }, { id: 'dormant', type: 'blockage', stage: 'found' }],
    rigs: new Map([['tow', { agent: agent() }], ['rescue', { agent: agent() }], ['dormant', { agent: agent() }]]),
  });
  const player = { wet: 1, pos: { x: 10, y: 20 }, heading: 0.7, speed: 14 };
  const fields = [traffic, skiff, encounters, incidents, story, aftermath];
  return { sources: { traffic, skiff, encounters, incidents, story, aftermath, player }, fields };
}

// Decode the values actually sent to the shader and compare them with the real directors' CPU methods. This
// catches source eligibility, default speeds/scales, group identity, and nested caps rather than testing a mock field.
function packedHeight(surface, x, z, t, withPlayer = true) {
  const groups = new Float64Array(10);
  for (let i = 0; i < surface.count; i++) {
    const j = i * 4, p = surface.pose, m = surface.motion, dx = x - p[j], dz = z - p[j + 1];
    if (m[j + 3] && dx * dx + dz * dz > 10609) continue;
    groups[m[j + 2]] += wakeSampleAt(p[j], p[j + 1], Math.atan2(p[j + 2], p[j + 3]), 2.2 + m[j] * 9.8, 12, m[j + 1], x, z, t);
  }
  const story = clampWakeHeight(groups[4] + clampWakeHeight(groups[5], 0.24) + clampWakeHeight(groups[6], 0.24) + groups[7], 0.28);
  return clampWakeHeight(clampWakeHeight(groups[0], 0.24) + groups[1] + clampWakeHeight(groups[2], 0.24)
    + clampWakeHeight(groups[3], 0.24) + story + clampWakeHeight(groups[8], 0.2), 0.34) + (withPlayer ? groups[9] : 0);
}

test('packed wake sources match every real CPU field including nested story and overlap caps', () => {
  const { sources, fields } = fixture(), surface = new VesselWakeSurface(); surface.sources = sources;
  surface.update({ x: 0, z: 0 });
  assert.equal(surface.count, 17); assert.equal(surface.overflow, 0);
  let nonzero = 0;
  for (let i = 0; i < 1000; i++) {
    const x = Math.sin(i * 1.71) * 35, z = i % 106, t = i * 0.017;
    const expected = sampleWakeFields(fields, x, z, t);
    assert.ok(Math.abs(packedHeight(surface, x, z, t, false) - expected) < 1e-6);
    if (Math.abs(expected) > 0.01) nonzero++;
  }
  assert.ok(nonzero > 100);
  const p = sources.player;
  for (let i = 0; i < 40; i++) {
    const x = i - 20, z = 40, t = i * 0.05;
    const own = wakeSampleAt(p.pos.x, p.pos.y, p.heading, p.speed, 18, 0.22, x, z, t);
    assert.ok(Math.abs(packedHeight(surface, x, z, t) - sampleWakeFields(fields, x, z, t) - own) < 1e-6);
  }
});

test('inactive, backed, invalid and distant sources cannot leave stale GPU crests', () => {
  const { sources } = fixture(), surface = new VesselWakeSurface(); surface.sources = sources;
  surface.update({ x: 0, z: 0 });
  const active = surface.count;
  sources.story.passage.chaseActive = false; sources.story.departT = 0; sources.player.wet = 0;
  sources.incidents.agents[0].backing = true; sources.encounters.agents[0].x = NaN;
  sources.aftermath.sites[0].stage = 'cleared'; sources.aftermath.sites[1].stage = 'rescued';
  surface.update({ x: 0, z: 0 });
  assert.equal(surface.count, active - 7);
  surface.update({ x: 1000, z: 1000 }); assert.equal(surface.count, 0);
  surface.update({ x: 0, z: 0 }, false); assert.equal(surface.uniforms.vesselWakeCount.value, 0);
});

test('the wake bridge keeps fixed uniform buffers and reports capacity overflow', () => {
  const { sources } = fixture(), surface = new VesselWakeSurface(); surface.sources = sources;
  const pose = surface.pose, motion = surface.motion;
  for (let i = 0; i < 100; i++) { sources.skiff.pos.x = i * 0.1; surface.update({ x: 0, z: 0 }); }
  assert.equal(surface.pose, pose); assert.equal(surface.motion, motion);
  assert.equal(pose.byteLength + motion.byteLength, 1536);
  sources.traffic.boats = Array.from({ length: 60 }, () => agent({ kind: 'air', max: 14 }));
  surface.update({ x: 0, z: 0 });
  assert.equal(surface.count, MAX_SURFACE_WAKE_SOURCES); assert.ok(surface.overflow > 0);
  surface.update({ x: 0, z: 0 }, false); assert.equal(surface.overflow, 0);
});

test('the player wake fades with hull contact in both the rendered and resident-boat fields', () => {
  const { sources } = fixture(), surface = new VesselWakeSurface(); surface.sources = sources;
  sources.traffic.phys = sources.player;
  const p = sources.player; p.pos.x = 0; p.pos.y = 0; p.heading = 0; p.speed = 18;
  const expected = wakeSampleAt(0, 0, 0, 18, 18, 0.22, 14.7, 40, 0);
  assert.ok(Math.abs(expected) > 0.05);
  for (const wet of [1, 0.75, 0.3, 0.1, 0]) {
    p.wet = wet; surface.update({ x: 0, z: 0 });
    assert.ok(Math.abs(sources.traffic.playerWakeAt(14.7, 40, 0) - expected * wet) < 1e-12);
    assert.ok(Math.abs(packedHeight(surface, 14.7, 40, 0) - packedHeight(surface, 14.7, 40, 0, false) - expected * wet) < 1e-6);
  }
});

test('vessel crests displace the retained mesh before world projection without a new render pass', async () => {
  const [main, water] = await Promise.all(['main', 'water'].map(name => readFile(new URL(`../src/${name}.js`, import.meta.url), 'utf8')));
  assert.match(main, /water\.vesselWakes\.sources = \{ traffic: life\.traffic, skiff, encounters, incidents, story, aftermath, player: phys \}/);
  assert.match(main, /water\.vesselWakes\.update\(camera\.position, started\)/);
  assert.ok(water.indexOf('wave += vesselWakeSample') < water.indexOf('wp.y += wave.x'));
  assert.match(water, /\.\.\.this\.vesselWakes\.uniforms/);
  assert.match(VESSEL_WAKE_GLSL, /vec3\(amplitude \* wave, gradient\)/);
  assert.match(VESSEL_WAKE_GLSL, /limitVesselWave\(groups\[5\], 0.24\)/);
  assert.match(VESSEL_WAKE_GLSL, /received \+ groups\[9\]/);
  assert.doesNotMatch(VESSEL_WAKE_GLSL, /\bfloat\s+filter\b/);
  assert.match(water, /reflectionOffset \*= 0.035 \/ max\(0.035, length\(reflectionOffset\)\)/);
});
