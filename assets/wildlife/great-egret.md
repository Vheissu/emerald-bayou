# Great egret

The sixteen resident shorebirds use [great-egret.glb](../../public/wildlife/great-egret.glb). Its standing height is 1.03 m and its spread wings span 1.42 m. The export has 4,602 triangles, 3,722 vertices, one material, one embedded 1024 px JPEG atlas and six morph targets. It is 715,496 bytes.

The proportions and identifying marks follow the [Cornell Lab's Great Egret guide](https://www.allaboutbirds.org/guide/Great_Egret/id): white plumage, a yellow bill, black legs and feet, and a long neck that folds in flight. Cornell and the [Everglades National Park species profile](https://home.nps.gov/ever/learn/nature/greategret.htm) describe slow stalking and quick bill strikes in shallow water. The animation is a game approximation of those movements, not a biomechanical simulation.

## Editable source and images

- [Blender scene](great-egret.blend), with the mesh, packed images, pose controls and studio camera.
- [Anatomy reference](great-egret-reference.png) and its [exact prompt](great-egret-reference-prompt.txt).
- [Plumage atlas](great-egret-plumage.png) and its [exact prompt](great-egret-plumage-prompt.txt).
- [Standing proof](great-egret-preview.png) and [flight proof](great-egret-flight-preview.png).
- [Build statistics](great-egret-stats.json).

The reference and atlas were generated with the built-in imagegen tool. The mesh was then authored in Blender from that reference; it wasn't automatically reconstructed from the image. The older pelican source and runtime asset are unchanged.

## Poses and runtime ownership

`Basis` stands with folded wings. `Flight`, `Upstroke` and `Downstroke` include a retracted neck and trailing legs. `Probe` extends the neck toward the feeding shelf. `StepLeft` and `StepRight` lift alternate feet. Every non-basis key defaults to zero, and all six export their deformed normals.

`src/egrets.js` blends the flight poses without applying several full-body flight deformations at once. One instanced draw carries the population, with a retained 448-byte pose buffer and a 1,024-byte instance-matrix buffer. Geometry, plumage material and image belong to the model cache. The flock owns its instance buffers and its custom shadow material; it prepares both the lit and shadow morph programs before hiding the stand-ins.

The original sixteen resident records still handle boat and gunshot disturbances. Grounded birds alternate watching, short steps and bill probes. Flight ends at a selected shelf, rather than simply stopping wherever the timer expires. A shelf that floods is rejected. An inland escape can search back along nearby shoreline or return to a still-valid remembered shelf. Tide-driven departures retain an ambient source and don't count as a player flush.

Pause and title states pass zero simulation time to the shorebirds. Their positions, flight timers and pose clock remain still, while an asynchronously loaded model can still replace its stand-in.

Balanced and Cinematic download the authored egret through the existing deferred queue. Performance, Fallback and constrained connections skip it. The procedural stand-ins now open simple shared wings during flight too. Failed loading or shader preparation leaves those stand-ins in place.

## Rebuild and checks

Run from the repository root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/build-egret.py
node --test test/egrets.test.js test/startup.test.js test/wildlifeinteractions.test.js
npm test
npm run build
```

The builder refuses foreground execution. It replaces only this egret's Blender scene, GLB, two proof renders and statistics file in a separate background process, leaving any open Blender document alone. Authoring coordinates are metres with Y up and the bill toward -Z, converted to Blender's frame for editing and export.

The 8 September check passed all 512 tests and the production build. The tests cover the exported geometry and pose normals, shared-buffer ownership, both shader-preparation gates, failed loading, pause behaviour, shoreline search, tide-invalidated destinations and completed landings. Blender 5.1.2 printed deprecation warnings for its material/world node flags; the export completed successfully. Vite retained its existing large-bundle warning.

Chrome verification included standing and bill-probe poses, both wing strokes, the live pause guard, and a complete traffic-triggered takeoff and landing. The final flight landed on a valid shoreline with every tracked model, material, matrix and pose-buffer reference unchanged. All 81 shader programs present passed a direct link-status check. No model-load warning was recorded. Chrome also logged three asynchronous message-channel errors without attribution to a game source file; those were not resolved in this pass.

## Rendering cost

The sixteen standing stand-ins contain 112 visible meshes. The authored population is one instanced draw per pass, but it has more triangles. Actual saved submissions depend on which birds the camera can see; this is not a claim that every game frame loses 111 draws.

An alternating fallback/authored/fallback/authored comparison used the same paused shoreline view in Chrome on an M2 Max, with Cinematic quality fixed at roughly three million internal pixels. After warm-up, each run recorded 134 frame intervals:

| Model | Median | p95 | Worst |
|---|---:|---:|---:|
| Fallback | 16.2 ms | 23.0 ms | 25.7 ms |
| Authored | 16.4 ms | 23.8 ms | 30.9 ms |
| Fallback | 16.4 ms | 21.7 ms | 25.7 ms |
| Authored | 16.1 ms | 20.8 ms | 27.9 ms |

There was no consistent frame-time increase in this narrow comparison. It isn't a new driving benchmark or proof that the game's remaining stutters are gone. The final neck-shape correction retained the same geometry counts and buffer sizes.

Local evidence is kept in the ignored `output/playwright/` directory: `egret-frame-comparison.json`, `egret-flight-final.json`, and the `egret-*.png` screenshots. Test tabs were closed and preview servers stopped after verification.
