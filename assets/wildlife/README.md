# Brown pelican

The ten brown pelicans use `public/wildlife/brown-pelican.glb`. The model has a 2.06 m wingspan, 4,048 triangles, one material and one embedded 1024 px plumage atlas. The GLB is 568,960 bytes and ships with the repository, separately from the older model release archive.

`brown-pelican.blend` contains the editable mesh, packed reference images, studio camera and flight pose controls. `Basis` is the bowed-wing glide. `Upstroke`, `Downstroke` and `Dive` are wing-only shape keys; their normals are exported with the positions. Heads, bills and bodies stay rigid. The game blends those poses per bird through one instanced draw and a retained 160-byte pose buffer. It adds one draw to the existing flock renderer, with no extra birds. When all pelicans are inactive, that draw is hidden.

Balanced and Cinematic load the authored model through the existing deferred queue. Performance, Fallback and constrained connections keep the procedural birds and skip the GLB download.

## Rebuild

Run from the repository root with Blender 5.1:

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/build-pelican.py
node --test test/pelicans.test.js
```

This creates a separate background scene, leaving any open Blender document alone. It replaces this pelican's `.blend`, GLB, preview and statistics files. The Python source uses metres with the head toward game `-Z`, then converts to Blender's coordinate frame for editing and export. Thin cambered feather vanes give the silhouette its separate tips without alpha-tested feather cards.

## Image sources

Both source images were made with the built-in imagegen tool. The exact prompts are saved beside them:

- `brown-pelican-reference-prompt.txt` produced the three-view anatomy and plumage reference in `brown-pelican-reference.png`.
- `brown-pelican-plumage-prompt.txt` produced the material atlas in `brown-pelican-plumage.png`. Blender maps the four regions onto flight feathers, body feathers, head down and bill, and embeds a 1024 px JPEG version in the GLB.

The mesh is modelled in Blender from the reference; it is not an automatic single-image reconstruction. The reference is a visual guide, not an anatomical authority. Size, colouring and flight behaviour were checked against the Cornell Lab's [brown pelican identification guide](https://www.allaboutbirds.org/guide/Brown_Pelican/id). The other flying species still use procedural models; their wingspans were reduced using Cornell's [turkey vulture](https://www.allaboutbirds.org/guide/Turkey_Vulture/id), [osprey](https://www.allaboutbirds.org/guide/Osprey/id) and [barn swallow](https://www.allaboutbirds.org/guide/barn_swallow/id) measurements.

## Verification

The tests parse the shipped GLB with Three.js and check its pose names, vertex motion, rigid head, texture and geometry budget. Flock tests cover deferred shader preparation, failed loads, buffer reuse, feeding redirection and flight direction.

The in-game check on 6 September 2026 showed both wing strokes and feeding folds, with no console warnings or shader failures. A paused Cinematic scene at 1280 × 720 had settled median frame times of 33.7 ms with the authored pelicans both off and on. Its tail latency varied, including frame spikes in both cases. This is a narrow asset comparison, not evidence that the game's general cruising stutter is fixed.
