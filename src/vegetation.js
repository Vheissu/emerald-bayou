import * as THREE from 'three';
import * as TEX from './textures.js';
import { mulberry32 } from './noise.js';
import { HOME_X, HOME_Z } from './heightfield.js';

const WIND_GLSL_V1 = `
uniform float uTime; uniform vec3 uWind; // xz = direction, y = strength
float whash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = whash(i), b = whash(i + vec2(1.0, 0.0)), c = whash(i + vec2(0.0, 1.0)), d = whash(i + vec2(1.0, 1.0)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
float gust(vec3 wp) { vec2 d = uWind.xz; vec2 q = wp.xz * 0.011 - d * uTime * 0.33; return wnoise(q) * 0.62 + wnoise(q * 2.9 + 5.0) * 0.38; }
vec3 windOffset(vec3 wp, float h, float amp, float g) {
  float t = uTime; vec2 d = uWind.xz; float s = uWind.y;
  float ph = whash(wp.xz) * 6.2831;
  float freq = 0.8 + 0.5 * whash(wp.xz + 7.0);
  float bend = h * h;
  float rock = sin(t * freq + ph) * 0.35 + sin(t * freq * 2.3 + ph * 1.7) * 0.10;
  vec3 o = vec3(d.x, 0.0, d.y) * (0.4 + 1.2 * g + rock * (0.35 + g));
  o += vec3(-d.y, 0.0, d.x) * sin(t * freq * 0.71 + ph * 1.3) * (0.12 + 0.22 * g);
  o.y = -length(o.xz) * 0.22;
  return o * amp * s * bend * 1.5;
}
vec3 windBranch(vec3 co, float h, float amp, float g) { return vec3(0.0); }
vec3 windFlutter(vec3 wp, float amp, float g) {
  float t = uTime;
  float f1 = sin(t * 10.0 + wp.x * 2.1 + wp.z * 1.7), f2 = sin(t * 13.7 + wp.z * 2.3 + wp.y * 1.6);
  return vec3(f1, f2 * 0.5, -f1 * 0.6) * amp * (0.1 + 0.9 * g * g) * uWind.y;
}`;
const WIND_V2 = true;
const WIND_GLSL_V2 = `
uniform float uTime; uniform vec3 uWind; // xz = direction, y = strength
float whash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float wnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); float a = whash(i), b = whash(i + vec2(1.0, 0.0)), c = whash(i + vec2(0.0, 1.0)), d = whash(i + vec2(1.0, 1.0)); return mix(mix(a, b, f.x), mix(c, d, f.x), f.y); }
// the gust field: slow fronts of stronger wind drifting downwind across the whole forest (0 = lull, 1 = gust)
float gust(vec3 wp) { vec2 d = uWind.xz; vec2 q = wp.xz * 0.011 - d * uTime * 0.33; return wnoise(q) * 0.48 + wnoise(q * 2.9 + 5.0) * 0.3 + wnoise(wp.xz * 0.055 - d * uTime * 0.95 + 17.0) * 0.22; }
// sway of a point at normalised height h (0 base .. 1 top) of a plant rooted at wp: the stem bends downwind by the gust,
// and rocks about that lean at its own period. Base pinned, the top moves - the whole plant moves together.
vec3 windOffset(vec3 wp, float h, float amp, float g) {
  float t = uTime; vec2 d = uWind.xz; float s = uWind.y;
  float ph = whash(wp.xz) * 6.2831;
  float freq = 0.7 + 0.7 * whash(wp.xz + 7.0);
  float stiff = 0.65 + 0.7 * whash(wp.xz + 3.0); // every plant answers the wind differently
  float bend = h * h;
  float rock = sin(t * freq + ph) * 0.35 + sin(t * freq * 2.3 + ph * 1.7) * 0.12 + sin(t * freq * 0.37 + ph * 2.9) * 0.2;
  vec3 o = vec3(d.x, 0.0, d.y) * (0.35 + 0.8 * g + rock * (0.5 + 0.9 * g));
  o += vec3(-d.y, 0.0, d.x) * sin(t * freq * 0.71 + ph * 1.3) * (0.15 + 0.3 * g);
  o.y = -length(o.xz) * 0.22; // the top dips as it leans
  return o * amp * s * bend * 1.5 * stiff;
}
// each branch / blade has its own smaller motion on top of the plant's lean, so a crown is never one rigid block
vec3 windBranch(vec3 co, float h, float amp, float g) {
  float t = uTime; vec2 d = uWind.xz;
  float ph = whash(co.xz + co.y * 0.37) * 6.2831; float f = 1.1 + 1.3 * whash(co.zx + 2.0);
  float k = sin(t * f + ph) * 0.6 + sin(t * f * 1.9 + ph * 2.3) * 0.25;
  return (vec3(d.x, 0.3, d.y) * k + vec3(-d.y, 0.0, d.x) * sin(t * f * 0.8 + ph * 1.5) * 0.4) * amp * uWind.y * (0.1 + 0.35 * g) * h;
}
// leaves: a faint quick shiver that only shows up in the gusts, a few centimetres at most
vec3 windFlutter(vec3 wp, float amp, float g) {
  float t = uTime;
  float f1 = sin(t * 10.0 + wp.x * 2.1 + wp.z * 1.7), f2 = sin(t * 13.7 + wp.z * 2.3 + wp.y * 1.6);
  return vec3(f1, f2 * 0.5, -f1 * 0.6) * amp * (0.1 + 0.9 * g * g) * uWind.y;
}`;

