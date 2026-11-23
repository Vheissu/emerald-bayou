import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, tileableNoise } from './noise.js';

// Boat-only surface detail for the airboat template. Everything here is built from typed arrays (no canvas or DOM),
// runs once when the shared template is created, and is shared by the player and every traffic airboat.

const BAYER4 = Object.freeze([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Welded square wire mesh: `cells` openings per tile edge, anti-aliased wire edges in level 0. Returns RGBA bytes and
// the exact per-texel coverage used to build the mip chain.
export function grillePixels(size = 64, cells = 4, wire = 1.15) {
  const data = new Uint8Array(size * size * 4), coverage = new Float32Array(size * size), pitch = size / cells;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = (x + 0.5) % pitch, fy = (y + 0.5) % pitch;
    const dx = Math.min(fx, pitch - fx), dy = Math.min(fy, pitch - fy);
    const ax = Math.max(0, Math.min(1, wire + 0.5 - dx)), ay = Math.max(0, Math.min(1, wire + 0.5 - dy));
    const a = Math.max(ax, ay), joint = ax > 0.5 && ay > 0.5;
    // Horizontal strands sit over the vertical ones; welds read slightly brighter, the under-strand slightly darker.
    const shade = joint ? 1 : ay >= ax ? 0.94 : 0.82;
    const i = y * size + x; coverage[i] = a;
    data[i * 4] = 178 * shade; data[i * 4 + 1] = 181 * shade; data[i * 4 + 2] = 174 * shade; data[i * 4 + 3] = Math.round(a * 255);
  }
  return { data, coverage, size };
}

// Thin wire disappears under a plain alpha-tested mip chain. Below level 0 each texel stores its true wire coverage as an
// ordered-dither screen door, so a distant guard keeps reading as a fine grey haze instead of vanishing or going solid.
export function ditheredCoverageMips({ data, coverage, size }) {
  const mipmaps = [{ data, width: size, height: size }];
  let prev = coverage, prevSize = size;
  while (prevSize > 1) {
    const s = prevSize >> 1, next = new Float32Array(s * s), out = new Uint8Array(s * s * 4);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const a = (prev[(2 * y) * prevSize + 2 * x] + prev[(2 * y) * prevSize + 2 * x + 1] + prev[(2 * y + 1) * prevSize + 2 * x] + prev[(2 * y + 1) * prevSize + 2 * x + 1]) / 4;
      const i = y * s + x; next[i] = a;
      const threshold = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      // A 4x4 dither cell no longer fits below 4x4 texels; drop the wire there so far boats keep open ribs, not a solid dome.
      out[i * 4] = 168; out[i * 4 + 1] = 171; out[i * 4 + 2] = 165; out[i * 4 + 3] = s >= 4 && a > threshold ? 255 : 0;
    }
    mipmaps.push({ data: out, width: s, height: s }); prev = next; prevSize = s;
  }
  return mipmaps;
}

export function airboatGrilleTexture() {
  const pixels = grillePixels(64, 4, 1.5), mipmaps = ditheredCoverageMips(pixels);
  const texture = new THREE.DataTexture(pixels.data, pixels.size, pixels.size, THREE.RGBAFormat);
  texture.mipmaps = mipmaps; texture.generateMipmaps = false;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8; texture.needsUpdate = true;
  return texture;
}

// Shared weathering for painted and bare metal parts: tannin grime blotches, downward drip runs, bright scratches.
// Albedo multiplies each material colour; roughness is written to the green channel as three.js expects.
export function wearPixels(size = 256, seed = 4417) {
  const rand = mulberry32(seed);
  const blotch = tileableNoise(size, seed + 1, 4, 3, 0.55), fine = tileableNoise(size, seed + 2, 4, 16, 0.5);
  const grime = new Float32Array(size * size), scratch = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) grime[i] = smooth(0.52, 0.8, blotch[i]) * 0.55;
  for (let k = 0; k < 150; k++) {
    const x0 = Math.floor(rand() * size), y0 = Math.floor(rand() * size), len = 18 + rand() * 110, w = rand() < 0.7 ? 1 : 2, s = 0.12 + rand() * 0.3;
    for (let t = 0; t < len; t++) {
      const fade = (1 - t / len) * s, y = ((y0 - t) % size + size) % size;
      for (let o = 0; o < w; o++) { const i = y * size + (x0 + o) % size; grime[i] = Math.min(1, grime[i] + fade); }
    }
  }
  for (let k = 0; k < 120; k++) {
    const x0 = rand() * size, y0 = rand() * size, len = 6 + rand() * 40, a = rand() * Math.PI, s = 0.35 + rand() * 0.5;
    for (let t = 0; t < len; t++) {
      const x = ((Math.floor(x0 + Math.cos(a) * t) % size) + size) % size, y = ((Math.floor(y0 + Math.sin(a) * t) % size) + size) % size;
      scratch[y * size + x] = Math.max(scratch[y * size + x], s);
    }
  }
  const map = new Uint8Array(size * size * 4), rough = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const g = grime[i], sc = scratch[i] * (1 - g * 0.6), base = 0.84 + fine[i] * 0.16;
    const v = base * (1 - g * 0.5) + sc * 0.22;
    // grime warms toward swamp tannin brown; scratches go back to neutral bright metal
    map[i * 4] = Math.min(255, Math.round(255 * v * (1 + g * 0.04)));
    map[i * 4 + 1] = Math.min(255, Math.round(255 * v * (1 - g * 0.04)));
    map[i * 4 + 2] = Math.min(255, Math.round(255 * v * (1 - g * 0.16)));
    map[i * 4 + 3] = 255;
    const r = Math.max(0.2, Math.min(1, 0.62 + fine[i] * 0.22 + g * 0.3 - sc * 0.35));
    rough[i * 4] = rough[i * 4 + 1] = rough[i * 4 + 2] = Math.round(r * 255); rough[i * 4 + 3] = 255;
  }
  return { map, rough, size };
}

