# Shoreline foam, 8 September 2026

The old shader added foam wherever the refracted scene depth was less than 0.55 units behind the water. That painted a white border around calm banks and water intersections even when no wave or wake was disturbing them.

`src/shorefoam.js` defines a response to the existing sea state, local foam and wake gradient. Calm water produces no new shore foam from depth alone. Wind-driven wash passes in broken crests, while boat wash can remain active in sheltered water between those crests. The existing backwater and duckweed map reduces the wind contribution without suppressing a local wake.

This follows the general connection between agitation and foam described by [NOAA](https://oceanservice.noaa.gov/facts/seafoam.html). The thresholds are tuned to the game's dimensionless sea-state and wake signals. They aren't physical wave-height measurements or a shoreline fluid simulation.

The change retains the original peak shoreline opacity, foam texture detail, open-water whitecap formula, rain/hail crowns, wake solver, and bioluminescent wake response. It adds no sampler, geometry, render target or render pass. The shader still uses eight samplers. An inactive shore response can skip the existing foam-detail samples when no other foam effect needs them.

## Verification

All 517 tests and the production build passed. Five new tests cover calm-water suppression, crest response, independent boat-wash inputs, the conservative texture-skip bound, and shader integration.

Chrome comparisons used the same frozen shoreline, camera, lighting and Cinematic settings before and after the shader change. Calm, storm-crest, local wake and blue-fire fixtures were checked, followed by a frame under the game's hurricane lighting and water conditions. All 84 programs present, including the temporary comparison variants, passed direct shader link checks. This was a targeted rendering check, not a full storm-playthrough or a new driving-performance benchmark.

The comparison harness emitted six warnings while cloning render-target uniforms. Both temporary materials were assigned the original shared uniform objects before rendering; the harness and its materials were removed afterward. No shader-link error occurred. The test tab was closed, its preview server stopped, and the original graphics preference restored.

Local screenshots are in the ignored `output/playwright/` directory: `shore-calm-before.png`, `shore-calm-after.png`, `shore-storm-crest-after.png`, `shore-wash-after.png`, `shore-bio-wash-after.png` and `shore-hurricane-final.png`.