const WIND_GLSL = WIND_V2 ? WIND_GLSL_V2 : WIND_GLSL_V1;

// Patch a material so instanced cards get wind sway and (optionally) crown-centred normals,
// crown-depth ambient occlusion and sun translucency (leaves lit from behind glow).
function patchFoliage(mat, { crownNormals = false, pin = 'bottom', pinH = 1, amp = 0.12, hasCrown = false, trans = 0.0, fade = null } = {}) {
  const isDepth = !!mat.isMeshDepthMaterial;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uSunDir = { value: new THREE.Vector3(0, 1, 0) };
    shader.uniforms.uWind = { value: new THREE.Vector3(1, 1, 0) };
    // small foliage shrinks away before the edge of the ring it lives in, so it never switches off in view
    shader.uniforms.uFade = { value: fade && !isDepth ? new THREE.Vector2(fade[0], fade[1]) : new THREE.Vector2(1e8, 1e8 + 1) };
    mat.userData.shader = shader;
    let vs = shader.vertexShader;
    vs = vs.replace('#include <common>', `#include <common>\n${WIND_GLSL}\nuniform vec3 uSunDir; uniform vec2 uFade; varying float vFolAO; varying float vFolBack;\n${hasCrown ? 'attribute vec4 aCrown;' : ''}`);
    if (crownNormals) {
      vs = vs.replace('#include <beginnormal_vertex>', `
        vec3 wpN = (instanceMatrix * vec4(position, 1.0)).xyz;
        vec3 objectNormal = normalize(wpN - aCrown.xyz + vec3(0.0, 0.35, 0.0));`)
        .replace('#include <defaultnormal_vertex>', `vec3 transformedNormal = normalMatrix * objectNormal;`);
    }
    vs = vs.replace('#include <project_vertex>', `
      vec3 wBase = transformed;
      #ifdef USE_INSTANCING
        wBase = ${hasCrown ? 'aCrown.xyz' : '(instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz'};
      #endif
      float keep = 1.0 - smoothstep(uFade.x, uFade.y, distance(cameraPosition, wBase));
      vec4 mvPosition = vec4(transformed * keep, 1.0);
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      float hFac = ${pin === 'bottom' ? 'uv.y' : pin === 'top' ? '(1.0 - uv.y)' : pin === 'y' ? `clamp(position.y / ${pinH.toFixed(3)}, 0.0, 1.0)` : (hasCrown ? 'clamp(mvPosition.y / max(aCrown.y, 1.0), 0.0, 1.0)' : '1.0')};
      #ifdef USE_INSTANCING
        vec3 cardOrigin = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      #else
        vec3 cardOrigin = wBase;
      #endif
      float gW = gust(wBase);
      mvPosition.xyz += windOffset(wBase, hFac, ${amp.toFixed(3)}, gW) + (windFlutter(cardOrigin, ${(amp * 0.07).toFixed(3)}, gW) + windBranch(cardOrigin, hFac, ${(amp * 0.55).toFixed(3)}, gW)) * ${hasCrown ? '1.0' : (pin === 'top' ? '(1.0 - uv.y)' : pin === 'y' ? 'hFac' : 'uv.y')};
      ${hasCrown ? `
        // crown-depth AO: cards deep inside the crown are darker, the outer shell is lit
        vec3 dc = mvPosition.xyz - aCrown.xyz; dc.y *= 1.6;
        float rc = clamp(length(dc) / max(aCrown.w, 0.5), 0.0, 1.0);
        vFolAO = 0.55 + 0.45 * smoothstep(0.0, 1.0, rc);
        { float vd = length((modelViewMatrix * vec4(wBase, 1.0)).xyz); vFolAO = mix(vFolAO, 1.0, smoothstep(90.0, 320.0, vd)); }
        // upper hemisphere sees more sky
        vFolAO *= 0.8 + 0.2 * clamp(dc.y / max(aCrown.w, 0.5) + 0.5, 0.0, 1.0);
        vec3 nW = normalize(dc);
        vFolBack = pow(max(-dot(nW, uSunDir), 0.0), 1.5) * (0.55 + 0.45 * rc);` : 'vFolAO = 1.0; vFolBack = 0.0;'}
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
    shader.vertexShader = vs;
    if (!isDepth) {
      let fs = shader.fragmentShader;
      fs = fs.replace('#include <common>', `#include <common>\nvarying float vFolAO; varying float vFolBack;`);
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= vFolAO;`);
      if (trans > 0) fs = fs.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(1.0, 0.93, 0.62) * (${trans.toFixed(3)} * vFolBack);`);
      shader.fragmentShader = fs;
    }
  };
  mat.customProgramCacheKey = () => `fol-${crownNormals}-${pin}-${pinH}-${amp}-${hasCrown}-${trans}-${isDepth}`; // uFade is a uniform, not part of the program
}

function makeDepthMat(map, alphaTest, opts) {
  const d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest, side: THREE.DoubleSide });
  patchFoliage(d, { ...opts, crownNormals: false });
  return d;
}

function cardGeo() { return new THREE.PlaneGeometry(1, 1); }
function frondGeo() { const g = new THREE.PlaneGeometry(1, 1); g.translate(0, 0.5, 0); return g; }