function repeatingDataTexture(data, size, srgb) {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter; texture.generateMipmaps = true;
  if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8; texture.needsUpdate = true;
  return texture;
}

export function airboatWearTextures() {
  const { map, rough, size } = wearPixels();
  return { map: repeatingDataTexture(map, size, true), roughnessMap: repeatingDataTexture(rough, size, false) };
}

// Two-blade laminated prop with real taper, twist and a lens section. Vertex colours carry the nickel leading-edge
// guard and painted tips, so the whole spinning disc stays one mesh and one material.
export function propBladeGeometry({ root = 0.13, tip = 1.18, stations = 14, section = 10 } = {}) {
  const positions = [], colors = [], indices = [], ring = section;
  const wood = [0.36, 0.22, 0.11], guard = [0.66, 0.67, 0.64], paint = [0.9, 0.72, 0.18];
  const p = new THREE.Vector3();
  for (const side of [1, -1]) {
    const base = positions.length / 3;
    for (let s = 0; s <= stations; s++) {
      const t = s / stations, r = root + (tip - root) * t;
      const chord = (0.13 + 0.09 * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5) - 0.07 * t * t) * (t > 0.92 ? Math.sqrt(Math.max(0.05, (1 - t) / 0.08)) * 0.75 + 0.25 : 1);
      const thick = chord * (0.16 - t * 0.1), twist = 0.62 - t * 0.42;
      const cs = Math.cos(twist), sn = Math.sin(twist);
      for (let k = 0; k < ring; k++) {
        const a = k / ring * Math.PI * 2, cx = Math.cos(a) * chord * 0.5, cz = Math.sin(a) * thick * 0.5 * (1 - 0.25 * Math.cos(a));
        p.set(cx * cs - cz * sn, r, cx * sn + cz * cs);
        if (side < 0) p.set(-p.x, -p.y, p.z); // the second blade is the first turned 180 degrees about the shaft
        positions.push(p.x, p.y, p.z);
        const c = t > 0.88 ? paint : Math.cos(a) > 0.72 && t > 0.25 ? guard : wood;
        const grain = 0.92 + 0.08 * Math.sin(t * 41 + k);
        colors.push(c[0] * grain, c[1] * grain, c[2] * grain);
      }
    }
    for (let s = 0; s < stations; s++) for (let k = 0; k < ring; k++) {
      const a = base + s * ring + k, b = base + s * ring + (k + 1) % ring, c = a + ring, d = b + ring;
      indices.push(a, c, b, b, c, d);
    }
    const tipStart = base + stations * ring;
    for (let k = 1; k < ring - 1; k++) indices.push(tipStart, tipStart + k + 1, tipStart + k);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

// Bake every mesh under `container` into one geometry in the container's local space. Callers pass throwaway parts
// built from shared indexed primitives; only the merged result is kept. Parts must not use mirrored (negative) scale.
export function bakeParts(container, keep = ['position', 'normal', 'uv']) {
  container.updateMatrixWorld(true);
  const inverse = container.matrixWorld.clone().invert(), matrix = new THREE.Matrix4(), parts = [];
  container.traverse(object => {
    if (!object.isMesh) return;
    const geometry = object.geometry.clone();
    for (const name of Object.keys(geometry.attributes)) if (!keep.includes(name)) geometry.deleteAttribute(name);
    geometry.applyMatrix4(matrix.multiplyMatrices(inverse, object.matrixWorld)); parts.push(geometry);
  });
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  merged.computeBoundingSphere();
  return merged;
}
