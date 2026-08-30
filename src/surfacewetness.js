const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => { const number = Number(value); return Number.isFinite(number) ? number : fallback; };
const smooth = (low, high, value) => { const t = clamp((finite(value) - low) / Math.max(1e-6, high - low)); return t * t * (3 - 2 * t); };

const wetMaterials = new Map();
let materialWetness = -1;
let materialPasses = 0;
let materialWrites = 0;

export function normalizeSurfaceWetness(value, fallback = 0) {
  return clamp(finite(value, fallback));
}

export function surfaceWetnessTarget(rain = 0, hail = 0, fog = 0, daylight = 1) {
  const rainFilm = smooth(0.015, 0.62, rain);
  const hailMelt = smooth(0.08, 0.92, hail) * 0.56;
  const fogDew = smooth(0.00072, 0.0032, fog) * (1 - clamp(finite(daylight))) * 0.42;
  return clamp(Math.max(rainFilm, hailMelt, fogDew));
}

export function surfaceWetnessStep(current, rain, hail, fog, daylight, wind, storm, dt) {
  const from = normalizeSurfaceWetness(current), seconds = clamp(finite(dt), 0, 1);
  if (!seconds) return from;
  const target = surfaceWetnessTarget(rain, hail, fog, daylight);
  const precipitation = clamp(Math.max(finite(rain), finite(hail) * 0.48));
  const sun = clamp(finite(daylight)) * (1 - clamp(finite(storm)) * 0.72);
  const breeze = clamp(finite(wind) / 24);
  const rate = target > from ? 0.42 + precipitation * 2.7 : 0.0012 + sun * 0.007 + breeze * 0.0038;
  return clamp(target + (from - target) * Math.exp(-seconds * rate));
}

// Mirrors the terrain shader's slope and shoreline mask so the visual rule stays deterministic and testable.
export function terrainWetFilm(wetness, worldUp, height, waterLevel = 0) {
  const upward = smooth(0.2, 0.82, worldUp);
  const shoreline = 1 - smooth(finite(waterLevel) + 0.1, finite(waterLevel) + 1.1, height);
  return clamp((normalizeSurfaceWetness(wetness) + shoreline * 0.38) * upward);
}

function wetMaterialDefaults(material, options) {
  const dryRoughness = clamp(finite(material.roughness, 1));
  const metalness = clamp(finite(material.metalness));
  const emissive = material.emissiveIntensity > 0 && material.emissive?.getHex?.() !== 0;
  return {
    r: material.color.r,
    g: material.color.g,
    b: material.color.b,
    roughness: dryRoughness,
    minRoughness: clamp(finite(options.minRoughness, emissive ? dryRoughness : Math.min(dryRoughness, metalness > 0.42 ? 0.16 : 0.3))),
    darken: clamp(finite(options.darken, emissive ? 0 : metalness > 0.42 ? 0.08 : 0.17), 0, 0.35),
  };
}

function applyWetMaterial(material, state, wetness) {
  const film = clamp(wetness), shade = 1 - state.darken * film;
  material.color.setRGB(state.r * shade, state.g * shade, state.b * shade);
  material.roughness = state.roughness + (state.minRoughness - state.roughness) * film;
}

// Only permanent or cache-owned outdoor materials should register here. The registry intentionally does not retain
// streamed one-off materials, and changing color/roughness uniforms never asks Three.js to compile another program.
export function registerWetMaterial(material, options = {}) {
  if (!material?.isMeshStandardMaterial || !material.color || !Number.isFinite(material.roughness)) return material;
  if (!wetMaterials.has(material)) wetMaterials.set(material, wetMaterialDefaults(material, options));
  applyWetMaterial(material, wetMaterials.get(material), Math.max(0, materialWetness));
  return material;
}

export function unregisterWetMaterial(material) {
  const state = wetMaterials.get(material); if (!state) return false;
  applyWetMaterial(material, state, 0); wetMaterials.delete(material); return true;
}

export function setGlobalSurfaceWetness(value) {
  const wetness = Math.round(normalizeSurfaceWetness(value) * 512) / 512;
  if (wetness === materialWetness) return 0;
  materialWetness = wetness; materialPasses++;
  for (const [material, state] of wetMaterials) { applyWetMaterial(material, state, wetness); materialWrites++; }
  return wetMaterials.size;
}

export function surfaceWetMaterialStats() {
  return { registered: wetMaterials.size, wetness: Math.max(0, materialWetness), passes: materialPasses, writes: materialWrites, textures: 0, programs: 0 };
}
