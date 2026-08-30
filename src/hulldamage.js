import * as THREE from 'three';

export const MAX_HULL_SCARS = 6;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; };
const round = value => Math.round(value * 10_000) / 10_000;

// These are repair-history fallbacks for old saves whose hull was already damaged before the scar ledger existed.
// Each row is compact save data: centre xyz, outward local xz normal, radius, roll and severity.
const SEEDED_SCARS = Object.freeze([
  Object.freeze([1.22, 0.34, -1.35, 1, 0, 0.24, 0.34, 0.58]),
  Object.freeze([-1.23, 0.27, 0.72, -1, 0, 0.28, -0.48, 0.66]),
  Object.freeze([0.18, 0.39, -2.69, 0.07, -0.998, 0.31, 0.14, 0.74]),
  Object.freeze([-0.42, 0.24, 2.34, -0.18, 0.984, 0.25, -0.28, 0.7]),
  Object.freeze([0.91, 0.45, -2.12, 0.62, -0.785, 0.34, 0.58, 0.84]),
  Object.freeze([-0.96, 0.36, -1.96, -0.67, -0.742, 0.3, -0.66, 0.78]),
]);

export function hullScarTarget(hullHealth = 100) {
  const damage = 100 - clamp(finite(hullHealth, 100), 0, 100);
  return damage <= 15 ? 0 : Math.min(MAX_HULL_SCARS, 1 + Math.floor((damage - 15) / 12));
}

function normalizedScar(raw) {
  const source = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? [raw.x, raw.y, raw.z, raw.nx, raw.nz, raw.size, raw.roll, raw.strength]
      : null;
  if (!source || source.length < 8) return null;
  let nx = finite(source[3]), nz = finite(source[4]), length = Math.hypot(nx, nz);
  const x = clamp(finite(source[0]), -1.34, 1.34), z = clamp(finite(source[2]), -2.82, 2.48);
  if (length < 1e-4) { nx = x / 1.24; nz = z / (z < 0 ? 2.72 : 2.38); length = Math.hypot(nx, nz); }
  if (length < 1e-4) { nx = 0; nz = -1; length = 1; }
  nx /= length; nz /= length;
  return [
    round(x), round(clamp(finite(source[1], 0.32), 0.08, 0.58)), round(z), round(nx), round(nz),
    round(clamp(finite(source[5], 0.24), 0.12, 0.52)),
    round(clamp(finite(source[6]), -Math.PI, Math.PI)),
    round(clamp(finite(source[7], 0.55), 0.15, 1)),
  ];
}

export function normalizeHullScars(value) {
  if (!Array.isArray(value)) return [];
  const normalized = [];
  for (const raw of value.slice(-MAX_HULL_SCARS)) {
    const scar = normalizedScar(raw); if (scar) normalized.push(scar);
  }
  return normalized;
}

export function seededHullScar(index = 0, strength = 0.6) {
  const seed = SEEDED_SCARS[Math.abs(Math.trunc(finite(index))) % SEEDED_SCARS.length].slice();
  seed[7] = round(clamp(finite(strength, seed[7]), 0.15, 1));
  return seed;
}

// A collision normal points from the obstacle back toward the hull. Negating it gives the struck side. Intersecting
// that direction with the hull's asymmetric ellipse places the mark on the real bow/side/stern instead of at random.
export function hullScarFromImpact({
  normalX = 0, normalZ = 0, forwardX = 0, forwardZ = -1, rightX = 1, rightZ = 0,
  severity = 1, serial = 0,
} = {}) {
  const worldNX = finite(normalX), worldNZ = finite(normalZ);
  let localX = -(worldNX * finite(rightX, 1) + worldNZ * finite(rightZ));
  let localZ = worldNX * finite(forwardX) + worldNZ * finite(forwardZ, -1);
  let directionLength = Math.hypot(localX, localZ);
  if (directionLength < 1e-4) return seededHullScar(serial, 0.35 + clamp(finite(severity), 0, 6) * 0.1);
  localX /= directionLength; localZ /= directionLength;
  const zRadius = localZ < 0 ? 2.72 : 2.38;
  const reach = 1 / Math.sqrt(localX * localX / (1.23 * 1.23) + localZ * localZ / (zRadius * zRadius));
  const hit = clamp(finite(severity, 1), 0, 12), key = finite(serial) + hit * 0.731;
  const hash = Math.abs(Math.sin(key * 12.9898 + 4.141) * 43758.5453) % 1;
  return normalizedScar([
    localX * reach, 0.2 + hash * 0.28, localZ * reach, localX, localZ,
    0.17 + Math.sqrt(hit) * 0.065, (hash - 0.5) * 1.55, 0.32 + hit * 0.12,
  ]);
}

export function repairHullScars(scars, hullHealth = 100) {
  const normalized = normalizeHullScars(scars), keep = hullScarTarget(hullHealth);
  return keep ? normalized.slice(-keep) : [];
}