function trunkGeo() {
  const g = new THREE.CylinderGeometry(0.55, 1.0, 1, 10, 10, false);
  g.translate(0, 0.5, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); const x = p.getX(i), z = p.getZ(i);
    const flare = 1 + 1.6 * Math.exp(-y * 14) + 0.25 * Math.exp(-y * 4);
    const taper = 1 - y * 0.35;
    p.setX(i, x * flare * taper); p.setZ(i, z * flare * taper);
  }
  g.computeVertexNormals();
  return g;
}

// A kind of instanced card (cypress crown card, palm frond, grass clump...): one shared material, one mesh per chunk.
class Kind {
  constructor(geo, texture, opts, { color = 0xffffff, alphaTest = 0.5, shadow = true, small = false } = {}) {
    this.geo = geo; this.opts = opts; this.shadow = shadow; this.small = small;
    this.mat = new THREE.MeshStandardMaterial({ map: texture, alphaTest, side: THREE.DoubleSide, roughness: 0.92, metalness: 0, color, alphaToCoverage: true });
    patchFoliage(this.mat, opts);
    this.depth = makeDepthMat(texture, alphaTest, opts);
  }
  setTime(t, sunDir, wind) {
    const s = this.mat.userData.shader; if (s) { s.uniforms.uTime.value = t; if (sunDir) s.uniforms.uSunDir.value.copy(sunDir); if (wind) s.uniforms.uWind.value.copy(wind); }
    const d = this.depth.userData.shader; if (d) { d.uniforms.uTime.value = t; if (wind) d.uniforms.uWind.value.copy(wind); }
  }
}
// Collects instances for one kind inside one chunk, then bakes them into an InstancedMesh.
const grow = (arr, need) => { if (need <= arr.length) return arr; const n = new Float32Array(Math.max(need, arr.length * 2)); n.set(arr); return n; };
class Batch {
  constructor(kind) { this.kind = kind; this.m = new Float32Array(16 * 256); this.col = new Float32Array(3 * 256); this.crown = kind.opts.hasCrown ? new Float32Array(4 * 256) : null; this.n = 0; }
  add(matrix, color, crown) {
    const n = this.n;
    this.m = grow(this.m, (n + 1) * 16); this.m.set(matrix.elements, n * 16);
    this.col = grow(this.col, (n + 1) * 3); const c = n * 3;
    if (color) { this.col[c] = color.r; this.col[c + 1] = color.g; this.col[c + 2] = color.b; } else { this.col[c] = this.col[c + 1] = this.col[c + 2] = 1; }
    if (this.crown) { this.crown = grow(this.crown, (n + 1) * 4); const k = n * 4; if (crown) { this.crown[k] = crown.x; this.crown[k + 1] = crown.y; this.crown[k + 2] = crown.z; this.crown[k + 3] = crown.w; } else { this.crown[k] = this.crown[k + 1] = this.crown[k + 2] = 0; this.crown[k + 3] = 1; } }
    this.n++;
  }
  build(bounds) {
    if (!this.n) return null;
    const k = this.kind;
    const geo = k.opts.hasCrown ? k.geo.clone() : k.geo;
    const mesh = new THREE.InstancedMesh(geo, k.mat, this.n);
    mesh.instanceMatrix.array.set(this.m.subarray(0, this.n * 16)); mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(this.col.slice(0, this.n * 3), 3);
    if (k.opts.hasCrown) geo.setAttribute('aCrown', new THREE.InstancedBufferAttribute(this.crown.slice(0, this.n * 4), 4));
    mesh.castShadow = k.shadow; mesh.receiveShadow = true;
    mesh.boundingSphere = bounds; mesh.frustumCulled = true;
    if (k.small) mesh.layers.set(1);
    mesh.customDepthMaterial = k.depth;
    return mesh;
  }
}
class SolidBatch {
  constructor(geo, mat, shadow = true, small = false) { this.geo = geo; this.mat = mat; this.shadow = shadow; this.small = small; this.m = new Float32Array(16 * 128); this.n = 0; }
  add(matrix) { this.m = grow(this.m, (this.n + 1) * 16); this.m.set(matrix.elements, this.n * 16); this.n++; }
  build(bounds) {
    if (!this.n) return null;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, this.n);
    mesh.instanceMatrix.array.set(this.m.subarray(0, this.n * 16)); mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = this.shadow; mesh.receiveShadow = true;
    mesh.boundingSphere = bounds; mesh.frustumCulled = true;
    if (this.small) mesh.layers.set(1);
    return mesh;
  }
}

