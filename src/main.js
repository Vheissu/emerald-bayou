import * as THREE from 'three';
import { Terrain, WORLD_HALF } from './terrain.js';
import { Sky } from './sky.js';
import { Water } from './water.js';
import { Vegetation } from './vegetation.js';
import { buildTower, buildDock } from './tower.js';
import { buildAirboat, AirboatPhysics, loadDriver } from './airboat.js';
import { Birds, Waders, Manatees, Gators } from './wildlife.js';
import { SkiffAI } from './npc.js';
import { Spray, Plume } from './particles.js';
import { Pipeline } from './post.js';
import { Minimap } from './hud.js';
import { EngineAudio } from './audio.js';
import * as TEX from './textures.js';
import { mulberry32 } from './noise.js';
import { Game } from './game.js';
import { crabFloat, fuelDrum, wreck, shack, kayak } from './markers.js';
import { Tricks } from './tricks.js';
import { World, disposeDetachedGeometries } from './world.js';
import { WorldMap } from './worldmap.js';
import { Life } from './life.js';
import { pickSite, buildSite } from './sites.js';
import { person, canoe } from './folk.js';
import { spawn, preload, loadGeo, loadModel, modelBox } from './models.js';
import { Environment } from './environment.js';
import { EncounterDirector } from './encounters.js';
import { BoatCondition } from './condition.js';
import { Ecology } from './ecology.js';
import { Law } from './law.js';
import { StormHazards } from './stormhazards.js';
import { Reputation } from './reputation.js';
import { CurrentField } from './currents.js';
import { RegionDirector, regionAt } from './regions.js';
import { RadioDirector } from './radio.js';
import { WorldIncidents } from './incidents.js';
import { StoryDirector } from './story.js';
import { StormRecovery } from './aftermath.js';
import { AdaptiveQualityController, MAX_DRAW_PIXELS, initialQualityLevel, pixelRatioFor } from './renderquality.js';
import { nextQualityPreference, qualityControllerConfig, qualityPreferenceLabel, readQualityPreference, writeQualityPreference } from './displaysettings.js';
import { startupPlan, startupTerrainReady } from './startup.js';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
const hardwareQualityLevel = initialQualityLevel({
  deviceMemory: navigator.deviceMemory,
  hardwareConcurrency: navigator.hardwareConcurrency,
  maxTextureSize: renderer.capabilities.maxTextureSize,
  saveData: navigator.connection?.saveData === true,
});
let qualityPreference = readQualityPreference();
const qualityController = new AdaptiveQualityController(qualityControllerConfig(qualityPreference, hardwareQualityLevel));
let renderProfile = qualityController.profile;
renderer.setPixelRatio(pixelRatioFor(window.innerWidth, window.innerHeight, window.devicePixelRatio, renderProfile.maxDrawPixels, renderProfile.maxDevicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.className = 'gl';
app.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.3, 7500);
camera.layers.enable(1); // layer 1: small foliage (grass, reeds, moss) drawn by the main camera only, not in the reflection
const scene = new THREE.Scene();
const fxScene = new THREE.Scene();

const SUN_DIR = new THREE.Vector3(-0.42, 0.72, -0.55).normalize();

async function init() {
  const startup = startupPlan(renderProfile.id);
  // ---- sky & lighting ----
  const sky = new Sky(SUN_DIR);
  scene.add(sky.mesh);
  const sun = new THREE.DirectionalLight(0xfff2dc, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(renderProfile.shadowMapSize, renderProfile.shadowMapSize);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 900;
  sun.shadow.camera.left = -120; sun.shadow.camera.right = 120; sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
  sun.shadow.bias = -0.00035; sun.shadow.normalBias = 0.6; sun.shadow.radius = 2;
  scene.add(sun); scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0x9fc3e8, 0x3f4a2a, 0.4);
  scene.add(hemi);

  // environment map from the sky (for PBR reflections on the boat / wet mud)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene(); const skyClone = sky.mesh.clone(); skyScene.add(skyClone);
  scene.environment = pmrem.fromScene(skyScene, 0, 0.1, 4000).texture;
  scene.environmentIntensity = 0.4;
  pmrem.dispose();

  await new Promise(r => setTimeout(r, 30));

  // ---- terrain ----
  const terrain = new Terrain(7);
  const groundTex = { grass: TEX.grassGround(), mud: TEX.mudGround(), sand: TEX.sandGround(), noise: TEX.noiseTex() };
  scene.add(terrain.buildMesh(groundTex));

  await new Promise(r => setTimeout(r, 10));

  // ---- landmarks ----
  const island = terrain.island;
  const towerH = terrain.heightAt(island.x, island.y);
  const tower = buildTower();
  const towerOff = new THREE.Vector2(terrain.lagoon.x - island.x, terrain.lagoon.y - island.y).normalize().multiplyScalar(11);
  tower.position.set(island.x + towerOff.x, terrain.heightAt(island.x + towerOff.x, island.y + towerOff.y) - 0.2, island.y + towerOff.y);
  tower.rotation.y = Math.atan2(terrain.lagoon.x - island.x, terrain.lagoon.y - island.y) + Math.PI / 2;
  scene.add(tower);
  // dock toward the lagoon
  const dir = new THREE.Vector2(terrain.lagoon.x - island.x, terrain.lagoon.y - island.y).normalize();
  let dist = 6; while (dist < 60 && terrain.heightAt(island.x + dir.x * dist, island.y + dir.y * dist) > 0.25) dist += 1;
  const dock = buildDock(16, 2.0);
  dock.position.set(island.x + dir.x * (dist - 3), 0, island.y + dir.y * (dist - 3));
  dock.rotation.y = Math.atan2(dir.x, dir.y) + Math.PI; // dock extends along its local -Z
  dock.position.y = 0.0;
  scene.add(dock);

  const startZ = 70, startX = terrain.riverCenterX(startZ);
  const exclusions = [{ x: tower.position.x, z: tower.position.z, r: 7 }, { x: startX, z: startZ, r: 14 }, { x: dock.position.x, z: dock.position.z, r: 4 }, { x: (island.x + dock.position.x) / 2, z: (island.y + dock.position.z) / 2, r: 4 }];
  for (const b of terrain.bars) exclusions.push({ x: b.x, z: b.z, r: b.r });

  // ---- vegetation ----
  const veg = new Vegetation(terrain, exclusions);
  // the Meshy grass clumps become instanced kinds before the first chunk is grown; the hero tree gets the wind
  await preload(['grass_a', 'grass_d']);
  for (const name of ['grass_a', 'grass_d']) { const r = await loadGeo(name); if (r) veg.addSolid(r.geo, r.mat, r.height); } // b and c stay at ~5.5k tris a clump (separate blades will not collapse), too heavy to instance
  loadModel('tree_c').then(root => { const f = modelBox('tree_c'); if (root && f) root.traverse(o => { if (o.isMesh) veg.windMat(o.material, f.box.min.y, f.box.max.y, f.scale, 0.28); }); });

  await new Promise(r => setTimeout(r, 10));

  // ---- boat ----
  const boat = buildAirboat();
  scene.add(boat.group);
  loadDriver(boat.group).catch(e => console.warn('driver model failed to load', e));
  const phys = new AirboatPhysics(terrain, startX, startZ, 0);
  // streamed chunks: vegetation is built per chunk as its ground arrives; tree trunks register as colliders
  terrain.onReady(c => veg.buildChunk(c));
  terrain.onDone(c => { if (c.colliders.length) phys.addTrunks(c.key, c.colliders); });
  terrain.onDispose(c => { veg.disposeChunk(c); phys.removeTrunks(c.key); });
  let dockTie;
  {
    const dEnd = new THREE.Vector2(dock.position.x - Math.sin(dock.rotation.y) * -16, dock.position.z - Math.cos(dock.rotation.y) * -16);
    phys.obstacles.push({ ax: dock.position.x, az: dock.position.z, bx: dEnd.x, bz: dEnd.y, r: 1.2 });
    phys.obstacles.push({ x: tower.position.x, z: tower.position.z, r: 4.5 });
    const dd = new THREE.Vector2(dEnd.x - dock.position.x, dEnd.y - dock.position.z).normalize();
    const side = new THREE.Vector2(-dd.y, dd.x);
    dockTie = { x: dEnd.x + dd.x * 2 + side.x * 4.5, z: dEnd.y + dd.y * 2 + side.y * 4.5 };
  }

  // ---- water ----
  const water = new Water(renderer, SUN_DIR, renderProfile);

  // ---- wildlife ----
  const birds = new Birds(terrain, new THREE.Vector3(startX, 0, startZ - 120));
  scene.add(birds.mesh);
  const waders = new Waders(terrain, 16, startX, startZ - 60);
  for (const w of waders.list) scene.add(w.mesh);
  const manatees = new Manatees(terrain, 4, new THREE.Vector3(startX, 0, startZ));
  for (const m of manatees.list) scene.add(m.mesh);
  const gators = new Gators(terrain, 18);
  for (const g of gators.list) scene.add(g.mesh);

  // ---- fx ----
  const spray = new Spray(12000);
  const plume = new Plume(2600);
  fxScene.add(plume.mesh, spray.points);

  // ---- post ----
  const pipeline = new Pipeline(renderer, camera, renderProfile);
  pipeline.grade.material.uniforms.sunDir.value.copy(SUN_DIR);
  pipeline.reflTexture = water.reflRT.texture;
  water.uniforms.tRefr.value = pipeline.sceneRT.texture;
  water.uniforms.tDepth.value = pipeline.sceneRT.depthTexture;
  water.uniforms.near.value = camera.near; water.uniforms.far.value = camera.far;
  plume.mat.uniforms.tDepth.value = pipeline.sceneRT.depthTexture;
  plume.mat.uniforms.resolution.value.copy(pipeline.size);
  plume.mat.uniforms.near.value = camera.near; plume.mat.uniforms.far.value = camera.far;
  const sunView = new THREE.Vector3(); const camVel = new THREE.Vector3(); const camPrev = new THREE.Vector3();
  // wind: slowly veering direction, gusty strength
  const wind = new THREE.Vector3(0.8, 1.0, 0.6);

  const minimap = new Minimap(terrain);
  const audio = new EngineAudio();
  const tricks = new Tricks(phys);
  const skiff = new SkiffAI((x, z, t) => water.waveHeight(x, z, t)); skiff.mesh.visible = false; scene.add(skiff.mesh);
  const world = new World(terrain, scene, (x, z, t) => water.waveHeight(x, z, t)); world.phys = phys; world.wind = wind;
  veg.blocked = (x, z) => world.blockedAt(x, z);
  const game = new Game({ phys, T: terrain, scene, audio, tricks, manatees, gators, skiff, boat: boat.group, dockTie, startX, startZ, world });
  game.paused = true; // loading and the title screen are presentation states, not unobserved play time
  const worldMap = new WorldMap(terrain, minimap, game, world); game.map = worldMap;
  // the small life: fish, deadheads, other boats, anglers; birds and gators get their voices and their hooks into the game
  const life = new Life({ terrain, scene, water, phys, plume, spray, audio, waveFn: (x, z, t) => water.waveHeight(x, z, t), game }); game.life = life;
  const playerWater = (x, z, t) => water.waveHeight(x, z, t) + life.traffic.wakeHeightAt(x, z, t);
  world.fx = { plume, spray, audio, fish: life.fish, playerWakeAt: (x, z, t) => life.traffic.playerWakeAt(x, z, t) }; world.onShot = (x, z) => { waders.flushNear && waders.flushNear(x, z, 140); };
  birds.audio = audio; gators.audio = audio;
  gators.onCharge = (g) => game.gatorCharge(g);
  gators.onSlide = (g, d) => { game.bounties.event('spook', 1); };
  gators.onSplash = (x, z, sc) => { for (let i = 0; i < 14; i++) plume.emit(x + jitter() * 1.2, 0.1, z + jitter() * 1.2, jitter() * 2, 0.8 + Math.random() * 1.8, jitter() * 2, 0.2 + Math.random() * 0.25, 1.0, 0.6 + Math.random() * 0.4, 0.3); for (let i = 0; i < 40; i++) spray.emit(x + jitter() * 1.2, 0.05, z + jitter() * 1.2, jitter() * 3, 1 + Math.random() * 2.5, jitter() * 3, 0.015 + Math.random() * 0.03, 0.4 + Math.random() * 0.4, 0.6); audio.splash(0.5 * sc); };
  waders.onFlush = (w, d) => { game.bounties.event('flush', 1); if (Math.random() < 0.5) audio.squawk(0.25 * Math.max(0, 1 - d / 40)); };
  const environment = new Environment({ scene, fxScene, camera, terrain, world, water, sky, sun, hemi, pipeline, wind, boat: boat.group, audio, game, phys, sunDir: SUN_DIR });
  life.traffic.environment = environment;
  const currents = new CurrentField({ fxScene, terrain, water, environment, phys, game });
  environment.currentField = currents; life.currents = currents; life.fx.currents = currents; world.currents = currents; world.fx.currents = currents; skiff.currents = currents;
  const reputation = new Reputation({ game, environment, audio }); game.reputation = reputation;
  const regions = new RegionDirector({ game, phys }); game.regions = regions;
  const law = new Law({ game, phys, environment, audio }); game.law = law;
  life.traffic.reputation = reputation; life.traffic.law = law;
  const encounters = new EncounterDirector({ scene, terrain, world, water, phys, boat: boat.group, game, audio, environment, currents, regions, plume, spray, law, reputation });
  game.encounters = encounters;
  law.onAttention = attention => { encounters.requestPatrol(attention); };
  const condition = new BoatCondition({ game, phys, water, environment, audio, boat: boat.group, plume, spray, startX, startZ }); condition.traffic = life.traffic; encounters.condition = condition; game.condition = condition;
  const hazards = new StormHazards({ scene, terrain, world, water, phys, game, audio, environment, currents, condition, plume, spray });
  environment.onLightning = strike => hazards.lightning(strike);
  const ecology = new Ecology({ environment, birds, waders, manatees, gators, life, world, regions, water, plume, spray, game, audio });
  const radio = new RadioDirector({ game, audio, environment, regions, encounters, law, reputation, condition, phys });
  ecology.radio = radio;
  condition.radio = radio; life.traffic.radio = radio;
  const incidents = new WorldIncidents({ scene, terrain, world, water, phys, game, audio, environment, currents, regions, radio, law, reputation, condition, encounters });
  const story = new StoryDirector({ scene, terrain, world, water, phys, boat: boat.group, game, audio, environment, currents, regions, radio, law, reputation, condition, encounters, incidents, hazards });
  game.incidents = incidents; game.story = story; radio.incidents = incidents; radio.story = story;
  const aftermath = new StormRecovery({ scene, terrain, world, water, phys, boat: boat.group, game, audio, environment, currents, incidents, encounters, story, radio, reputation, condition });
  game.aftermath = aftermath; radio.aftermath = aftermath;
  const debugSceneGraphStats = import.meta.env.DEV ? () => {
    const geometries = new Set(), materials = new Set(), textures = new Set(), roots = [scene, water.scene, fxScene]; let objects = 0;
    const addMaterial = material => {
      if (!material || materials.has(material)) return; materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      if (material.uniforms) for (const uniform of Object.values(material.uniforms)) if (uniform?.value?.isTexture) textures.add(uniform.value);
    };
    for (const root of roots) root.traverse(object => {
      objects++; if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) for (const material of object.material) addMaterial(material); else addMaterial(object.material);
    });
    return { objects, geometries: geometries.size, materials: materials.size, textures: textures.size };
  } : null;
  const debugTreeResources = import.meta.env.DEV ? roots => {
    const geometries = new Set(), materials = new Set(); let objects = 0;
    for (const root of roots) root?.traverse?.(object => {
      objects++; if (object.geometry) geometries.add(object.geometry);
      if (Array.isArray(object.material)) for (const material of object.material) materials.add(material); else if (object.material) materials.add(object.material);
    });
    return { roots: roots.length, objects, geometries: geometries.size, materials: materials.size };
  } : null;
  const debugResourceSnapshot = import.meta.env.DEV ? () => ({
    renderer: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length },
    graph: debugSceneGraphStats(),
    terrain: terrain.memoryStats(),
    minimap: minimap.memoryStats(),
    wildlife: {
      waders: debugTreeResources(waders.list.map(w => w.mesh)),
      manatees: debugTreeResources(manatees.list.map(m => m.mesh)),
      gators: debugTreeResources(gators.list.map(g => g.mesh)),
    },
    stormRecovery: { sites: aftermath.sites.length, rigs: aftermath.rigs.size, disposed: { ...aftermath.disposedResources } },
    livingWorld: {
      debris: { live: life.debris.live.size, cachedCells: life.debris.cells.size, cacheEvictions: life.debris.cacheEvictions },
      anchoredAnglers: { live: life.traffic.liveAnglers.size, cachedCells: life.traffic.anglerCells.size, cacheEvictions: life.traffic.anglerCacheEvictions },
      shoreFolk: { live: life.folk.live.size, cachedCells: life.folk.cells.size, cacheEvictions: life.folk.cacheEvictions, disposedLineGeometries: life.folk.disposedLineGeometries },
      fishFallbackReleased: life.fish.fallbackReleased,
    },
    chart: worldMap.memoryStats(),
  }) : null;
  window.__dbg = { renderer, camera, scene, terrain, phys, water, pipeline, sky, veg, boat, spray, plume, game, tricks, gators, skiff, waders, manatees, world, worldMap, life, birds, environment, currents, regions, encounters, incidents, story, contracts: story.contracts, aftermath, condition, ecology, reputation, law, hazards, radio, startup, debugSceneGraphStats, debugResourceSnapshot, mode: 'full', renderQuality: () => ({
    profile: renderProfile.id, preference: qualityPreference, pixelRatio: renderer.getPixelRatio(), maxDrawPixels: renderProfile.maxDrawPixels, cinematicMaxDrawPixels: MAX_DRAW_PIXELS,
    adaptive: qualityController.snapshot(), ...pipeline.memoryStats(), reflection: water.memoryStats(), estimatedShadowBytes: renderProfile.shadowMapSize ** 2 * 4,
  }) };

  // ---- input ----
  const keys = {};
  let started = false;
  let encounterStressRunning = false;
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (import.meta.env.DEV && e.code === 'F9' && e.shiftKey && !e.repeat) {
      e.preventDefault(); story.resetDebug(); if (encounters.active) encounters.finish(false, true); encounters.next = 999; return;
    }
    if (import.meta.env.DEV && e.code === 'F7' && !e.repeat) {
      e.preventDefault(); if (encounterStressRunning) return; encounterStressRunning = true;
      const types = ['distress', 'airrescue', 'grounding', 'fire', 'manatee', 'spotlight', 'race', 'patrol', 'salvage', 'smuggler', 'netline'], before = debugSceneGraphStats();
      let iteration = 0, started = 0;
      const rotate = () => {
        const end = Math.min(6000, iteration + 240);
        for (; iteration < end; iteration++) if (encounters.start(types[iteration % types.length], true)) started++;
        if (encounters.active) encounters.finish(false, true);
        if (iteration < 6000) { requestAnimationFrame(rotate); return; }
        const result = { iterations: 6000, started, before, after: debugSceneGraphStats(), active: encounters.active, renderer: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs.length } };
        document.documentElement.dataset.emeraldEncounterStress = JSON.stringify(result); console.info('[emerald-encounter-stress]', JSON.stringify(result)); encounterStressRunning = false;
      };
      requestAnimationFrame(rotate);
    }
    if (import.meta.env.DEV && e.code === 'F8' && !e.repeat) {
      e.preventDefault(); const memory = renderer.info.memory, quality = window.__dbg.renderQuality(); const snapshot = debugResourceSnapshot();
      document.documentElement.dataset.emeraldResource = JSON.stringify(snapshot);
      console.info('[emerald-resource]', JSON.stringify({ geometries: memory.geometries, textures: memory.textures, programs: renderer.info.programs.length, sceneChildren: scene.children.length, graph: snapshot.graph, terrain: snapshot.terrain, minimap: snapshot.minimap, wildlife: snapshot.wildlife, chart: snapshot.chart, fireOuterInstances: encounters.rigs.fire.fire.userData.fire.outer.count, fireCoreInstances: encounters.rigs.fire.fire.userData.fire.core.count, ...quality }));
    }
    if (started && e.code === 'KeyR' && !game.menuOpen && !game.resultOpen && !(game.state && game.state.m.countdown)) phys.reset(phys.lastFloat.x, phys.lastFloat.y);
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  let dragging = false, camYaw = 0, camPitch = 0, lastX = 0, lastY = 0, idle = 0, camDist = 8.2;
  renderer.domElement.addEventListener('mousedown', e => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
  window.addEventListener('mouseup', () => { dragging = false; idle = 0; });
  window.addEventListener('mousemove', e => {
    if (!dragging) return;
    camYaw -= (e.clientX - lastX) * 0.005; camPitch += (e.clientY - lastY) * 0.003;
    camPitch = Math.max(-0.25, Math.min(0.6, camPitch));
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('wheel', e => { camDist = Math.max(5, Math.min(20, camDist + e.deltaY * 0.01)); });
  let resizeTimer = 0;
  const resize = () => {
    renderer.setPixelRatio(pixelRatioFor(window.innerWidth, window.innerHeight, window.devicePixelRatio, renderProfile.maxDrawPixels, renderProfile.maxDevicePixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix();
    const s = new THREE.Vector2(); renderer.getDrawingBufferSize(s);
    pipeline.resize(s.x, s.y); water.resize(s.x, s.y); plume.mat.uniforms.resolution.value.set(s.x, s.y);
    qualityController.reset();
  };
  let renderFrameNo = 0;
  const applyRenderQuality = profile => {
    renderProfile = profile; pipeline.setQuality(profile); water.setQuality(profile);
    if (sun.shadow.mapSize.x !== profile.shadowMapSize) {
      sun.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
      if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
      water.uniforms.shadowOn.value = 0;
    }
    renderFrameNo = 0; resize();
  };
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = window.setTimeout(resize, 120); });
  const startEl = document.getElementById('start');
  const titlePrimary = document.getElementById('titlePrimary');
  const titleNew = document.getElementById('titleNew');
  const cashLabel = value => '$' + Math.round(value).toLocaleString('en-US');
  const renderTitle = () => {
    const progress = game.hasProgress(), region = regionAt(phys.pos.x, phys.pos.y), resetArmed = game.newGameArmed();
    titlePrimary.querySelector('.action-name').textContent = progress ? 'Continue' : 'Ride out';
    document.getElementById('titleContinueDetail').textContent = game.state
      ? `${game.state.m.title} paused · ${region.name}`
      : `${region.name} · day ${environment.day}, ${environment.clockLabel()} · ${cashLabel(game.save.cash)}`;
    document.getElementById('titleJobsDetail').textContent = `${game.save.done.length} / ${game.missions.length} jobs finished · ${game.story?.menuLine() || 'Running Dark not started'}`;
    document.getElementById('titleGraphicsDetail').textContent = qualityPreferenceLabel(qualityPreference, renderProfile.id);
    document.getElementById('titleWorldDetail').textContent = `Day ${environment.day} · ${environment.weatherLabel()} · ${environment.tideLabel()}`;
    titleNew.hidden = !progress;
    titleNew.classList.toggle('danger', resetArmed);
    titleNew.querySelector('.action-name').textContent = resetArmed ? 'Confirm new game' : 'New game';
    titleNew.querySelector('.action-detail').textContent = resetArmed ? 'Select again now to clear jobs, cash, records and world history' : 'Clear this hull and return to the tower dock';
  };
  const cycleRenderQuality = () => {
    qualityPreference = writeQualityPreference(nextQualityPreference(qualityPreference));
    const profile = qualityController.configure(qualityControllerConfig(qualityPreference, hardwareQualityLevel));
    applyRenderQuality(profile); renderTitle();
    if (started && !game.menuOpen) game.toast('Graphics changed', qualityPreferenceLabel(qualityPreference, profile.id), 1.8);
    return profile;
  };
  const beginGame = (jobs = false) => {
    audio.start(); started = true; game.playing = true; game.paused = false;
    startEl.classList.add('hidden'); startEl.setAttribute('aria-hidden', 'true');
    if (jobs) game.openMenu('jobs');
  };
  const showTitle = (persist = true) => {
    game.closeMap(); game.closeMenu(); game.closeResult();
    started = false; game.playing = false; game.paused = true;
    for (const key in keys) keys[key] = false;
    if (persist) game.persist();
    renderTitle(); startEl.classList.remove('hidden'); startEl.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => titlePrimary.focus({ preventScroll: true }));
  };
  game.getQualityLabel = () => qualityPreferenceLabel(qualityPreference, renderProfile.id);
  game.getWorldLabel = () => `Day ${environment.day} · ${environment.clockLabel()} · ${environment.weatherLabel()} · ${environment.tideLabel()}`;
  game.getWorldShortLabel = () => regionAt(phys.pos.x, phys.pos.y).name;
  game.onCycleQuality = cycleRenderQuality;
  game.onReturnToTitle = () => showTitle(true);
  game.onResetArmed = renderTitle;
  startEl.addEventListener('click', event => {
    const button = event.target.closest('[data-title-action]'); if (!button) return;
    const action = button.dataset.titleAction;
    if (action === 'continue') beginGame(false);
    else if (action === 'jobs') beginGame(true);
    else if (action === 'graphics') cycleRenderQuality();
    else if (action === 'new') game.requestNewGame();
  });

  // ---- camera state ----
  const camPos = new THREE.Vector3(startX, 4, startZ + 10);
  const camTarget = new THREE.Vector3(startX, 1, startZ);
  const camBack = new THREE.Vector3(), camDesired = new THREE.Vector3(), camAim = new THREE.Vector3();
  const fwd2 = new THREE.Vector2(), rgt2 = new THREE.Vector2(), currentFlow = new THREE.Vector2();
  const input = { throttle: 0, steer: 0, pitch: 0 };
  const clock = new THREE.Timer(); clock.connect(document);
  let time = 0, splashStamp = 0, slowT = 0, slowK = 1, fovKick = 0, airCam = 0, frameNo = 0;
  const stamps = [];
  const hullPoint = { x: 0, z: 0 };
  const splashPts = [{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }];
  const playerStampPool = Array.from({ length: 10 }, () => ({ x: 0, z: 0, radius: 0, height: 0, foam: 0, foamRadius: 0 }));
  let playerStampCount = 0;
  const hullPt = (px, pz, out = hullPoint) => {
    out.x = phys.pos.x + rgt2.x * px + fwd2.x * -pz;
    out.z = phys.pos.y + rgt2.y * px + fwd2.y * -pz;
    return out;
  };
  const addPlayerStamp = (p, radius, height, foam = 0, foamRadius = 0) => {
    const s = playerStampPool[playerStampCount++];
    s.x = p.x; s.z = p.z; s.radius = radius; s.height = height; s.foam = foam; s.foamRadius = foamRadius;
    stamps.push(s);
  };
  // landing splash: the hull slaps a hull-shaped hole in the water; two sheets peel off the chines, a crown lifts at the bow,
  // and a stuffed bow throws a wall of water forward over the deck
  function landingSplash(impact, quality) {
    const s = Math.min(3, impact / 3.5);
    const spd = Math.min(1, phys.speed / 12);
    const along = (a, b) => a + Math.random() * (b - a);
    const sheets = Math.floor(90 + s * 120);
    for (let i = 0; i < sheets; i++) {
      const side = Math.random() < 0.5 ? -1 : 1; const z = along(-2.6, 2.2); const p0 = hullPt(side * 1.2, z);
      const out = (1.5 + Math.random() * 3.5) * (0.6 + s * 0.5); const up = (1.2 + Math.random() * 3.0) * (0.5 + s * 0.6);
      plume.emit(p0.x, 0.08, p0.z, rgt2.x * side * out + phys.vel.x * 0.35 + jitter() * 0.6, up, rgt2.y * side * out + phys.vel.y * 0.35 + jitter() * 0.6,
        0.3 + Math.random() * 0.45 * s, 1.3 + s * 0.6, 0.7 + Math.random() * 0.7, 0.35 + 0.15 * s);
      spray.emit(p0.x, 0.05, p0.z, rgt2.x * side * out * 1.6 + phys.vel.x * 0.5, up * 1.5, rgt2.y * side * out * 1.6 + phys.vel.y * 0.5, 0.018 + Math.random() * 0.045, 0.5 + Math.random() * 0.6, 0.75);
    }
    // bow crown
    const crown = Math.floor(30 + s * 50);
    for (let i = 0; i < crown; i++) {
      const p0 = hullPt(jitter() * 1.6, -2.4 + Math.random() * 1.2);
      plume.emit(p0.x, 0.1, p0.z, phys.vel.x * 0.55 + fwd2.x * (1 + s) + jitter() * 1.5, 2.0 + Math.random() * 3.5 * (0.5 + s * 0.5), phys.vel.y * 0.55 + fwd2.y * (1 + s) + jitter() * 1.5,
        0.35 + Math.random() * 0.5, 1.4, 0.9 + Math.random() * 0.6, 0.4);
    }
    // stern slap column
    for (let i = 0; i < 20 + s * 25; i++) {
      const p0 = hullPt(jitter() * 2.0, 1.5 + Math.random() * 1.5);
      plume.emit(p0.x, 0.1, p0.z, -fwd2.x * (1 + Math.random() * 2) + jitter(), 1.5 + Math.random() * 3 * s, -fwd2.y * (1 + Math.random() * 2) + jitter(), 0.4 + Math.random() * 0.4, 1.2, 0.8 + Math.random() * 0.5, 0.35);
    }
    if (quality === 'stuffed' || quality === 'wipeout') {
      // wall of water thrown forward and over the deck
      const n = 140 + s * 60;
      for (let i = 0; i < n; i++) {
        const p0 = hullPt(jitter() * 2.2, -2.9 + Math.random() * 1.0);
        const fwdV = 2 + Math.random() * 5 + spd * 4;
        plume.emit(p0.x, 0.1, p0.z, fwd2.x * fwdV + jitter() * 2.0, 2.5 + Math.random() * 4.5, fwd2.y * fwdV + jitter() * 2.0, 0.45 + Math.random() * 0.6, 1.6, 1.0 + Math.random() * 0.7, 0.5);
        spray.emit(p0.x, 0.2, p0.z, fwd2.x * fwdV * 0.5 + jitter() * 3, 3 + Math.random() * 5, fwd2.y * fwdV * 0.5 + jitter() * 3, 0.02 + Math.random() * 0.05, 0.6 + Math.random() * 0.6, 0.8);
      }
    }
    hullPt(0, -2.2, splashPts[0]); hullPt(0, 0, splashPts[1]); hullPt(0, 2, splashPts[2]);
    splashStamp = Math.min(3.2, impact / 2.5) * (quality === 'stuffed' || quality === 'wipeout' ? 1.4 : 1);
  }
  const jitter = () => (Math.random() - 0.5);
  const wakeCenter = new THREE.Vector2();

  function frame() {
    clock.update();
    const frameDelta = clock.getDelta();
    const dtRaw = Math.min(frameDelta, 0.05);
    const qualityChange = qualityController.observe(frameDelta, started && !game.paused && !document.hidden);
    if (qualityChange) {
      applyRenderQuality(qualityChange.profile);
      game.toast('Rendering adjusted', `${qualityChange.profile.label} water, lighting and post effects`, 2.8);
    }
    if (slowT > 0) slowT -= dtRaw;
    const dt = dtRaw * (slowT > 0 ? slowK : 1);
    time += dt;
    // input
    input.throttle = 0; input.steer = 0; input.pitch = 0;
    const locked = !started || game.paused || game.inputLock;
    if (!locked) {
      if (keys.KeyW || keys.ArrowUp) input.throttle = 1;
      if (keys.KeyS || keys.ArrowDown) input.throttle = -0.35;
      if (keys.KeyA || keys.ArrowLeft) input.steer += 1;
      if (keys.KeyD || keys.ArrowRight) input.steer -= 1;
      input.pitch = ((keys.KeyS || keys.ArrowDown) ? 1 : 0) - ((keys.ShiftLeft || keys.ShiftRight) ? 1 : 0); // in the air: S leans back (nose up), Shift leans forward
    }

    if (started && !game.paused) {
      currents.flowAt(phys.pos.x, phys.pos.y, currentFlow);
      phys.update(dt, input, playerWater, time, currentFlow);
    }
    else { phys.impact = 0; phys.hit = 0; phys.landedFrame = false; }
    environment.applyPhysics(dt);
    phys.forward(fwd2); phys.right(rgt2);
    tricks.update(dt, time);
    game.update(dt, time);
    story.update(dt, time, started && !game.paused && !life.traffic.activeCollision());
    encounters.update(dt, time, started && !story.blocking() && !aftermath.blocking() && !life.traffic.activeCollision());
    condition.update(dt, time, started);
    law.update(dt, started && !game.paused);
    reputation.update(dt, started && !game.paused);
    regions.update(dt, started && !game.paused);
    // impacts: splash / thud / camera shake / slow-mo
    if (phys.impact > 1.2) {
      const q = phys.landQuality;
      if (phys.wet > 0.25) { audio.splash(Math.min(2.4, phys.impact / 3), q === 'stuffed' || q === 'wipeout'); landingSplash(phys.impact, q); }
      else audio.thud(Math.min(1.5, phys.impact / 4));
      fovKick = Math.min(14, fovKick + phys.impact * 1.1);
      if (q === 'wipeout') { slowT = 1.0; slowK = 0.32; }
      else if (q === 'stuffed') { slowT = 0.7; slowK = 0.4; }
      else if (q === 'clean' && phys.airTime > 1.2) { slowT = 0.28; slowK = 0.5; }
    }
    if (phys.takeoffFrame && phys.speed > 6 && phys.wet < 0.5) {
      // sheet of water leaving the lip with the hull
      for (let i = 0; i < 40; i++) { const p0 = hullPt(jitter() * 2.4, 1.6 + Math.random() * 1.4); plume.emit(p0.x, 0.1, p0.z, phys.vel.x * 0.5 + jitter() * 1.5, 1.5 + Math.random() * 2.5, phys.vel.y * 0.5 + jitter() * 1.5, 0.3 + Math.random() * 0.4, 1.1, 0.7 + Math.random() * 0.5, 0.3); }
    }
    if (phys.hit > 3) {
      audio.thud(Math.min(1.5, phys.hit / 6)); fovKick = Math.min(14, fovKick + phys.hit * 0.6);
      if (phys.hit > 6 && slowT <= 0) { slowT = 0.22; slowK = 0.35; } // hit-stop on a real crash
      // bark and leaf litter knocked loose, plus the water thrown up by the hull slewing sideways
      const nx = phys.hitNormal.x, nz = phys.hitNormal.y; const n = Math.floor(10 + phys.hit * 4);
      for (let i = 0; i < n; i++) plume.emit(phys.pos.x - nx * 1.6 + jitter() * 1.2, 0.3 + Math.random() * 1.2, phys.pos.y - nz * 1.6 + jitter() * 1.2, nx * (1 + Math.random() * 2) + jitter() * 2, 0.5 + Math.random() * 2, nz * (1 + Math.random() * 2) + jitter() * 2, 0.2 + Math.random() * 0.3, 0.9, 0.5 + Math.random() * 0.4, 0.28);
      if (phys.wet > 0.3) for (let i = 0; i < n * 3; i++) spray.emit(phys.pos.x + jitter() * 2.4, 0.05, phys.pos.y + jitter() * 2.4, nx * (2 + Math.random() * 4) + jitter() * 3, 1 + Math.random() * 3, nz * (2 + Math.random() * 4) + jitter() * 3, 0.015 + Math.random() * 0.03, 0.4 + Math.random() * 0.4, 0.6);
    }

    // boat transform
    const g = boat.group;
    g.position.set(phys.pos.x, phys.y - 0.32, phys.pos.y);
    g.rotation.set(phys.pitch, phys.heading, phys.roll, 'YXZ');
    if (phys.rpm > 0.01) boat.prop.rotation.z += dt * (8 + phys.rpm * 95);
    boat.blur.material.opacity = Math.min(0.35, phys.rpm * 0.4);
    for (const r of boat.rudders) r.rotation.y = -phys.steer * 0.55;
    condition.updateEffects(dt, time, started && !game.paused);

    // camera
    if (!dragging) { idle += dt; if (idle > 2.5) { camYaw *= Math.exp(-dt * 1.2); camPitch *= Math.exp(-dt * 1.2); } }
    const yaw = phys.heading + camYaw;
    camBack.set(Math.sin(yaw), 0, Math.cos(yaw));
    // in the air the camera hangs back and rises so the ground stays in frame for the landing
    airCam += ((phys.airborne ? Math.min(1, phys.airTime * 1.5) : 0) - airCam) * (1 - Math.exp(-dt * (phys.airborne ? 3 : 5)));
    const cd = camDist + airCam * 2.4;
    camDesired.set(phys.pos.x, 3.9 + cd * Math.sin(camPitch) * 1.2 + Math.max(0, phys.y) * 0.2 + airCam * 1.2, phys.pos.y).addScaledVector(camBack, cd * Math.cos(camPitch));
    // keep camera above ground / water
    const gh = terrain.heightAt(camDesired.x, camDesired.z);
    camDesired.y = Math.max(camDesired.y, gh + 1.8, 1.2);
    camPos.lerp(camDesired, 1 - Math.exp(-dt * 5.5));
    camAim.set(phys.pos.x - fwd2.x * -4.5, 1.2 + Math.max(0, phys.y) * 0.9, phys.pos.y - fwd2.y * -4.5);
    camTarget.lerp(camAim, 1 - Math.exp(-dt * 7));
    camera.position.copy(camPos);
    if (game.shake > 0.01) { const sh = game.shake * 0.35; camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh; camera.position.z += (Math.random() - 0.5) * sh; }
    camera.lookAt(camTarget);
    if (window.__dbg.freeCam) { const fc = window.__dbg.freeCam; camera.position.set(fc.x, fc.y, fc.z); camera.lookAt(fc.tx, fc.ty, fc.tz); } // dev: park the camera anywhere
    if (game.shake > 0.01) camera.rotateZ((Math.random() - 0.5) * game.shake * 0.04);
    fovKick *= Math.exp(-dtRaw * 5);
    { const f = 52 + fovKick + airCam * 4; if (Math.abs(camera.fov - f) > 0.01) { camera.fov = f; camera.updateProjectionMatrix(); } }
    camera.updateMatrixWorld();

    // Time, tide and weather own the sky, light, wind and water state. The camera is already settled for this frame,
    // so rain and lightning follow it without the one-frame wobble that shows up at speed.
    environment.update(dtRaw, time, camera.position, game.paused || !started);
    currents.update(dtRaw, time, started && !game.paused);
    hazards.update(dtRaw, time, started && !game.paused);
    aftermath.update(dtRaw, time, started && !game.paused);
    ecology.update(dtRaw, time, started && !game.paused);
    incidents.update(dtRaw, time, started && !game.paused && !story.blocking() && !aftermath.blocking() && !life.traffic.activeCollision());
    radio.update(dtRaw, started && !game.paused);

    // world updates
    sky.update(time, camera.position);
    terrain.update(time, camera.position);
    veg.update(time, environment.lightDir, wind);
    birds.update(time, camera.position, dt);
    manatees.update(dt, time, phys.pos.x, phys.pos.y);
    gators.update(dt, time, phys.pos.x, phys.pos.y, phys.speed);
    waders.update(dt, time, phys.pos.x, phys.pos.y, phys.speed);
    world.update(dt, time, phys.pos.x, phys.pos.y);
    // Do not start resident shifts or write their first-seen state while the title card is still open.
    if (started && !game.paused) life.update(dt, time);
    {
      const ambientBoat = Math.max(life.obLevel, world.obLevel); let outboardLevel = ambientBoat, outboardPitch = life.obPitch;
      if (incidents.obLevel > outboardLevel) { outboardLevel = incidents.obLevel; outboardPitch = incidents.obPitch; }
      if (story.obLevel > outboardLevel) { outboardLevel = story.obLevel; outboardPitch = story.obPitch; }
      if (aftermath.obLevel > outboardLevel) { outboardLevel = aftermath.obLevel; outboardPitch = aftermath.obPitch; }
      audio.outboard(outboardLevel, outboardPitch);
    }
    audio.truck(world.truckLevel);
    water.updateMurk(terrain, camera.position);
    if (worldMap.open && (frameNo++ & 3) === 0) worldMap.render();
    water.update(time);
    water.mesh.position.set(Math.round(camera.position.x / 50) * 50, water.level, Math.round(camera.position.z / 50) * 50);

    // wake stamps
    stamps.length = 0; playerStampCount = 0;
    const wet = phys.wet;
    const sp = phys.speed * wet, rpm = phys.rpm, thr = Math.max(0, phys.throttle) * wet;
    const spF = Math.min(sp / 12, 1);
    if (splashStamp > 0) { for (const p of splashPts) addPlayerStamp(p, 1.6 + splashStamp * 0.45, -2.2 * splashStamp, 2.4 * splashStamp, 2.2 + splashStamp * 0.6); splashStamp = 0; }
    // rates are per second (simulate() scales by dt)
    let pt = hullPt(0, -2.7); addPlayerStamp(pt, 1.3, -1.4 * spF, 0.12 * spF, 0.9);
    pt = hullPt(0, -1.2); addPlayerStamp(pt, 1.5, -0.6 * spF);
    pt = hullPt(1.0, 0.8); addPlayerStamp(pt, 0.9, 0.35 * spF, 0.35 * spF, 0.8);
    pt = hullPt(-1.0, 0.8); addPlayerStamp(pt, 0.9, 0.35 * spF, 0.35 * spF, 0.8);
    pt = hullPt(0, 2.6); addPlayerStamp(pt, 1.5, 0.9 * spF + 0.3 * thr, 0.9 * spF + 2.2 * thr * (0.3 + spF), 1.25);
    pt = hullPt(0, 4.3); addPlayerStamp(pt, 2, 0, 1.3 * thr * (0.3 + spF), 1.7);
    pt = hullPt(0, 6.5); addPlayerStamp(pt, 2.4, 0, 0.5 * thr * spF, 2.2);
    skiff.stamps(stamps); life.stamps(stamps); world.stamps(stamps); encounters.stamps(stamps); incidents.stamps(stamps); story.stamps(stamps); aftermath.stamps(stamps); hazards.stamps(stamps);
    wakeCenter.set(phys.pos.x + fwd2.x * -25, phys.pos.y + fwd2.y * -25);
    water.simulate(wakeCenter, stamps, dt, currentFlow);

    // ---- spray ----
    // sun direction in view space drives the lighting of droplets / plume
    sunView.copy(environment.lightDir).transformDirection(camera.matrixWorldInverse);
    spray.mat.uniforms.sunView.value.copy(sunView); plume.mat.uniforms.sunView.value.copy(sunView);
    const washF = Math.max(0, rpm - 0.2) * wet; // prop wash strength (0 at idle, nothing to blow when out of the water)
    camVel.subVectors(camera.position, camPrev).multiplyScalar(1 / Math.max(dt, 1e-3)); camPrev.copy(camera.position);
    plume.mat.uniforms.camVel.value.copy(camVel);
    // (a) prop-wash sheet: a low, wide fan of vapour blasted off the surface just behind the transom
    {
      const n = Math.floor(washF * (0.35 + spF) * 380 * dt + Math.random());
      for (let i = 0; i < n; i++) {
        const lat = jitter() * 2.4; const p0 = hullPt(lat, 2.7 + Math.random() * 1.4);
        const back = 1.0 + Math.random() * 3.0 * (0.3 + spF);
        plume.emit(p0.x, 0.1 + Math.random() * 0.35, p0.z,
          -fwd2.x * back + rgt2.x * lat * (1.4 + spF) + jitter() * 0.8, 0.4 + Math.random() * 1.2 * (0.5 + spF), -fwd2.y * back + rgt2.y * lat * (1.4 + spF) + jitter() * 0.8,
          0.28 + Math.random() * 0.35, 0.7 + Math.random() * 0.7, 0.55 + Math.random() * 0.6, 0.16 + 0.12 * spF);
      }
    }
    // (b) rooster tail: at speed the wash lifts a plume 1-4 m behind the transom
    if (sp > 3) {
      const n = Math.floor(spF * spF * washF * 200 * dt + Math.random());
      for (let i = 0; i < n; i++) {
        const lat = jitter() * 1.4; const p0 = hullPt(lat, 3.4 + Math.random() * 2.6);
        const back = 0.5 + Math.random() * 1.5;
        plume.emit(p0.x, 0.2 + Math.random() * 0.8, p0.z,
          -fwd2.x * back + rgt2.x * lat * 0.8 + jitter() * 0.8, 1.2 + Math.random() * 2.4 * spF, -fwd2.y * back + rgt2.y * lat * 0.8 + jitter() * 0.8,
          0.35 + Math.random() * 0.4, 0.8 + Math.random() * 0.8, 0.7 + Math.random() * 0.6, 0.14 + 0.12 * spF);
      }
    }
    // (c) chine sheets: thin fans of water peeling off the bow chines, travelling with the boat
    if (sp > 4.5) {
      const n = Math.floor((spF - 0.3) * 300 * dt + Math.random());
      for (let i = 0; i < n; i++) {
        const side = Math.random() < 0.5 ? -1 : 1; const p0 = hullPt(side * 1.25, -2.4 + Math.random() * 2.4);
        const out = 1.5 + Math.random() * 2.6 * spF;
        plume.emit(p0.x, 0.05 + Math.random() * 0.15, p0.z,
          rgt2.x * side * out + phys.vel.x * 0.5 + jitter() * 0.5, 0.7 + Math.random() * 1.6 * spF, rgt2.y * side * out + phys.vel.y * 0.5 + jitter() * 0.5,
          0.14 + Math.random() * 0.18, 0.7 + Math.random() * 0.6, 0.35 + Math.random() * 0.35, 0.22);
      }
      const m = Math.floor(spF * 2200 * dt + Math.random());
      for (let i = 0; i < m; i++) {
        const side = Math.random() < 0.5 ? -1 : 1; const p0 = hullPt(side * 1.15, -2.2 + Math.random() * 2.5);
        spray.emit(p0.x, 0.02 + Math.random() * 0.12, p0.z, rgt2.x * side * (1.0 + Math.random() * 2.2) + phys.vel.x * 0.5, 0.6 + Math.random() * 1.6, rgt2.y * side * (1.0 + Math.random() * 2.2) + phys.vel.y * 0.5, 0.012 + Math.random() * 0.03, 0.3 + Math.random() * 0.35, 0.55);
      }
    }
    // (d) droplets thrown back by the wash (the glittery part of the spray)
    {
      const n = Math.floor(washF * (0.25 + spF) * 5200 * dt + Math.random());
      for (let i = 0; i < n; i++) {
        const lat = jitter() * 2.2; const p0 = hullPt(lat, 2.4 + Math.random() * 1.4);
        const back = 1.5 + Math.random() * 6.0 * (0.3 + spF);
        spray.emit(p0.x, 0.02 + Math.random() * 0.3, p0.z,
          -fwd2.x * back + rgt2.x * lat * 1.4 + jitter() * 1.2 + phys.vel.x * 0.1, 0.6 + Math.random() * 2.4 * (0.4 + spF), -fwd2.y * back + rgt2.y * lat * 1.4 + jitter() * 1.2 + phys.vel.y * 0.1,
          0.012 + Math.random() * 0.035, 0.4 + Math.random() * 0.6, 0.5);
      }
    }
    // (e) the poachers' outboard throws its own small rooster tail
    if (skiff.active && skiff.speed > 3) {
      const sf = skiff.forward(); const n = Math.floor(90 * dt * Math.min(1, skiff.speed / 11) + Math.random());
      for (let i = 0; i < n; i++) plume.emit(skiff.pos.x + sf.x * 2.4 + jitter() * 0.6, 0.1, skiff.pos.y + sf.y * 2.4 + jitter() * 0.6, sf.x * (1 + Math.random()) + jitter(), 0.8 + Math.random() * 1.6, sf.y * (1 + Math.random()) + jitter(), 0.25 + Math.random() * 0.3, 0.9, 0.6 + Math.random() * 0.5, 0.3);
      for (let i = 0; i < n * 6; i++) spray.emit(skiff.pos.x + sf.x * 2.2 + jitter() * 0.8, 0.05, skiff.pos.y + sf.y * 2.2 + jitter() * 0.8, sf.x * (1 + Math.random() * 3) + jitter() * 1.5, 0.5 + Math.random() * 2, sf.y * (1 + Math.random() * 3) + jitter() * 1.5, 0.012 + Math.random() * 0.03, 0.4 + Math.random() * 0.5, 0.5);
    }
    spray.update(dt);
    plume.update(dt, time);

    audio.update(started ? phys.rpm : 0, started ? Math.max(0, phys.throttle) : 0, started ? phys.speed : 0, time);
    minimap.update(phys, yaw, game.mapMarkers);
    game.projectMarker(camera, window.innerWidth, window.innerHeight);

    // render
    if (renderFrameNo % renderProfile.reflectionInterval === 0) water.renderReflection(scene, camera);
    water.setShadow(sun);
    const mode = window.__dbg.mode;
    if (mode === 'raw') { renderer.setRenderTarget(null); renderer.render(scene, camera); }
    else pipeline.render(scene, camera, mode === 'nowater' ? [fxScene] : [water.scene, fxScene], mode);
    renderFrameNo++;
  }
  renderer.setAnimationLoop(frame);
  // Cinematic machines absorb the full shader/model warm-up behind the loading card. Lower profiles render the real
  // dock scene only and open as soon as local terrain is visible; distant terrain and optional models keep streaming.
  let warm = null;
  if (startup.warmShaders) {
    warm = new THREE.Group();
    { const nc = world.campAt(1, 1) || world.campsNear(0, 0, 5000)[0]; if (nc) { const g = world.buildCamp(nc); g.position.set(startX - nc.x, 0, startZ - 20 - nc.z); warm.add(g); } }
    for (const [i, mk] of [crabFloat(), fuelDrum(), wreck(), shack(), kayak()].entries()) { mk.position.set(startX - 6 + i * 3, 0.2, startZ - 8); warm.add(mk); }
    { const spill = encounters.spills[0], sheen = spill.mesh.clone(); spill.uniforms.uAlpha.value = 0.35; sheen.visible = true; sheen.position.set(startX + 10, 0.15, startZ - 12); sheen.scale.set(5, 1, 3.4); warm.add(sheen); }
    { const funnel = hazards.spout.group.clone(true); funnel.traverse(o => { o.visible = true; }); warm.add(funnel); for (const d of hazards.debris.slice(0, 3)) { const m = d.mesh.clone(true); m.visible = true; warm.add(m); } }
    { const rr = mulberry32(3); const hf = terrain.hf; let i = 0;
      for (const kind of ['house', 'ramp', 'boathouse', 'blind']) {
        let st = null; for (let k = 0; k < 40 && !st; k++) { const cx = (Math.floor(rr() * 20) - 10) * 800, cz = (Math.floor(rr() * 20) - 10) * 800; const r2 = mulberry32(k * 31 + i); st = pickSite(hf, 'warm', cx, cz, () => r2(), () => 5000); if (st && st.kind !== kind) st = null; }
        if (st) { const g = buildSite(st, terrain); g.position.set(startX - st.x + 20 + i * 14, 0, startZ - 40 - st.z); warm.add(g); st.colliders = []; } i++;
      }
      const warmDebris = [];
      for (let j = -4; j <= 4 && warmDebris.length < 4; j++) for (let i = -4; i <= 4 && warmDebris.length < 4; i++) {
        for (const d of life.debris.cellAt(i, j)) { warmDebris.push(d); if (warmDebris.length === 4) break; }
      }
      for (const d of warmDebris) { const m = life.debris.build(d); m.position.set(startX - 10 + Math.random() * 20, 0, startZ - 25); warm.add(m); }
      for (const b of life.traffic.boats) {
        b.mesh.visible = true; b.mesh.position.set(startX + 8, 0, startZ - 10);
        if (b.searchRig) { b.searchRig.visible = true; b.searchLight.intensity = 0.01; b.searchBeam.visible = true; b.searchBeam.position.set(startX + 8, 0.05, startZ - 10); b.searchBeam.scale.set(b.searchWidth * 0.004, b.searchLength * 0.004, 1); }
      }
      for (let k = 0; k < 6; k++) life.fish.launch(startX + k, startZ - 6, 3, 0, 0, 1, 0, true);
      { const pr = mulberry32(11); let k = 0; for (const pose of ['stand', 'sit', 'sitEdge', 'crouch']) { const pp = person(pr, { pose, rod: k % 2 === 0, gun: k === 3 }); pp.position.set(startX - 8 + k * 2, 0.4, startZ - 6); warm.add(pp); k++; } const cn = canoe(pr); cn.position.set(startX + 6, 0, startZ - 8); warm.add(cn); }
      for (const [k, name] of ['beau_boat', 'boat_dreams', 'sandbox_boat', 'realistic_alligator', 'turtle_boat'].entries()) { const m = spawn(name); m.position.set(startX - 10 + k * 5, 0.3, startZ - 16); warm.add(m); }
    }
    warm.scale.setScalar(0.004); warm.position.set(startX, 0.3, startZ - 6);
    scene.add(warm); skiff.mesh.visible = true; skiff.mesh.position.set(startX, 0, startZ - 12);
  }
  const t0 = performance.now();
  const terrainReady = new Promise(r => { const poll = () => {
    const elapsed = performance.now() - t0;
    const ready = startupTerrainReady(startup.terrainReadiness, { settled: terrain.settled(), localVisible: terrain.visibleAt(startX, startZ) });
    if ((ready && elapsed >= startup.minWaitMs) || elapsed >= startup.maxWaitMs) r(); else setTimeout(poll, 100);
  }; poll(); });
  await Promise.all([startup.blockingModels.length ? preload(startup.blockingModels) : Promise.resolve(), terrainReady]);
  if (startup.compileDelayMs) await new Promise(r => setTimeout(r, startup.compileDelayMs));
  if (warm) {
    scene.remove(warm); encounters.spills[0].uniforms.uAlpha.value = 0; window.__dbg.warmDisposedGeometries = disposeDetachedGeometries(warm, scene, water.scene, fxScene); skiff.mesh.visible = false;
    for (const b of life.traffic.boats) { b.mesh.visible = false; if (b.searchRig) { b.searchRig.visible = false; b.searchLight.intensity = 0; b.searchBeam.visible = false; b.searchBeam.scale.set(b.searchWidth, b.searchLength, 1); } }
  }
  if (import.meta.env.DEV) document.documentElement.dataset.emeraldResource = JSON.stringify(debugResourceSnapshot());
  document.getElementById('loading').remove();
  showTitle(false);
}

init().catch(e => { console.error(e); document.getElementById('loading').textContent = 'Error: ' + e.message; });