export class HullDamageMaterial {
  constructor(material, profile = {}) {
    this.material = material;
    this.shader = null;
    this.uniforms = {
      count: { value: 0 }, detail: { value: 0 },
      centers: { value: Array.from({ length: MAX_HULL_SCARS }, () => new THREE.Vector4()) },
      frames: { value: Array.from({ length: MAX_HULL_SCARS }, () => new THREE.Vector4()) },
    };
    this.setQuality(profile);
    if (!material?.isMeshStandardMaterial) return;
    const baseCompile = material.onBeforeCompile?.bind(material);
    material.onBeforeCompile = (shader, renderer) => {
      baseCompile?.(shader, renderer);
      shader.uniforms.uHullScarCount = this.uniforms.count;
      shader.uniforms.uHullDamageDetail = this.uniforms.detail;
      shader.uniforms.uHullScarCenters = this.uniforms.centers;
      shader.uniforms.uHullScarFrames = this.uniforms.frames;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vHullDamagePosition;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHullDamagePosition = transformed;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform float uHullScarCount, uHullDamageDetail;
uniform vec4 uHullScarCenters[${MAX_HULL_SCARS}];
uniform vec4 uHullScarFrames[${MAX_HULL_SCARS}];
varying vec3 vHullDamagePosition;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float hullScarMetal = 0.0, hullScarGrime = 0.0;
if (uHullScarCount > 0.5 && uHullDamageDetail > 0.001) {
  for (int i = 0; i < ${MAX_HULL_SCARS}; i++) {
    float scarActive = 1.0 - step(uHullScarCount, float(i) + 0.5);
    vec4 centre = uHullScarCenters[i], frame = uHullScarFrames[i];
    vec3 delta = vHullDamagePosition - centre.xyz;
    vec2 tangent = vec2(-frame.y, frame.x);
    vec2 scarUv = vec2(dot(delta.xz, tangent), delta.y) / max(centre.w, 0.01);
    float cs = cos(frame.z), sn = sin(frame.z);
    scarUv = mat2(cs, -sn, sn, cs) * scarUv;
    float envelope = 1.0 - smoothstep(0.7, 1.04, length(vec2(scarUv.x * 0.66, scarUv.y * 2.15)));
    float mainCut = 1.0 - smoothstep(0.035, 0.095, abs(scarUv.y - sin(scarUv.x * 6.2 + frame.z) * 0.045));
    float splitCut = 1.0 - smoothstep(0.025, 0.075, abs(scarUv.y + 0.18 - scarUv.x * 0.16));
    float metal = max(mainCut, splitCut * 0.72) * envelope * frame.w * scarActive;
    float grime = envelope * (1.0 - smoothstep(0.18, 0.62, abs(scarUv.y))) * (0.28 + frame.w * 0.34) * scarActive;
    hullScarMetal = max(hullScarMetal, metal);
    hullScarGrime = max(hullScarGrime, grime);
  }
  float damageDetail = uHullDamageDetail;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.043, 0.041), hullScarGrime * damageDetail * 0.52);
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.58, 0.57), hullScarMetal * damageDetail * 0.86);
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.9, hullScarGrime * uHullDamageDetail * 0.4);
roughnessFactor = mix(roughnessFactor, 0.26, hullScarMetal * uHullDamageDetail * 0.72);`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.96, hullScarMetal * uHullDamageDetail * 0.72);`);
      this.shader = shader;
    };
    material.customProgramCacheKey = () => 'player-hull-damage-v1';
    material.userData.hullDamage = this;
    material.needsUpdate = true;
  }

  setQuality(profile = {}) {
    this.uniforms.detail.value = clamp(finite(profile.hullDamageDetail), 0, 1);
    return this.uniforms.detail.value;
  }

  setScars(scars) {
    const normalized = normalizeHullScars(scars), count = normalized.length;
    for (let i = 0; i < MAX_HULL_SCARS; i++) {
      const scar = normalized[i];
      if (scar) {
        this.uniforms.centers.value[i].set(scar[0], scar[1], scar[2], scar[5]);
        this.uniforms.frames.value[i].set(scar[3], scar[4], scar[6], scar[7]);
      } else { this.uniforms.centers.value[i].set(0, 0, 0, 0); this.uniforms.frames.value[i].set(0, 0, 0, 0); }
    }
    this.uniforms.count.value = count;
    return count;
  }

  resourceStats() {
    return {
      scars: this.uniforms.count.value, capacity: MAX_HULL_SCARS, detail: this.uniforms.detail.value,
      uniformBytes: MAX_HULL_SCARS * 2 * 4 * 4 + 8, customPrograms: this.material?.isMeshStandardMaterial ? 1 : 0,
      extraObjects: 0, extraGeometries: 0, extraMaterials: this.material?.isMeshStandardMaterial ? 1 : 0, extraTextures: 0, extraDrawCalls: 0, extraRenderTargets: 0,
    };
  }
}
