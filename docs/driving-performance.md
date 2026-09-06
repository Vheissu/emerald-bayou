# Driving performance, 6 September 2026

This pass reduces rendering work without changing the graphics profiles. It doesn't establish hitch-free driving on every machine.

## What changed

- Static terrain and foliage keep their attached world matrices. Hidden, pooled scene groups skip descendant matrix updates until they become visible. Forced updates and world-position queries still work.
- Ground-cover batches outside their existing shader fade range stop submitting draws. A conservative distance test retains anything near the boundary; shadow-casting vegetation keeps its depth range. Fully faded instances also exit the vertex shader before wind and normal calculations.
- Optional solid grass warms its actual compact-instanced, wind-deformed material before replacing the cards. Hero-tree wind is installed before shader preparation, rather than after the plain model has already been warmed.
- Water skips texture work whose contribution is zero. Shore foam, storm caps, duckweed and bioluminescence retain their original detail when active. Six water-shadow taps remain, with their shared rotation calculated once.
- Procedural alligators retain their parts in eight draws instead of 29. The loaded authored model is unchanged.
- Production builds omit synchronous shader-log queries during rendering. Development diagnostics remain enabled.

Resolution, antialiasing, shadow resolution, reflection size and update rate, foliage density, fade distances, particles, and world extent are unchanged.

## Chrome driving comparison

The comparison used the production builds on the same M2 Max, in Chrome, at Cinematic quality. The drawing surface stayed at 2340 × 1281 pixels, with 2× MSAA, 4096-pixel shadows, 1170 × 640 reflections and a 512-pixel wake simulation. No CPU profiler was attached. Other applications were left alone, so these sequential runs aren't an isolated hardware benchmark.

Each recording lasted 42 seconds. The boat started at river centre, z = 70, followed the channel south, turned after z = -135 and returned through the same water. A repeat reset only the boat's pose; terrain and model caches stayed loaded. Fair weather and the clock were fixed at 10 AM. Runs had no collisions and reached about 14 m/s. Saves were disabled before testing, and the original graphics preference was restored before closing each test tab.

The baseline was commit `8c7d151`, built in a separate temporary directory with the same runtime model files. All models were ready by the end of its first drive. The table is in chronological test order. Times are milliseconds; lower is better.

| Build / drive | Frames | Mean | Median | p95 | p99 | Worst | Over 50 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| Optimized, first session | 3641 | 11.53 | 9.3 | 17.8 | 18.7 | 195.1 | 5 |
| Optimized, familiar repeat | 3417 | 12.29 | 10.1 | 18.0 | 18.7 | 208.4 | 5 |
| Baseline, complete assets | 2795 | 15.03 | 16.4 | 18.6 | 25.4 | 67.6 | 1 |
| Baseline, familiar repeat | 2773 | 15.15 | 16.3 | 18.5 | 25.2 | 32.5 | 0 |
| Optimized, second session | 3162 | 13.28 | 15.2 | 18.1 | 23.8 | 58.0 | 1 |
| Optimized, familiar repeat | 3063 | 13.71 | 15.7 | 18.2 | 18.8 | 35.0 | 0 |

The final familiar repeat rendered 10.5% more frames than the baseline repeat. Its mean frame interval was 9.5% lower and p99 fell from 25.2 to 18.8 ms. The first optimized session ran faster overall but had worse isolated stalls, including with all models loaded. That variance prevents a claim that stutter is fully fixed. The cause of those larger stalls remains unproven.

An earlier temporary baseline omitted the ignored model files and fell back to procedural assets. Its two recordings are excluded. In-app-browser results are also kept separate: they showed a sustained slowdown not reproduced in these Chrome runs. A minimal-render control reached roughly 120 fps, so that slowdown wasn't a fixed 30 fps browser cap.

## Isolated checks

Within one frozen scene, alternating original/cached transforms reduced median matrix-update time from 1.4–1.5 ms to 0.5–0.6 ms. The two rendered images matched pixel for pixel. Whole-frame cadence barely changed in that particular test.

A visible-render-list probe found 70 ground-cover batches entirely past their existing fade end: 832,416 submitted triangles with no visible contribution. Hiding only those batches produced a pixel-identical image. The live range-culling counter later excluded about 2.8 million triangles across eligible terrain chunks; that counter includes off-screen chunks, so it must not be reported as 2.8 million triangles saved from every rendered frame.

Water-only GPU replay retained all six shadow taps and eight samplers. Three alternating pairs measured 1.381–1.568 ms before and 1.269–1.454 ms after, including the dependent copy pass. This is a small local improvement, not a whole-game FPS result. Daylight images matched exactly. Storm, duckweed and bioluminescence fixtures had small pixel differences from texture-gradient rounding, with maximum channel differences of 5–9 on the 0–255 scale.

Sorting opaque geometry front-to-back was also tested. It increased render submission time and was rejected; Three's normal sorting remains in use.

## Regression checks

`npm test` passed all 497 tests. `npm run build -- --sourcemap` passed, with the existing large-bundle warning. Chrome reported no warnings or errors in the complete baseline or final optimized runs. Direct link-status checks passed for all 78 daylight programs and all 81 programs present after the hurricane check. Both solid-grass preparations completed without failure.

The new tests cover attached world matrices, late grass replacement, hidden-group reactivation, forced updates, resource ownership, alligator batching, conservative range culling and re-entry, shadow-range preservation, shader-preparation failure, and zero-contribution water bounds.

Raw recordings, profiles and visual comparisons are in the local ignored `output/playwright/` directory. The valid Chrome recordings use these names:

- `driving-chrome-after.json` and `driving-chrome-familiar-after.json`
- `driving-chrome-before-complete.json` and `driving-chrome-familiar-before-complete.json`
- `driving-chrome-after-repeat.json` and `driving-chrome-familiar-after-repeat.json`

The local `drive-replay.js` helper records frame intervals, long-animation-frame entries, model queues, render counts and graphics settings. When repeating the test, verify model success and matching quality settings before interpreting the timing table. Close the test tab and stop its preview server before running builds or offline analysis.
