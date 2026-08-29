# CLAUDE.md — working on Emerald Bayou

An airboat game in plain ES modules on three.js + Vite. No framework, no TypeScript, no linter. `npm test`
(plain `node --test` over `test/*.test.js`) covers the pure logic — quality profiles, startup plans, missions,
pursuit and race state, model queueing; rendering and feel are proven by running the game (`npm run dev`,
http://127.0.0.1:5173) and watching the console. Keep tested modules importable outside the browser: no
three.js or DOM at module scope in anything a test pulls in. `npm run build` must stay clean — it is what
the Pages workflow ships.

The GLB pack (150 MB) is a release asset, not in the repo. Everything still runs without it:
`src/models.js` resolves every failed load to `null` and callers fall back to procedural stand-ins.
Keep that property — model loading must never throw or leave a promise pending.

## Map of the code

Rendering / world (the hot path):

- `heightfield.js` — the terrain function. **Plain JS, no three.js import**: the main thread and the
  `terrain.worker.js` pool evaluate the same code. Never import three (or anything DOM-touching) here.
- `terrain.js` — quadtree streaming: 100 m level-0 chunks out to 3200 m tiles, 7.2 km radius. Workers return
  height/normal/biome grids; the main thread turns them into geometry inside a 4 ms/frame budget.
  Level-0 chunks keep their height grid after build (physics samples it); higher levels drop theirs.
- `vegetation.js` — per-chunk instanced foliage, built by a generator that yields per 100 m cell.
  Instances are compact attributes (float3 position, snorm16 quaternion, half-float scale/colour/crown).
- `water.js` — reflection pass, wake heightfield sim (ping-pong 512² RT), murk map, tide. `waveHeight(x,z,t)`
  is the one analytic surface: renderer, boat physics and every floating prop read the same function.
- `sky.js`, `environment.js` — procedural sky; clock, weather, lunar/tide state (persisted in the save).
- `post.js` — HDR pipeline: MSAA scene RT → composite (+water/fx overlays) → bloom → grade (fog/ACES) →
  FXAA → DoF+sharpen; bloom and the final pass switch off at the lower quality tiers (`setQuality`).
- `renderquality.js` — the quality system: `QUALITY_PROFILES` (fallback → cinematic; pixel budget, DPR cap,
  MSAA, shadow size, reflection scale/interval/mipmaps, bloom/final toggles), hardware-signal initial tier
  (`initialQualityLevel` + `gpuQualityCeiling` from the WebGL renderer string), and the runtime
  `AdaptiveQualityController` (windowed frame sampling with cooldowns). `displaysettings.js` persists the
  player's auto/pinned preference (title-screen "graphics" action, key `emeraldBayou.renderQuality`);
  `startup.js` maps the tier to a loading plan (blocking models, warm-up on/off, terrain-readiness gates).
- `particles.js` — Spray/Plume ring buffers; `models.js` — GLB cache with a deferred queue (low tiers trickle
  optional models in idle time); `textures.js` — canvas-generated textures.

Gameplay (all orchestrated from `main.js` `init()`): `game.js` (missions, save, HUD), `story.js`,
`encounters.js`, `incidents.js`, `aftermath.js`, `contracts.js` (events), `life.js` + `residents.js` +
`npc.js` (traffic), `wildlife.js`, `world.js` + `sites.js` (structures), `law.js` + `pursuit.js` (wanted
chases), `reputation.js`, `radio.js`, `condition.js`, `regions.js`, `currents.js`, `ecology.js`,
`stormline.js`/`stormhazards.js`, `wakeconduct.js` (wake-violation escalation), `discoveries.js` (rare
finds), `navigationaids.js` (channel markers), `racecourse.js` + `raceformats.js` (races).
`hud.js` is the radar; `worldmap.js` the Tab chart — both are 2D canvases fed by worker-rendered tiles.

## Invariants that are easy to break

- **Determinism**: the world is derived, not stored. Placement seeds come from world coordinates
  (`mulberry32`, `hash2`) so every LOD and every reload agree. Never seed from call order, time, or
  `Math.random()` in anything that decides *where something is*.
- **Units and frames**: metres and m/s everywhere internally; the HUD converts to mph/ft/mi at the edge.
  Game frame is bow/head toward −z. **`phys.pos` is a Vector2 whose `.y` is world Z** — the boat's height is
  `phys.y`. Many systems follow that convention; read a neighbouring call before assuming.
- **The sky draws last, pinned to the far plane** (`renderOrder = 100`, `gl_Position.z = w`, depth-tested,
  no depth write). It relies on every opaque material writing depth; it must stay in the opaque queue
  (before the transparent list). Its fragment shader is the most expensive in the frame — early-z is what
  makes it affordable.
- **Layers**: layer 1 = small foliage (grass, reeds, moss, palmetto). The main camera enables it; the
  reflection camera does not. Put anything reflection-exempt on layer 1, nothing else.
- **Frustum culling**: every instanced mesh gets an explicit `boundingSphere`. `frustumCulled = false` on a
  per-chunk mesh once cost the project 40 fps; don't do it again.
- **Wake stamps**: systems push plain `{x, z, radius, height, foam, foamRadius}` objects into the shared
  `stamps` array each frame; `water.simulate` consumes **at most 20** and the array is cleared next frame.
  Stamp heights/foam are per-second rates (the sim scales by dt). Don't retain references — the player's
  stamps come from a pool.
- **Chunk lifecycle**: `terrain.onReady` (vegetation generator, may span frames) → `onDone` (colliders
  registered) → `onDispose` (vegetation + colliders must release). Vegetation geometry shares base
  attributes across chunks — `disposeChunk` detaches them before `dispose()` so the shared buffers survive.
- **Shadow map**: rendered *inside* `water.renderReflection` (r185: a shadow pass inside a depth-texture
  target corrupts that target, and the reflection RT uses a renderbuffer). The water surface samples the
  same map, and the reflection pass itself runs every `reflectionInterval` frames at the lower quality
  tiers — so shadows update at that cadence too. Map size is a quality-profile lever — read
  `sun.shadow.mapSize`, never assume 4096.
- **Save data**: `localStorage` key `emeraldBayou.save.v2`; environment (clock/weather) piggybacks on it.
  Loads are `try`-guarded and field-filled — extend `load()`'s `fill()` when adding fields.

## Performance rules (the game targets 60 fps, fill-rate bound)

- Per-frame DOM writes go through `setHTML`/`setText` in `game.js` (write-if-changed). Never assign
  `innerHTML`/`textContent` unconditionally in a per-frame path.
- No allocation in `update()` paths: scratch vectors/matrices live on the instance (`this._v` style),
  pools are reused (stamps, particles, batches). `new THREE.*` belongs in constructors and builders.
- Spray/Plume keep a `clean` flag: a fully dead pool skips its walk and GPU uploads. Emitting clears it;
  keep that true if you touch their buffers.
- Heavy work streams: terrain finalize has a 4 ms budget, vegetation yields per cell, the radar redraws at
  30 Hz and the chart at 15 Hz (`frameNo` cadence in `main.js`). Match that pattern for new systems.
- Quality tiers own every screen-space budget: the initial tier comes from hardware signals at boot, the
  `AdaptiveQualityController` steps it at runtime after sustained missed budgets, and every change funnels
  through `applyRenderQuality`/`resize()` in `main.js` — new resolution- or tier-dependent resources must
  hook in there (and into `Pipeline.setQuality`/`Water.setQuality` if a pass can switch off). The map,
  simulation and streaming distance never change with tier. `test/renderquality.test.js` and
  `test/postquality.test.js` pin the contract.
- Shader-heavy materials set `customProgramCacheKey`; on the cinematic tier the start screen warm-up in
  `main.js` renders one of everything so programs compile behind the loading screen (lower tiers skip the
  warm-up and defer optional models instead — see `startup.js`). New always-later content should join the
  warm set.

## Debugging

`window.__dbg` exposes renderer, camera, terrain, phys, water, pipeline, game and most systems.
Useful: `__dbg.mode = 'depth'|'refl'|'raw'|'nowater'`, `__dbg.environment.setHour(17.4)`,
`__dbg.environment.minutesPerSecond = 0`, `__dbg.phys.reset(x, z, heading)`, `__dbg.freeCam = {x,y,z,tx,ty,tz}`,
`__dbg.renderQuality()` (active profile, preference, GPU string, controller snapshot, attachment estimates),
`__dbg.debugResourceSnapshot()` (memory audit). The title screen's "graphics" action cycles the quality
preference (auto → each pinned tier). Dev-only keys: F7 encounter stress loop, F8 resource snapshot log,
Shift+F9 story reset (in `main.js`); F7/F8 also cycle hour/weather via `environment.js`.
`import('/src/inspect.js')` measures a GLB for a `SPEC` entry.

Headless smoke test: Playwright + chromium with `--use-angle=swiftshader` loads the game, `#start` loses
`.hidden` when the world has settled, then click it and drive with `keyboard.down('KeyW')`. SwiftShader runs
well under real time — judge correctness by state and screenshots, not by speed.