const CELL = 100; // placement cell: the level-0 chunk size. Every LOD places the same trees from the same seeds.
const hash2 = (i, j) => { let h = (i * 374761393 + j * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return (h ^ (h >>> 16)) >>> 0; };

export class Vegetation {
  constructor(terrain, exclusions = []) {
    this.terrain = terrain;
    this.exclusions = exclusions; // [{x,z,r}] (home area only)
    const texCyp = TEX.cypressFoliage(), texOak = TEX.oakFoliage(), texPalm = TEX.palmFrond(), texMoss = TEX.mossStrands();
    const texGrass = TEX.grassClump(13, false), texReed = TEX.grassClump(17, true), texBark = TEX.bark();
    const card = cardGeo(), frond = frondGeo();
    this.cyp = new Kind(card, texCyp, { crownNormals: true, pin: 'crown', amp: 0.34, hasCrown: true, trans: 0.6 });
    this.oak = new Kind(card, texOak, { crownNormals: true, pin: 'crown', amp: 0.22, hasCrown: true, trans: 0.4 });
    this.palm = new Kind(frond, texPalm, { pin: 'bottom', amp: 0.4 });
    this.palmetto = new Kind(frond, texPalm, { pin: 'bottom', amp: 0.14, fade: [560, 680] }, { color: 0xd8e6c0, small: true });
    this.moss = new Kind(frond, texMoss, { pin: 'top', amp: 0.5, fade: [560, 680] }, { color: 0xb7bfae, alphaTest: 0.35, shadow: false, small: true });
    this.grass = new Kind(frond, texGrass, { pin: 'bottom', amp: 0.22, fade: [290, 410] }, { shadow: false, alphaTest: 0.45, small: true });
    this.reed = new Kind(frond, texReed, { pin: 'bottom', amp: 0.3, fade: [560, 680] }, { shadow: false, alphaTest: 0.45, small: true });
    this.kinds = [this.cyp, this.oak, this.palm, this.palmetto, this.moss, this.grass, this.reed];
    this.solid = []; // Meshy grass clumps, instanced like the cards, only in the nearest tier
    this.extraMats = [];

    const patchTrunk = (mat, amp) => {
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = { value: 0 }; shader.uniforms.uWind = { value: new THREE.Vector3(1, 1, 0) }; mat.userData.shader = shader;
        shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WIND_GLSL}`).replace('#include <project_vertex>', `
          vec4 mvPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
            vec3 wBase = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
            mvPosition.xyz += windOffset(wBase, pow(clamp(position.y, 0.0, 1.0), 1.6), ${amp.toFixed(3)}, gust(wBase));
          #endif
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
      };
      mat.customProgramCacheKey = () => `trunk-${amp}`;
      return mat;
    };
    texBark.repeat.set(2, 6);
    this.trunkMat = patchTrunk(new THREE.MeshStandardMaterial({ map: texBark, roughness: 0.95, metalness: 0, color: 0x8a867c }), 0.34);
    this.branchMat = patchTrunk(new THREE.MeshStandardMaterial({ map: texBark, roughness: 0.95, color: 0x8f8375 }), 0.30);
    this.kneeMat = new THREE.MeshStandardMaterial({ color: 0x5a4d3f, roughness: 1 });
    this.trunkGeo = trunkGeo();
    this.branchGeo = new THREE.CylinderGeometry(0.06, 0.16, 1, 6, 1); this.branchGeo.translate(0, 0.5, 0);
    this.kneeGeo = new THREE.ConeGeometry(0.18, 1, 6); this.kneeGeo.translate(0, 0.5, 0);
    this.cypTint = new THREE.Color(0.36, 0.48, 0.26); this.oakTint = new THREE.Color(0.30, 0.42, 0.25); this.palmTint = new THREE.Color(0.42, 0.55, 0.34);
    // scratch
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this._col = new THREE.Color(); this._tint = new THREE.Color();
  }
  excluded(x, z) {
    for (const e of this.exclusions) if (Math.hypot(x - e.x, z - e.z) < e.r) return true;
    if (this.blocked && this.blocked(x, z)) return true; // camps, houses, ramps out in the wild (set by main once the world exists)
    return false;
  }

  // Build the vegetation for a terrain chunk. A generator: yields after each 100 m cell so the terrain can spread the
  // work over frames. Sets chunk.veg (a Group) and chunk.colliders (trunk circles for the physics).
  *buildChunk(chunk) {
    const tier = chunk.level; // 0 full, 1 no grass/knees, 2 trees only (half the cards), 3 sparse big cards, 4 two crossed cards, 5 nothing
    if (chunk.level > 4) return;
    const B = {
      cyp: new Batch(this.cyp), oak: new Batch(this.oak), palm: new Batch(this.palm), palmetto: new Batch(this.palmetto),
      moss: new Batch(this.moss), grass: new Batch(this.grass), reed: new Batch(this.reed),
      trunks: new SolidBatch(this.trunkGeo, this.trunkMat), branches: new SolidBatch(this.branchGeo, this.branchMat, true, true), knees: new SolidBatch(this.kneeGeo, this.kneeMat, false, true),
    };
    for (const [i, sk] of this.solid.entries()) B['solid' + i] = new Batch(sk);
    const cells = chunk.size / CELL;
    const ci0 = Math.round(chunk.x0 / CELL), cj0 = Math.round(chunk.z0 / CELL);
    for (let cj = 0; cj < cells; cj++) for (let ci = 0; ci < cells; ci++) {
      this.populateCell(chunk, ci0 + ci, cj0 + cj, tier, B);
      if (tier <= 1 || (ci & 1) === 1) yield;
    }
    const g = new THREE.Group(); g.name = 'veg';
    const half = chunk.size / 2;
    const bounds = new THREE.Sphere(new THREE.Vector3(chunk.x0 + half, (chunk.minH + chunk.maxH) / 2 + 12, chunk.z0 + half), Math.hypot(half, half, (chunk.maxH - chunk.minH) / 2 + 12) + 30);
    for (const k in B) { const mesh = B[k].build(bounds); if (mesh) g.add(mesh); }
    chunk.veg = g;
  }
  disposeChunk(chunk) {
    if (!chunk.veg) return;
    chunk.veg.parent && chunk.veg.parent.remove(chunk.veg);
    for (const mesh of chunk.veg.children) { if (mesh.geometry.getAttribute('aCrown')) mesh.geometry.dispose(); mesh.dispose(); }
    chunk.veg = null; chunk.colliders = [];
  }

  populateCell(chunk, ci, cj, tier, B) {
    const T = this.terrain, hf = T.hf;
    const x0 = ci * CELL, z0 = cj * CELL;
    const rand = mulberry32(hash2(ci + 5000, cj + 5000) ^ 0x9e3779b9);
    const m = this._m, q = this._q, e = this._e, s = this._s, p = this._p, col = this._col;
    const grid = (x, z) => chunk.sample(x, z);
    const open = chunk.sample(x0 + CELL / 2, z0 + CELL / 2, chunk.bio); // 1 = sawgrass prairie, 0 = swamp forest
    const nearHome = Math.hypot(x0 + 50 - HOME_X, z0 + 50 - HOME_Z) < 950;
    const excl = nearHome ? (x, z) => this.excluded(x, z) : (this.blocked ? (x, z) => this.blocked(x, z) : () => false);
    // spacing within the cell (neighbouring cells ignore each other; a metre of overlap at a border is invisible)
    const occ = [];
    const free = (x, z, r) => { for (const o of occ) if (Math.hypot(o.x - x, o.z - z) < Math.max(r, o.r)) return false; return true; };
    const occupy = (x, z, r) => occ.push({ x, z, r });

    const placeTrunk = (tr, x, y, z, h, r, lean = 0.02) => {
      if (tier <= 1) chunk.colliders.push({ x, z, r: r * 1.5 + 0.1 });
      p.set(x, y, z); e.set((tr() - 0.5) * lean, tr() * Math.PI * 2, (tr() - 0.5) * lean); q.setFromEuler(e); s.set(r, h, r);
      m.compose(p, q, s); B.trunks.add(m);
    };
    const placeBranch = (x, y, z, len, r, yaw, tilt) => {
      p.set(x, y, z); e.set(tilt, yaw, 0, 'YXZ'); q.setFromEuler(e); s.set(r, len, r); m.compose(p, q, s); B.branches.add(m);
    };
    const tint = this._tint;
    const varyTint = (tr, base, hueSpread = 0.03, lumSpread = 0.3) => {
      const hslv = {}; base.getHSL(hslv);
      tint.setHSL(hslv.h + (tr() - 0.5) * hueSpread * 2, hslv.s * (0.85 + tr() * 0.3), hslv.l * (1 - lumSpread / 2 + tr() * lumSpread));
      return tint;
    };
    // crown cards; far tiers draw fewer, larger cards (the same silhouette from a distance)
    const crownCards = (tr, batch, cx, cy, cz, rx, ry, n, size, tnt) => {
      const crown = new THREE.Vector4(cx, cy, cz, rx);
      if (tier === 4) {
        for (let i = 0; i < 2; i++) {
          p.set(cx, cy, cz); e.set(0, i * Math.PI / 2 + tr() * 0.4, 0); q.setFromEuler(e); s.set(rx * 2.1, ry * 2.2, 1); m.compose(p, q, s);
          col.copy(tnt).multiplyScalar(0.85); batch.add(m, col, crown);
        }
        return;
      }
      const cnt = tier === 2 ? Math.ceil(n * 0.5) : tier === 3 ? Math.max(6, Math.ceil(n * 0.2)) : n, sz0 = tier === 2 ? size * 1.35 : tier === 3 ? size * 2.2 : size;
      for (let i = 0; i < cnt; i++) {
        const a = tr() * Math.PI * 2, rr = Math.sqrt(tr()) * rx, yy = (tr() - 0.5) * 2 * ry * (1 - rr / rx * 0.35);
        p.set(cx + Math.cos(a) * rr, cy + yy, cz + Math.sin(a) * rr);
        e.set((tr() - 0.5) * 1.1, tr() * Math.PI * 2, (tr() - 0.5) * 0.5);
        q.setFromEuler(e); const sz = sz0 * (0.55 + tr() * 0.9); s.set(sz, sz * (0.8 + tr() * 0.4), sz);
        m.compose(p, q, s);
        col.copy(tnt).multiplyScalar(0.9 + tr() * 0.2); col.g *= 0.97 + tr() * 0.06;
        batch.add(m, col, crown);
      }
    };
    const mossOn = (tr, x, y, z, r, n, lenMul = 1) => {
      if (tier > 1) return;
      for (let i = 0; i < n; i++) {
        const a = tr() * Math.PI * 2, rr = tr() * r;
        p.set(x + Math.cos(a) * rr, y + (tr() - 0.5) * r * 0.6, z + Math.sin(a) * rr);
        e.set(0, tr() * Math.PI, 0); q.setFromEuler(e);
        const len = (1.4 + tr() * 2.4) * lenMul; s.set(0.35 + tr() * 0.4, -len, 1);
        m.compose(p, q, s); col.setHSL(0.22 + tr() * 0.05, 0.12, 0.55 + tr() * 0.2); B.moss.add(m, col);
      }
    };
    const palmCrown = (tr, batch, x, y, z, n, len, tiltMin, tiltMax, tnt) => {
      for (let i = 0; i < n; i++) {
        const yaw = (i / n) * Math.PI * 2 + tr() * 0.5;
        const tilt = tiltMin + tr() * (tiltMax - tiltMin);
        p.set(x, y, z); e.set(-tilt, yaw, 0, 'YXZ'); q.setFromEuler(e);
        const l = len * (0.8 + tr() * 0.4); s.set(l * 0.9, l, 1); m.compose(p, q, s);
        col.copy(tnt).multiplyScalar(0.8 + tr() * 0.4); batch.add(m, col);
      }
    };
    const cypress = (tr, x, z, h, opts = {}) => {
      const emergent = opts.emergent !== undefined ? opts.emergent : tr() < 0.12;
      const H = opts.H || (emergent ? 24 + tr() * 10 : 10 + tr() * 14), r = 0.3 + tr() * 0.28 + H * 0.012;
      placeTrunk(tr, x, h - 0.4, z, H * 0.8, r);
      const tnt = varyTint(tr, this.cypTint, 0.035, 0.35);
      const conical = opts.conical !== undefined ? opts.conical : tr() < 0.45; // young bald cypress are pyramidal; old ones flat-topped and spreading
      const cy = h + H * (conical ? 0.58 : 0.64), crx = (conical ? 2.0 : 2.8) + H * (conical ? 0.09 : 0.14) + tr() * 1.6, cry = H * (conical ? 0.34 : 0.25);
      if (tier <= 1) for (let b = 0; b < 5; b++) placeBranch(x, h + H * (0.4 + tr() * 0.35), z, crx * (0.7 + tr() * 0.6), r * 0.5, tr() * Math.PI * 2, 0.9 + tr() * 0.9);
      if (conical) {
        crownCards(tr, B.cyp, x, cy - cry * 0.5, z, crx, cry * 0.5, 22 + Math.floor(tr() * 8), 1.6 + H * 0.05, tnt);
        if (tier < 4) {
          crownCards(tr, B.cyp, x, cy + cry * 0.15, z, crx * 0.72, cry * 0.45, 16 + Math.floor(tr() * 6), 1.5 + H * 0.045, tnt);
          crownCards(tr, B.cyp, x, cy + cry * 0.7, z, crx * 0.4, cry * 0.35, 8 + Math.floor(tr() * 4), 1.3 + H * 0.04, tnt);
        }
      } else {
        crownCards(tr, B.cyp, x, cy, z, crx, cry, 34 + Math.floor(tr() * 10), 1.7 + H * 0.05, tnt);
        if (tier < 4) crownCards(tr, B.cyp, x, cy - cry * 0.9, z, crx * 0.75, cry * 0.35, 9 + Math.floor(tr() * 5), 1.6 + H * 0.04, tnt);
      }
      mossOn(tr, x, cy - cry * 0.85, z, crx * 0.9, 8 + Math.floor(tr() * 8));
      if (tier === 0 && h < 0.5 && h > -1.2) for (let k = 0; k < 4 + tr() * 6; k++) {
        const a = tr() * Math.PI * 2, rr = 1.5 + tr() * 4;
        const kx = x + Math.cos(a) * rr, kz = z + Math.sin(a) * rr; const kh = grid(kx, kz);
        if (kh > 0.6) continue;
        p.set(kx, kh - 0.1, kz); e.set(0, tr() * 3, 0); q.setFromEuler(e); const kk = 0.6 + tr() * 1.0; s.set(kk, kk + Math.max(0, -kh) * 0.8, kk);
        m.compose(p, q, s); B.knees.add(m);
      }
    };
    const oak = (tr, x, z, h) => {
      const H = 8 + tr() * 7, r = 0.45 + tr() * 0.35;
      placeTrunk(tr, x, h - 0.3, z, H * 0.55, r, 0.15);
      const cy = h + H * 0.62, crx = 4 + tr() * 3.5, cry = H * 0.28;
      if (tier <= 1) for (let b = 0; b < 5; b++) placeBranch(x, h + H * (0.35 + tr() * 0.2), z, crx * (0.8 + tr() * 0.5), r * 0.6, tr() * Math.PI * 2, 1.0 + tr() * 0.7);
      crownCards(tr, B.oak, x, cy, z, crx, cry, 30 + Math.floor(tr() * 8), 2.3 + tr() * 0.9, varyTint(tr, this.oakTint, 0.03, 0.3));
      mossOn(tr, x, cy - cry * 0.7, z, crx * 0.9, 9 + Math.floor(tr() * 8), 1.1);
    };
    const palm = (tr, x, z, h) => {
      const H = 5 + tr() * 7;
      placeTrunk(tr, x, h - 0.2, z, H * 0.8, 0.22 + tr() * 0.1, 0.12);
      if (tier < 4) palmCrown(tr, B.palm, x, h + H * 0.8 - 0.2, z, 11 + Math.floor(tr() * 4), 2.6 + tr() * 1.2, 0.45, 1.7, this.palmTint);
    };
    // exact ground height for trees so every LOD agrees on where a tree stands; the grid is only a cheap prefilter
    let placed = 0;
    const treeRand = () => mulberry32(hash2(ci * 31 + placed, cj * 17 + placed) ^ 0x51ed27);

    // --- cypress: banks & shallows ---
    for (let t = 0; t < 64; t++) {
      const x = x0 + rand() * CELL, z = z0 + rand() * CELL;
      const hg = grid(x, z); if (hg < -1.8 || hg > 2.6) continue;
      const h = hf.compute(x, z);
      if (h < -1.4 || h > 2.2 || excl(x, z)) continue;
      const pWater = 1.0 - Math.abs(h - 0.2) / 1.8; // density strongest right at the waterline
      if (rand() > (pWater * 0.95 + 0.03) * (1 - open) * (1 - open)) continue;
      const spacing = 2.6 + rand() * 2.6;
      if (!free(x, z, spacing)) continue;
      occupy(x, z, spacing);
      cypress(treeRand(), x, z, h); placed++;
    }
    // --- live oaks: higher ground, thicker on the hammocks ---
    for (let t = 0; t < 30; t++) {
      const x = x0 + rand() * CELL, z = z0 + rand() * CELL;
      const hg = grid(x, z); if (hg < 0.5 || hg > 6.4) continue;
      if (rand() < Math.min(0.98, open * 1.25)) continue;
      const h = hf.compute(x, z);
      if (h < 0.9 || h > 6 || excl(x, z)) continue;
      if (nearHome && Math.abs(x - T.riverCenterX(z)) > 170 && rand() < 0.7) continue;
      if (!free(x, z, 7)) continue; occupy(x, z, 7);
      oak(treeRand(), x, z, h); placed++;
    }
    // --- sabal palms ---
    for (let t = 0; t < 12; t++) {
      const x = x0 + rand() * CELL, z = z0 + rand() * CELL;
      const hg = grid(x, z); if (hg < -0.1 || hg > 5.4) continue;
      if (rand() < Math.min(0.95, open * 1.15)) continue;
      const h = hf.compute(x, z);
      if (h < 0.3 || h > 5 || excl(x, z)) continue;
      if (!free(x, z, 3)) continue; occupy(x, z, 3);
      palm(treeRand(), x, z, h); placed++;
    }
    // --- the tower island: cypress at the shore, palms & oaks around the tower ---
    if (T.island.x >= x0 && T.island.x < x0 + CELL && T.island.y >= z0 && T.island.y < z0 + CELL) {
      const ir = mulberry32(4242);
      const ix = T.island.x, iz = T.island.y;
      const toLagoon = Math.atan2(T.lagoon.y - iz, T.lagoon.x - ix);
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2 + ir() * 0.2, rr = 24 + ir() * 9;
        const da = Math.abs(((a - toLagoon) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
        if (da < 1.1) continue; // leave the lagoon-facing shore open so the tower reads from the water
        const x = ix + Math.cos(a) * rr, z = iz + Math.sin(a) * rr; const h = hf.compute(x, z);
        if (h < -1.5 || h > 2.5 || excl(x, z)) continue;
        const H = 12 + ir() * 12;
        cypress(mulberry32(9000 + i), x, z, h, { H, emergent: false, conical: false }); placed++;
      }
      for (let i = 0; i < 14; i++) {
        const a = ir() * Math.PI * 2, rr = 9 + ir() * 14;
        const x = ix + Math.cos(a) * rr, z = iz + Math.sin(a) * rr; const h = hf.compute(x, z);
        if (h < 0.3 || excl(x, z)) continue;
        if (ir() < 0.5) palm(mulberry32(9100 + i), x, z, h); else oak(mulberry32(9200 + i), x, z, h);
      }
      if (tier <= 1) for (let i = 0; i < 40; i++) {
        const a = ir() * Math.PI * 2, rr = 6 + ir() * 22;
        const x = ix + Math.cos(a) * rr, z = iz + Math.sin(a) * rr; const h = hf.compute(x, z);
        if (h < 0.2 || excl(x, z)) continue;
        const sz = 1.0 + ir() * 1.1;
        palmCrown(ir, B.palmetto, x, h - 0.1, z, 7 + Math.floor(ir() * 4), sz, 0.25, 1.2, this.palmTint);
      }
    }
    if (tier > 1) return;
    // --- saw palmetto ---
    for (let t = 0; t < 16; t++) {
      const x = x0 + rand() * CELL, z = z0 + rand() * CELL;
      const h = grid(x, z);
      if (h < 0.5 || h > 6 || excl(x, z)) continue;
      if (rand() < open * 0.6) continue;
      const sz = 1.0 + rand() * 1.1;
      palmCrown(rand, B.palmetto, x, h - 0.1, z, 7 + Math.floor(rand() * 4), sz, 0.25, 1.2, this.palmTint);
    }
    // --- understory shrubs along the banks ---
    for (let t = 0; t < 30; t++) {
      const x = x0 + rand() * CELL, z = z0 + rand() * CELL;
      const h = grid(x, z);
      if (h < 0.1 || h > 3.5 || excl(x, z)) continue;
      if (rand() > 1.1 - h * 0.25) continue;
      if (rand() < Math.min(0.97, open * 1.3)) continue;
      const rr = 1.2 + rand() * 1.8;
      crownCards(rand, B.oak, x, h + rr * 0.7, z, rr, rr * 0.55, 7 + Math.floor(rand() * 5), rr * 1.3, varyTint(rand, this.oakTint, 0.04, 0.4));
    }
    // --- reeds / cattails in the shallows; across the prairie, tall sawgrass in its place ---
    for (let t = 0; t < 700; t++) {
      const x = x0 + rand() * CELL, z = z0 + rand() * CELL;
      const h = grid(x, z);
      if (h < -0.7 || h > 0.35 + open * 0.6 || excl(x, z)) continue;
      if (rand() > 0.35 + Math.max(0, -h) + open * 0.45) continue;
      const saw = rand() < open; // sawgrass: a grass clump card, taller and straw-green
      p.set(x, h - 0.05, z); e.set(0, rand() * Math.PI, 0); q.setFromEuler(e);
      const sz = saw ? 1.3 + rand() * 0.9 : 1.6 + rand() * 1.0; s.set(sz * (saw ? 1.3 : 0.9), sz + Math.max(0, -h), 1); m.compose(p, q, s);
      if (saw) col.setHSL(0.17 + rand() * 0.04, 0.42, 0.3 + rand() * 0.16); else col.setHSL(0.19 + rand() * 0.05, 0.35, 0.22 + rand() * 0.14);
      const batch = saw ? B.grass : B.reed;
      batch.add(m, col);
      e.set(0, e.y + Math.PI / 2, 0); q.setFromEuler(e); m.compose(p, q, s); batch.add(m, col);
    }
    if (tier > 0) return;
    // --- grass ---
    for (let t = 0; t < 360; t++) {
      const x = x0 + rand() * CELL, z = z0 + rand() * CELL;
      const h = grid(x, z);
      if (h < 0.15 || h > 6 || excl(x, z)) continue;
      const nrm = T.normalAt(x, z);
      if (nrm.y < 0.8) continue;
      p.set(x, h - 0.05, z); e.set(0, rand() * Math.PI, 0); q.setFromEuler(e);
      const sz = 0.9 + rand() * 0.9; s.set(sz * 1.2, sz * 0.8, 1); m.compose(p, q, s);
      col.setHSL(0.23 + rand() * 0.06, 0.4, 0.2 + rand() * 0.14); B.grass.add(m, col);
      e.set(0, e.y + Math.PI / 2, 0); q.setFromEuler(e); m.compose(p, q, s); B.grass.add(m, col);
    }
    // --- solid clumps along the banks, where the boat passes close enough to see leaves ---
    if (this.solid.length) for (let t = 0; t < 34; t++) {
      const x = x0 + rand() * CELL, z = z0 + rand() * CELL; const h = grid(x, z);
      if (h < 0.05 || h > 2.5 || excl(x, z)) continue;
      if (h > 0.9 && rand() < 0.65) continue;
      if (T.normalAt(x, z).y < 0.75) continue;
      const k = Math.floor(rand() * this.solid.length);
      p.set(x, h - 0.03, z); e.set(0, rand() * 6.283, 0); q.setFromEuler(e); const sz = 0.75 + rand() * 0.7; s.set(sz, sz, sz); m.compose(p, q, s);
      col.setRGB(0.8 + rand() * 0.3, 0.85 + rand() * 0.3, 0.7 + rand() * 0.3); B['solid' + k].add(m, col);
    }
  }

  // a solid clump (a decimated GLB): the same wind as the cards, bent by height instead of by uv
  addSolid(geo, mat, height) {
    const k = new Kind(geo, mat.map, { pin: 'y', pinH: height, amp: 0.2, fade: [150, 210] }, { shadow: false, alphaTest: 0.01, small: true });
    k.mat.side = THREE.FrontSide; k.mat.color.setHex(0xd8dcc8); this.kinds.push(k); this.solid.push(k);
  }
  // wind for a one-off model (a hero tree at a homestead): sway about its own origin, in metres despite the model's scale
  windMat(mat, yMin, yMax, scale, amp = 0.3) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 }; shader.uniforms.uWind = { value: new THREE.Vector3(1, 1, 0) }; mat.userData.shader = shader;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${WIND_GLSL}`).replace('#include <project_vertex>', `
        vec4 mvPosition = vec4(transformed, 1.0);
        vec3 wBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float hFac = clamp((position.y - ${yMin.toFixed(3)}) / ${(yMax - yMin).toFixed(3)}, 0.0, 1.0);
        vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
        float gW = gust(wBase);
        mvPosition.xyz += (windOffset(wBase, hFac, ${amp.toFixed(3)}, gW) + windBranch(wp, hFac, ${(amp * 0.6).toFixed(3)}, gW)) * ${(1 / scale).toFixed(5)};
        mvPosition = modelViewMatrix * mvPosition;
        gl_Position = projectionMatrix * mvPosition;`);
    };
    mat.customProgramCacheKey = () => `hero-${yMin}-${yMax}-${scale}-${amp}`; mat.needsUpdate = true;
    this.extraMats.push(mat);
  }
  update(t, sunDir, wind) {
    for (const k of this.kinds) k.setTime(t, sunDir, wind);
    for (const m of this.extraMats) { const sh = m.userData.shader; if (sh) { sh.uniforms.uTime.value = t; if (wind) sh.uniforms.uWind.value.copy(wind); } }
    for (const m of [this.trunkMat, this.branchMat]) { const sh = m.userData.shader; if (sh) { sh.uniforms.uTime.value = t; if (wind) sh.uniforms.uWind.value.copy(wind); } }
  }
}
