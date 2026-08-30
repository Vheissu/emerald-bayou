import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every retained powered-craft director contributes to the player wake field', async () => {
  const [main, npc, encounters, incidents, passage, stormline, contracts, story, aftermath] = await Promise.all([
    'main.js', 'npc.js', 'encounters.js', 'incidents.js', 'passage.js', 'stormline.js', 'contracts.js', 'story.js', 'aftermath.js',
  ].map(file => readFile(join(root, 'src', file), 'utf8')));

  assert.match(main, /const physicalWakeFields = \[life\.traffic\]/);
  assert.match(main, /const directedVesselSources = \[skiff, encounters, incidents, story, aftermath\]/);
  assert.match(main, /physicalWakeFields\.push\(\.\.\.directedVesselSources\)/);
  assert.match(main, /ecology\.setDirectedVesselSources\(directedVesselSources\)/);
  assert.match(main, /sampleWakeFields\(physicalWakeFields, x, z, t\)/);
  for (const source of [npc, encounters, incidents, passage, stormline, contracts, story, aftermath]) assert.match(source, /wakeHeightAt\(x, z, t\)/);
  for (const source of [npc, encounters, incidents, story, aftermath]) assert.match(source, /visitActiveVessels\(visitor\)/);
  assert.match(story, /this\.passage\?\.wakeHeightAt/);
  assert.match(story, /this\.stormLine\?\.wakeHeightAt/);
  assert.match(story, /this\.contracts\?\.wakeHeightAt/);
  assert.match(story, /this\.stormLine\?\.agents/);
  assert.match(story, /this\.contracts\?\.agents/);
});

test('small story boat pools are retained instead of rebuilt in wake and stamp loops', async () => {
  const [stormline, contracts] = await Promise.all([
    readFile(join(root, 'src', 'stormline.js'), 'utf8'),
    readFile(join(root, 'src', 'contracts.js'), 'utf8'),
  ]);
  assert.match(stormline, /this\.agents = \[this\.convoy, this\.chaser\]/);
  assert.match(stormline, /for \(const A of this\.agents\)/);
  assert.match(contracts, /this\.agents = \[this\.rigs\.patrolAgent, this\.rigs\.receiverAgent\]/);
  assert.match(contracts, /for \(const A of this\.agents\)/);
});

test('directed boat visitors expose retained light metadata to one shared renderer pool', async () => {
  const [main, npc, encounters, incidents, passage, stormline, contracts, story, aftermath] = await Promise.all([
    'main.js', 'npc.js', 'encounters.js', 'incidents.js', 'passage.js', 'stormline.js', 'contracts.js', 'story.js', 'aftermath.js',
  ].map(file => readFile(join(root, 'src', file), 'utf8')));

  assert.match(main, /new DirectedNavigationLights\(scene\)/);
  assert.match(main, /directedNavigationLights\.update\(directedVesselSources, camera\.position, environment, started\)/);
  assert.match(npc, /visitor\(this\.pos\.x, this\.pos\.y, this\.speed, 'skiff', this\)/);
  for (const source of [encounters, incidents, aftermath]) assert.match(source, /visitor\(agent\.x, agent\.z, agent\.speed, 'skiff', agent\)/);
  assert.match(story, /visitor\(passageAgent\.x, passageAgent\.z, passageAgent\.speed, 'skiff', passageAgent\)/);
  assert.match(story, /visitor\(this\.departPoint\.x, this\.departPoint\.z, this\.departSpeed, 'skiff', this\.departPoint\)/);

  assert.match(npc, /this\.navigationLights = true/);
  assert.match(incidents, /navigationLights: role === 'patrol' \|\| role === 'victim'/);
  assert.match(encounters, /navigationLights = searchRole >= 0/);
  assert.match(passage, /this\.agent\.navigationLights = patrol/);
  assert.match(stormline, /this\.convoy\.navigationLights = !runner; this\.chaser\.navigationLights = runner/);
  assert.match(contracts, /navigationLights: role === 'contract-patrol'/);
  assert.match(story, /this\.departPoint\.navigationLights = navigationLights/);
});
