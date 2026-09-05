<img src="docs/screenshots/00-title.jpg" alt="Emerald Bayou" width="100%">

# Emerald Bayou

An airboat game set in the south Florida backcountry. Runs in a browser, built on three.js and Vite, with no game engine underneath it. You get a 16 mile square of streamed swamp, sixteen jobs, a radio that talks back, and weather that will ruin your afternoon.

[Play Emerald Bayou](https://vheissu.github.io/emerald-bayou/)

Everything you see is generated at runtime except a handful of GLB props. The terrain, the rivers, the sawgrass prairie, the cypress, the fish camps and the people standing on their docks are all seeded from world coordinates, so the map is the same every time you load it and none of it is stored on disk.

<table>
<tr>
<td width="50%"><img src="docs/screenshots/01-hero.jpg" alt="Home bayou at mid afternoon"></td>
<td width="50%"><img src="docs/screenshots/03-wake.jpg" alt="Running a creek at 32 mph"></td>
</tr>
<tr>
<td><img src="docs/screenshots/05-night.jpg" alt="Running the channel after dark with the spotlight on"></td>
<td><img src="docs/screenshots/07-camp.jpg" alt="A fish camp under a live oak in a squall"></td>
</tr>
</table>

## Running it

```bash
git clone git@github.com:Vheissu/emerald-bayou.git
cd emerald-bayou
npm install
npm run dev
```

Then open http://127.0.0.1:5173. Graphics starts on Auto, which caps known older or software GPUs conservatively and steps down after sustained frame pressure or repeated long stalls. Fallback, Performance, Balanced and Cinematic can also be locked from the title or pause menu. Lower profiles keep the full map and simulation while reducing render-target, reflection, shadow and post-processing cost.

`npm run build` produces a static `dist/` you can drop on any host.

### Assets

The GLB models (boats, the driver, the alligator, grass clumps, three cypress variants) aren't in the repo. They're 150 MB and one of them is over GitHub's file size limit, so they ship as a release asset instead:

```bash
curl -L https://github.com/Vheissu/emerald-bayou/releases/latest/download/emerald-bayou-models.zip -o models.zip
unzip models.zip -d public/models
```

The game runs without them. `src/models.js` catches the failed loads and falls back to procedural stand-ins, so you get a playable but noticeably worse looking swamp.

The GitHub Pages workflow downloads and verifies this archive before it builds the public game.

## Controls

| Key | |
|---|---|
| `W` / `S` | throttle and reverse |
| `A` / `D` | rudder, and spin while airborne |
| `S` / `Shift` in the air | lean back, lean forward |
| drag | look around |
| `V` | switch between chase and helm cameras |
| `E` | interact (job posts, docks, traps, field notes, aid reports) |
| `C` | cast, set the hook, and reel while held |
| `X` | reel in, cut the fishing line, or cut cage debris after the prop settles |
| `G` | set or weigh the anchor while nearly stopped |
| `M` | jobs board |
| `Tab` | chart |
| `L` | spotlight |
| `H` | horn; one prolonged blast in dense fog |
| `R` | reset the boat |
| controller `RT` / `LT` | analogue throttle and reverse |
| controller left stick | rudder; pitch and spin while airborne; click to switch camera |
| controller right stick | look; click to centre the camera |
| controller `A / Cross` | interact |
| controller `X / Square`, `B / Circle`, `Y / Triangle` | fish, alternate action or cut line/cage debris, anchor |
| controller `LB`, `RB`, View, Menu | spotlight, horn, chart, pause |

The D-pad works throughout the title and pause menus. D-pad up opens the jobs board while you are on the water. Supported controllers also rumble with hull strikes and hard landings.

## What's in it

<img src="docs/screenshots/06-jobs.jpg" alt="The jobs board" width="100%">

Sixteen jobs unlock in sequence, from a shakedown run through a manatee count, a poacher chase against an AI skiff, a night rescue and a creek gauntlet. The last three add split-gate racing, a ramp circuit and a pickup-route-dropoff relay where hard landings can throw the case back into the water. On top of that there are daily bounties, per-run records, three-way reputation between the locals, FWC and the backchannel, and a story that comes in over channel 68.

Between jobs, you can come across dead motors, FWC stops, watched packages, storm wreckage, drifting fuel drums and illegal monofilament sets. A hard strike can split a drum and leave a sheen moving with the current. It can also stop one of the resident working boats: kill the prop and hold alongside while the crew checks everyone aboard, or leave and hear your hull reported over the radio.

On calm afternoons, Big Cal may be working a nuisance gator beside his skiff while two boats form an unhelpful gallery. Idle 55–100 ft off and hold the escape cut to help him get the tape on, or put $50 on the number of fingers he finishes with. A fast closing pass, jump landing or hull contact can break his grip. The loose animal turns at the boat before it runs for deep water, while a sudden squall can scatter the scene without blaming the player.

That whole gathering borrows three skiffs, four people and the alligator already kept by the encounter director. It creates no mesh, geometry, material, texture or light. The boats use three fixed collision records, the gator uses one, and the moving animal writes into the existing wake-stamp pool.

The seven resident crews keep their own schedules, jobs and operator records. They run for shelter when the weather exceeds what their boat can carry, complain about wake over working gear and remember collisions. FWC 27 can break from patrol to answer an emergency tow call when there is a safe approach.

Those crews also watch for manatee backs and footprints. Five times a second, each skipper projects the closest approach over the next seven seconds, waits a human beat, then comes off plane and turns into the safer water. Darkness, fog and hard weather shorten the distance at which a crew notices the animal. The behaviour follows [FWC boating guidance](https://myfwc.com/education/wildlife/manatee/for-boaters/): stay at least 50 ft away, slow down and watch for footprints, backs, snouts and tails.

Resident wakes affect the rest of the swamp too. Prop wash can blow a bait school down before the player reaches it, passing hulls flush waders, nearby manatees dive, and gators leave a bank or slip under. These ambient reactions do not pay player bounties. The pass reuses the seven boats, four manatees, sixteen waders and eighteen gators already in memory, with one retained avoidance record per boat and no new render resource. [Everglades boating rules](https://www.nps.gov/ever/planyourvisit/boatingrulesregs.htm) prohibit harassing wildlife.

Surface patrols cannot see through islands. During a chase they check the waterline five times a second; an emergent bank or mangrove point breaks their view, sends them to the last reported position and changes the wanted display to FWC searching. Another patrol boat with a clear angle, or Air 2 overhead, can keep the hull identified. The check keeps one small state record and uses bounded terrain samples, with no new scene or GPU resources.

At four wanted stars, Shallow Water 4 reads the player's current course, checks a predicted intercept for depth and obstructions, then runs ahead and turns broadside. The point stays fixed, so an early turn beats the roadblock. Hold course and its hull becomes a real collision obstacle while FWC 27 and Marine 12 keep pressing and ramming. The tactic uses the third pooled patrol boat and adds no scene resources.

At five wanted stars, a sustained pursuit can bring FWC Air 2 if the wind and storm conditions are flyable. It works from positions called by surface units and its own finite view. Lose both under canopy or in fog and the helicopter circles the last fix while its searchlight sweeps; the chase can still be escaped. The response reuses the Coast Guard helicopter rig, searchlight and rotor audio, so it adds no second aircraft pool. This is based on FWC's description of its [Aviation Unit](https://myfwc.com/law-enforcement/special-programs/) patrolling large areas of land and water as an "Eye in the Sky," and its account of coordinating [air, land and sea assets](https://myfwc.com/about/inside-fwc/le/what-we-do/).

On clear, low-wind nights, dense fog can settle over the backcountry before dawn and burn off after sunrise. Visibility drops to a few hundred metres. Powerboats slow down, show their navigation lights and sound a prolonged blast while making way; every crew keeps its own signal clock.

The horn is live on `H`. It gives a short warning in clear water and a 4.5-second prolonged blast in dense fog. Nearby working boats answer from their real bearing and alter course when the signal catches them closing. Red, green and stern lights disappear outside their legal arcs, so another boat's aspect can be read at night.

The marked channels now match the radio traffic. Red aids carry even numbers, green aids carry odd numbers, and each light keeps its own flash characteristic while the float moves with chop and current. Hail, tropical weather, hurricanes and vessel strikes can leave a marker dim, dark, off station or down. Idle alongside a bad aid to report the exact fix; it stays on the working chart until FWC maintenance clears it.

The water is the part that took longest. Real reflection and refraction passes, a tannin absorption map rendered by the terrain workers so still shaded water goes black and grows duckweed, a tide that moves the shoreline about 0.4 m either way, and a wake that stamps into the surface and shoves floating debris around. Run skinny water and the hull pressure wave lifts a brown sediment plume from the bed; it spreads with speed, thickens in soft tannin backwaters and drifts with the same current as the wake. The plume uses the wake target's previously unused alpha channel and one existing trailing stamp, so it adds no texture, render target, material, geometry, scene object or draw call.

At idle, `G` drops the bow anchor. Water depth sets the amount of rode, and the hull drifts within that scope before the line comes tight. Firm mud holds best; soft muck, shell and sawgrass give sooner. Current, storm load or too much throttle can make the anchor drag while the bow swings into the load. The rode is one fixed 12-point line, reused for every drop.

Spray leaves the hull along the local water slope and settles at the current tide height. Fish jumps, gator splashes, working-boat wakes and ramp launches rise with surge too. Gusts carry droplets, mist and engine smoke downwind. These effects reuse the existing particle buffers, while the hull shares the five wave samples already used for buoyancy and attitude. Pausing stops the player and chase-skiff spray emitters.

Rain stays on the world after the curtain passes. Banks and tidal mud keep a dark wet film, while roofs, dock timber, trees and sawgrass lose roughness and catch sharper light until the sun and wind dry them. Hail melt and dense night fog can leave moisture too. The pass changes two terrain uniforms and the existing cached materials; it creates no textures, meshes, draw calls, render targets or shader programs.

Severe tropical bands can now lift loose planks and sheet metal over the channel. They move with the gusts, tumble, become solid only as they drop to cage height, then splash down and remain as floating hull hazards. Logs stay in the water. The behavior follows National Weather Service and National Hurricane Center guidance that tropical-storm and hurricane winds can turn loose outdoor material into [windborne debris](https://www.weather.gov/mhx/hurricaneprep) and [flying missiles](https://www.nhc.noaa.gov/prepare/hazards.php); the debris left obstructing shallow channels follows [NOAA's account of storm-driven marine debris](https://oceanservice.noaa.gov/facts/disaster-debris.html).

The air prop fails like an air prop. Floating deadheads hammer the hull, but standing cypress limbs and windborne debris can enter the cage, visibly wrap the prop, choke thrust and load the engine. Bring the throttle to idle and hold `X` (`B / Circle` on a controller) to cut the debris free from aboard. Pinning the throttle tightens it. The wrap is one fixed player-only line with a 768-byte position buffer that stays hidden when the cage is clear. Its stock line program is prepared behind the loading card, so the first cage strike does not compile a shader in play.

Lightning no longer fades as one unbranched line. Each strike fills a fixed 72-segment buffer with a 24-step main channel, two major forks and a bounded set of smaller branches. Three return strokes run through the same channel with dark gaps between them, relighting the sky and water each time. Thunder still arrives by distance, and a nearby strike can still damage the boat or knock out settlement power. The line geometry and its scratch buffer total 3,756 bytes. There is one draw call and no texture.

The camera now takes time to recover after looking into the sun or catching a close flash. Direct fair-weather sun, lightning and the night spotlight contract the existing grade exposure quickly; darkness returns more slowly. Cloud, rain and fog stop a hidden sun from dimming the picture. This changes the exposure uniform already in the post pass and adds no GPU resource.

The storm system still owns twelve debris bodies and 44 meshes. Sharing their immutable parts cut the pool from 44 geometries and 16 materials to six geometries and seven materials. Its seventeen wake records are reused every frame, and thunder loops the existing engine-noise sample instead of generating a new 2.8 second buffer for every strike.

World sounds follow their sources across the water. Gator bellows, bird calls, fish splashes, duck-blind shots, lightning, fires, patrol sirens and helicopters pan left or right as the camera turns. The siren and rotor beds each keep one stereo panner for their lifetime, while every compound one-shot shares a single short-lived panner. Browsers without stereo panning still get the same sounds in the centre.

A clearing squall can leave a rainbow opposite the low sun. The primary bow carries red on the outside; a faint secondary reverses the colours, with Alexander's dark band between them. It needs recent rain and a break in the cloud, then fades as the rain curtain moves off. Both arcs are drawn inside the existing sky shader and its water reflection, with no extra scene objects, textures or render targets.

Clouds now move across the ground as well as the sky. In fair and overcast daylight, broad shadows cross the water, banks and trees with the wind. They thin through a squall and disappear under the solid dark deck of a hurricane. The mask takes one sample from the 256 px noise texture already used by mist, inside the existing colour-grade pass. Performance and Fallback skip the work. It adds no scene object or render target and reuses the existing shader program and texture.

Clear, calm afternoons now put a thin refractive shimmer over distant water and low banks. It builds after solar noon and dies under overcast, rain, fog or strong wind. Depth reconstruction keeps the nearby boat and sky steady, and the effect fades through the high canopy instead of warping the whole screen. Balanced and Cinematic reuse the grade pass's depth and noise inputs. Performance and Fallback skip the lookup. No new texture, render target or scene object is allocated.

The Moon advances through a 29.531-day cycle. Its rise time, crescent or quarter terminator, moonlight and shadows all come from the same phase. New and full moons retain the strongest spring range; quarter moons soften the water and currents into a neap range. Clouds now hide the stars and Moon instead of letting either draw over the weather. One retained brightness value follows the Moon above the horizon and through the cloud deck, then drives the scene light, firefly display and visible contrast of blue-fire wakes without another frame allocation.

The renderer budgets its internal drawing buffer instead of blindly doubling every Retina dimension. Performance profiles release the full-size optional post targets, reduce reflection and shadow work, and defer optional GLB decoding until the dock scene is playable. The map, streaming distance and simulation stay unchanged while the largest HDR and depth attachments remain bounded.

The sky reflection convolution follows the same budget. Fallback, Performance, Balanced and Cinematic use 32, 64, 128 and 128 px environment maps. The map is convolved behind loading or at the title and then held through active play, because rebuilding it on an idle callback can still stop the main thread. Cinematic now retains about 2.25 MiB of half-float colour and capture depth instead of the old 9 MiB target.

Navigation aids are streamed from seeded 360 m cells and capped at 36 around the boat. Six instanced meshes draw the whole local network, including the flashing lanterns, with no per-marker light objects or model downloads. Collision objects only enter physics inside a roughly 100 m working set, and the persistent fault ledger is capped at twelve records.

Wildlife lives its own life. Alligators bask on banks and slide in when you get close, and the bull will charge an idle hull inside 16 m. Mullet jump near the boat, bait boils off the bow in the shallows, ibis and pelicans run lines low over the water, and vultures circle high. When you get more than 700 m away it all quietly relocates ahead of you.

At night, the boat spotlight can catch an alligator before the rest of it appears out of the black water. A surfaced animal facing the beam throws back a tight amber-red pair. Turn its head, let it dive, or bring in dense fog and the return goes. The eighteen gators share one fixed 36-eye instanced pool with one geometry and one material. The effect uses no point lights or textures, and their swimming height and preferred depth now move with the tide.

The same spotlight now shows the wet air it is cutting through. Clear air holds only a faint shaft. Rain and fog thicken it and shorten the usable throw, with three nested shells breaking up the cone instead of drawing a solid tube. It is one textureless 432-vertex mesh. Fallback turns it off; the other graphics profiles reuse the same 8.6 KB geometry and material.

On a moving tide, pelicans and the osprey can find a mullet school in open water. Hold 25–65 m off at idle and the bait stays up; drive through it or let your wake reach it and the birds lift while the school goes deep. The event redirects two existing bird flocks and borrows from the fixed fish and spray pools instead of creating another set of wildlife.

Bring the airboat to idle and press `C` to cast. Florida bass, bluegill and bowfin hold in the freshwater backwaters; common snook, juvenile tarpon and red drum work the mangrove and broad-river water. Depth, murk, current, time of day, tide, weather and recent prop wash all change the wait and the species on the line. During the fight, hold `C` to reel and let go when a hard run pushes the tension into the red. Every fish is measured over the gunwale, released, and written into the boat log with its region and personal best.

The habitat split follows Florida Fish and Wildlife Conservation Commission profiles for [Florida bass](https://myfwc.com/wildlifehabitats/profiles/freshwater/largemouth-bass/), [bowfin](https://myfwc.com/wildlifehabitats/profiles/freshwater/bowfin/), [snook](https://myfwc.com/wildlifehabitats/profiles/saltwater/snook/snook/), [tarpon](https://myfwc.com/wildlifehabitats/profiles/saltwater/tarpon/tarpon/) and [red drum](https://myfwc.com/wildlifehabitats/profiles/saltwater/drums/red-drum/). The release animation follows the agency’s [catch-and-release handling guidance](https://myfwc.com/fishing/freshwater/fishing-tips/): short air exposure and head-first return to the water.

Fishing owns one rod, one dynamic line buffer, one lure and one landing fish. Those resources are reused on every cast, and the recent-catch ledger stops at twelve entries.

A hooked fish can now pull a nearby swimming alligator into the fight. A hard run carries farther than a small splash; one eligible animal may turn, throw a visible wake and close on the fish. Pull it clear or press `X` to cut the line. Banks block the approach, while basking, submerged, handled and recently fed animals stay out of it. If the alligator gets there first, the fish is gone and the boat log keeps the loss.

The chase reuses the existing eighteen alligators, fish splash pool and two-slot wildlife wake budget. It adds no geometry, material, texture or draw call. The behaviour follows the National Park Service descriptions of alligators as [stealth hunters that feed in the water](https://www.nps.gov/bicy/learn/nature/american-alligators.htm) and of [fish as normal adult prey](https://www.nps.gov/guis/learn/nature/alligators.htm).

Rare field signs depend on the place and the water rather than a mission marker. Roseate spoonbills settle in Rookery Lakes around first and last light, and a real player wake reaching the bank will flush them. A tagged smalltooth sawfish moves through Mangrove Reach on a rising tide; its receiver ping closes up as the boat approaches, but the fix only resolves while the hull stays at idle distance. Falling water in Cypress Reach can uncover a logging skiff long enough to copy its builder plate.

Around dusk or dawn, a Burmese python may cross a still Cypress Reach cut. The boat has to hold 13–38 m off with an open waterline while the field camera records its body, heading and position; a cypress island or trunk between the boat and animal blocks the sequence. Prop wash can make it dive before the fix is complete. The report goes to FWC with no capture attempt, matching the agency's advice to photograph, note the location and report a sighting. Burmese pythons are established in South Florida and are often found near or in water; see the [FWC species profile](https://myfwc.com/wildlifehabitats/profiles/reptiles/snakes/burmese-python/) and [USGS waterway research](https://www.usgs.gov/centers/wetland-and-aquatic-research-center/science/burmese-python-environmental-dna-edna-surveys). Successful observations stay in the boat log and on the chart.

The python is one 18-segment instanced mesh with one procedural geometry and one material. Its surface wake uses one record from the existing wake pool. Repeated sightings reuse the same rig.

On some calm nights, a plankton bloom reaches Mangrove Reach. The water stays black until something moves through it: hull wakes, fish, paddles and splashes leave blue fire behind them. A bright Moon takes some contrast out of the glow without switching off the bloom; moonset and thick cloud bring the darker water back. The bloom runs through the existing wake and particle buffers, so it adds no extra scene assets.

Calm banks now carry fireflies after sunset, with the thickest displays in cypress and mangrove water. Heavy rain and hard wind shut them down, while a high bright Moon makes the flashes harder to pick out. A fast engine thins the display close to the hull, and the bow spotlight washes out the insects caught in its cone. Each bank is seeded from its world cell, so the same lights remain in place as the boat idles past. The display is one textureless point draw capped at 243 insects; Performance and Balanced draw smaller prefixes, and Fallback skips it.

The timing and wet-bank placement draw on [University of Florida field notes](https://entnemdept.ufl.edu/lloyd/firefly/ffcomp1-1.pdf). The mangrove bias follows the documented habitat of the [Florida intertidal firefly](https://xerces.org/press/first-conservation-status-assessments-published-for-north-american-fireflies), and the weather and light response follows [National Park Service viewing guidance](https://home.nps.gov/cong/fireflies.htm).

Power at the camps is no longer perfect. Squalls make weak circuits sag. Thunderstorms and tropical weather can black out individual houses, and a close lightning strike can leave one address dark after the rain moves on. Each place keeps the same vulnerability for the day, and restored power comes back slowly instead of snapping on. The effect still uses five pooled point lights. Those lights now share one bulb geometry and material, and nearest-site selection reuses five fixed records instead of rebuilding and sorting a candidate list every 0.6 seconds.

People are jointed figures driven by a pose target system rather than baked animation, so a man on a dock will track you as you go past, drink his beer, check his rod, cast, and reel in a fish. Boat ramps run a 150 second cycle where a truck backs down the slab, floats a boat off the trailer, motors out and comes back to winch it on.

<img src="docs/screenshots/02-mission.jpg" alt="A story job in progress" width="100%">

## How the world works

<img src="docs/screenshots/04-chart.jpg" alt="The chart, 16 miles square across nine regions" width="100%">

`src/heightfield.js` is plain JavaScript with no three.js import, which lets the main thread and a pool of up to four web workers evaluate the same terrain function. The home bayou around the tower is hand shaped inside a 560 m radius, blending out to procedural noise by 780 m. Past that, domain warped ridged noise carves rivers and creeks, fbm makes lakes, and flat sawgrass prairie fills the gaps with tree hammocks scattered through it. Sandbars are seeded per 400 m cell.

`src/terrain.js` streams that as a quadtree, six levels from 100 m chunks up to 3200 m, 64 segments each, out to 7.2 km. Skirts hide the LOD cracks and a coarse parent stays visible until all four of its children have finished building, so you never see a hole. Vegetation is built per chunk as instanced meshes with tiers by level, dropping grass and cypress knees first and ending at crossed cards for far trees. Tree positions are seeded per 100 m cell and accepted at the exact terrain height, which is what makes every LOD agree with every other one.

The two lessons that cost the most time: per chunk bounding spheres are not optional (leaving `frustumCulled = false` on a thousand instanced meshes dropped the frame rate to 19), and the coarse fallback has to be local, because letting a root tile draw whenever any distant leaf is still building puts a 3200 m blob over your boat.

Minimap tiles are 200 m and rendered by the same workers, then cached. The chart is the same idea at 3200 m with chart styling.

## Layout

```
src/
  heightfield.js   terrain function, no three.js, shared with the workers
  terrain.js       quadtree streaming and LOD
  surfacewetness.js retained rain film and shared outdoor material response
  vegetation.js    per-chunk instancing, wind shader
  water.js         reflection, refraction, murk, tide, wake sediment
  sediment.js      shallow-bed churn model
  airboat.js       hull physics, air control, landing quality
  game.js          jobs, bounties, records, save
  discoveries.js   tide, time and region-driven field observations
  navigationaids.js seeded channel markers, light failures and reports
  fishing.js       boat-bound fishing, habitat, line tension and catch log
  ecology.js       weather, time and traffic-driven world behaviour
  nocturnal.js     seeded bank fireflies and night disturbance response
  wildlife.js      birds, fish, gators and spotlight eyeshine
  wildlifetraffic.js retained manatee closest-approach and safe-speed rules
  wrangler.js      nuisance-gator station keeping and wake-risk rules
  encounters.js    rescues, patrols, races, contraband and wildlife calls
  law.js           wanted attention and pursuit state
  story.js         the channel 68 arc
  folk.js          jointed people and the pose target animation
  life.js          fish, debris, NPC traffic, bank anglers
  sites.js         stilt houses, ramps, boathouses, duck blinds
  world.js         seeded camps, traps, camp runs
  hud.js           HUD and radar
  worldmap.js      the chart
```

## Dev hooks

`window.__dbg` is exposed in the browser console with the renderer, camera, terrain, physics, water and most of the game systems on it.

```js
__dbg.mode = 'depth'                      // full | raw | nowater | depth | refl
__dbg.phys.reset(x, z, heading)           // teleport
__dbg.environment.minutesPerSecond = 0    // freeze the clock
__dbg.environment.setHour(17.4)           // pick the light
__dbg.environment.lunarSnapshot()         // phase, illumination, tide range, altitude, live light
__dbg.ecology.setBioluminescence(1, true) // force the disturbed-water glow
__dbg.discoveries.start('roseate-roost', true, true) // force a nearby field sign
__dbg.discoveries.start('python-crossing', true, true) // force the swimming-python report
__dbg.navigationAids.resourceStats()     // active aids, draw calls, faults and reports
__dbg.fishing.resourceStats()            // fixed rod, line, lure and landing-fish budget
__dbg.nocturnal.setActivityOverride(1, true) // force bank fireflies for inspection
__dbg.nocturnal.resourceStats()           // point count, draw count and geometry bytes
__dbg.gators.resourceStats()               // 18 animals and the fixed 36-eye instanced pool
Alt+Shift+U                                // stage one resident-boat/manatee crossing in development
__dbg.environment.setRainbow(1)            // force both bows; pass null to restore live weather
__dbg.environment.settlementPowerSnapshot() // five-light pool, live grid stress and saved strike outages
__dbg.environment.spotlightVolumeSnapshot() // one weather-scaled beam mesh and its fixed geometry budget
__dbg.environment.lightningSnapshot()       // fixed branched channel, return strokes and live draw budget
__dbg.environment.eyeAdaptationSnapshot()   // current exposure target and zero-extra-GPU-resource budget
__dbg.environment.cloudShadowSnapshot()   // live mask, drift and zero-extra-resource budget
__dbg.environment.surfaceWetnessSnapshot()  // live film target, shared material writes and terrain uniforms
__dbg.encounters.pursuitSnapshot()        // surface units, channel closure, shared visual and pooled aviation state
__dbg.encounters.wranglerSnapshot()       // pooled crowd, assist, wake risk and zero extra render resources
__dbg.hazards.resourceStats()             // debris pool, shared resources and wake-stamp budget
__dbg.audio.spatialStats()                 // listener direction and spatial-node allocation totals
__dbg.freeCam = { x, y, z, tx, ty, tz }   // park the camera
__dbg.terrain.hf.computeBase(x, z)        // { h, s, lake, prairie, hammock }
```

In development, `Shift+F12` toggles a frozen, safe-distance python inspection and restores the previous boat position and clock when pressed again. It is stripped from the production build.

`import('/src/inspect.js')` from the console gives you a helper for measuring and previewing a GLB, which is how the entries in `SPEC` in `src/models.js` were worked out.

## Licence

MIT. See [LICENSE](LICENSE).

The GLB models in the release archive were generated with [Meshy](https://www.meshy.ai/) and are covered by their own terms, not by this repository's licence.
