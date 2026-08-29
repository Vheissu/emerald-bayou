// The map, physics and living-world simulation stay identical at every tier. These profiles budget GPU presentation:
// screen-space attachments, reflections, shadows and the visual wake texture. Cinematic is the full presentation;
// lower tiers are selected from conservative hardware signals or reached after sustained missed frame budgets.
export const MAX_DEVICE_PIXEL_RATIO = 2;
export const MAX_DRAW_PIXELS = 3_000_000;
export const FOUR_SAMPLE_MAX_PIXELS = 1_600_000;

export const QUALITY_PROFILES = Object.freeze([
  Object.freeze({
    id: 'fallback', label: 'Fallback', maxDrawPixels: 800_000, maxDevicePixelRatio: 1,
    msaaSamples: 0, shadowMapSize: 1024, reflectionScale: 0.25, reflectionInterval: 3,
    reflectionMipmaps: false, wakeResolution: 192, wakeMaxStamps: 10, surfaceMist: 0, precipitationRipples: 0, fireflyPoints: 0, bloom: false, finalPass: false,
  }),
  Object.freeze({
    id: 'performance', label: 'Performance', maxDrawPixels: 1_250_000, maxDevicePixelRatio: 1.25,
    msaaSamples: 0, shadowMapSize: 1024, reflectionScale: 0.32, reflectionInterval: 2,
    reflectionMipmaps: false, wakeResolution: 256, wakeMaxStamps: 14, surfaceMist: 0, precipitationRipples: 0, fireflyPoints: 72, bloom: false, finalPass: false,
  }),
  Object.freeze({
    id: 'balanced', label: 'Balanced', maxDrawPixels: 2_000_000, maxDevicePixelRatio: 1.6,
    msaaSamples: 2, shadowMapSize: 2048, reflectionScale: 0.4, reflectionInterval: 2,
    reflectionMipmaps: false, wakeResolution: 384, wakeMaxStamps: 18, surfaceMist: 0.65, precipitationRipples: 0.62, fireflyPoints: 153, bloom: true, finalPass: false,
  }),
  Object.freeze({
    id: 'cinematic', label: 'Cinematic', maxDrawPixels: MAX_DRAW_PIXELS, maxDevicePixelRatio: MAX_DEVICE_PIXEL_RATIO,
    msaaSamples: 4, shadowMapSize: 4096, reflectionScale: 0.5, reflectionInterval: 1,
    reflectionMipmaps: true, wakeResolution: 512, wakeMaxStamps: 20, surfaceMist: 1, precipitationRipples: 1, fireflyPoints: 243, bloom: true, finalPass: true,
  }),
]);

export function qualityProfile(level) {
  const index = Math.max(0, Math.min(QUALITY_PROFILES.length - 1, Math.round(Number.isFinite(level) ? level : QUALITY_PROFILES.length - 1)));
  return QUALITY_PROFILES[index];
}

// Thread count is a poor proxy for a decade-old desktop GPU. These narrow renderer-name matches only cap known
// low-end families; unknown and modern discrete GPUs retain the existing high-end path.
export function gpuQualityCeiling(rendererName = '') {
  const name = String(rendererName || '').toLowerCase();
  if (!name) return QUALITY_PROFILES.length - 1;
  if (/swiftshader|llvmpipe|softpipe|software raster|microsoft basic render|vmware/.test(name)) return 0;

  if (/intel.*(?:hd graphics|uhd graphics|iris|iris pro|iris plus)/.test(name)) {
    const model = name.match(/(?:hd graphics|uhd graphics|iris(?: pro| plus)?(?: graphics)?)\s*(\d{3,4})/);
    if (model && model[1].length >= 4) return 1; // HD/Iris 4000-6200 generation, common in 2012-2015 machines
    return 2;
  }
  if (/geforce\s+(?:8|9)\d{3}m?\b/.test(name)) return 1;
  const geforce = name.match(/geforce\s+(gtx|gt)\s*(\d{3,4})/);
  if (geforce) {
    const model = Number(geforce[2]);
    if (geforce[1] === 'gt' || model <= 750) return 1;
    if (model <= 1050) return 2;
  }
  if (/radeon\s+hd\s+\d|firepro\s+[dmvw]\d/.test(name)) return 1;
  if (/radeon\s+(?:r[579]|pro\s+[45]\d\d)\b/.test(name)) return 2;
  if (/mali-(?:4|t6|t7)|adreno.*\b[34]\d\d\b/.test(name)) return 1;
  return QUALITY_PROFILES.length - 1;
}

export function webglRendererName(gl) {
  if (!gl) return '';
  try {
    const debug = gl.getExtension?.('WEBGL_debug_renderer_info');
    return String(gl.getParameter(debug?.UNMASKED_RENDERER_WEBGL || gl.RENDERER) || '');
  } catch (error) { return ''; }
}

export function initialQualityLevel({ deviceMemory, hardwareConcurrency, maxTextureSize, saveData = false, gpuRenderer = '' } = {}) {
  let level = QUALITY_PROFILES.length - 1;
  if (saveData || (Number.isFinite(deviceMemory) && deviceMemory <= 2) || (Number.isFinite(hardwareConcurrency) && hardwareConcurrency <= 2) || (Number.isFinite(maxTextureSize) && maxTextureSize <= 2048)) level = 0;
  else if ((Number.isFinite(deviceMemory) && deviceMemory <= 4) || (Number.isFinite(hardwareConcurrency) && hardwareConcurrency <= 4) || (Number.isFinite(maxTextureSize) && maxTextureSize <= 4096)) level = 1;
  else if ((Number.isFinite(hardwareConcurrency) && hardwareConcurrency <= 6) || (Number.isFinite(maxTextureSize) && maxTextureSize <= 8192)) level = 2;
  level = Math.min(level, gpuQualityCeiling(gpuRenderer));
  // Privacy-masked renderer strings are common, and texture limits alone cannot distinguish a modern discrete GPU
  // from decade-old integrated hardware. Start that ambiguous 8 GB / 8-thread class at Balanced; the adaptive
  // controller can still promote it after sustained clean frame windows.
  const detailedRenderer = /intel|nvidia|geforce|quadro|amd|radeon|apple\s+m\d|mali|adreno|powervr|swiftshader|llvmpipe|arc\s+[a-z]?\d|rtx|gtx/i.test(String(gpuRenderer || ''));
  const strongHost = Number.isFinite(deviceMemory) && deviceMemory >= 8 && Number.isFinite(hardwareConcurrency) && hardwareConcurrency >= 12 && Number.isFinite(maxTextureSize) && maxTextureSize >= 16384;
  if (level === QUALITY_PROFILES.length - 1 && !detailedRenderer && !strongHost) level--;
  return level;
}

export function pixelRatioFor(width, height, devicePixelRatio = 1, maxDrawPixels = MAX_DRAW_PIXELS, maxDevicePixelRatio = MAX_DEVICE_PIXEL_RATIO) {
  const cssPixels = Math.max(1, width) * Math.max(1, height);
  const native = Math.min(Math.max(0.1, maxDevicePixelRatio), Math.max(0.1, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
  const budget = Math.sqrt(Math.max(1, maxDrawPixels) / cssPixels);
  return Math.min(native, budget);
}

export function msaaSamplesFor(width, height, maxSamples = 4) {
  if (!Number.isFinite(maxSamples) || maxSamples <= 0) return 0;
  const preferred = Math.max(1, width) * Math.max(1, height) > FOUR_SAMPLE_MAX_PIXELS ? 2 : 4;
  return Math.min(Math.floor(maxSamples), preferred);
}

export class AdaptiveQualityController {
  constructor({ initialLevel = QUALITY_PROFILES.length - 1, minLevel = 0, maxLevel = QUALITY_PROFILES.length - 1, sampleSeconds = 2.5 } = {}) {
    this.minLevel = Math.max(0, Math.min(QUALITY_PROFILES.length - 1, minLevel));
    this.maxLevel = Math.max(this.minLevel, Math.min(QUALITY_PROFILES.length - 1, maxLevel));
    this.level = Math.max(this.minLevel, Math.min(this.maxLevel, initialLevel));
    this.sampleSeconds = Math.max(1, sampleSeconds);
    this.cooldown = 0; this.headroomWindows = 0; this.lastSample = null;
    this.resetWindow();
  }

  get profile() { return qualityProfile(this.level); }

  resetWindow() { this.elapsed = 0; this.frames = 0; this.slowFrames = 0; this.stallFrames = 0; }

  reset() { this.resetWindow(); this.headroomWindows = 0; }

  configure({ initialLevel = this.level, minLevel = this.minLevel, maxLevel = this.maxLevel } = {}) {
    const last = QUALITY_PROFILES.length - 1;
    this.minLevel = Math.max(0, Math.min(last, Math.round(Number.isFinite(minLevel) ? minLevel : 0)));
    this.maxLevel = Math.max(this.minLevel, Math.min(last, Math.round(Number.isFinite(maxLevel) ? maxLevel : last)));
    this.level = Math.max(this.minLevel, Math.min(this.maxLevel, Math.round(Number.isFinite(initialLevel) ? initialLevel : this.level)));
    this.cooldown = 0; this.lastSample = null; this.reset();
    return this.profile;
  }

  observe(frameSeconds, active = true) {
    if (!active || !Number.isFinite(frameSeconds) || frameSeconds <= 0) { this.resetWindow(); return null; }
    const sampledSeconds = Math.min(frameSeconds, 0.2);
    this.cooldown = Math.max(0, this.cooldown - sampledSeconds);
    this.elapsed += sampledSeconds; this.frames++;
    if (frameSeconds > 1 / 45) this.slowFrames++;
    if (frameSeconds > 0.2) this.stallFrames++;
    if (this.elapsed < this.sampleSeconds) return null;

    const averageMs = this.elapsed / Math.max(1, this.frames) * 1000;
    const slowRatio = this.slowFrames / Math.max(1, this.frames);
    const stallFrames = this.stallFrames;
    this.lastSample = { averageMs, slowRatio, stallFrames, frames: this.frames };
    this.resetWindow();

    let direction = 0;
    if (this.cooldown <= 0 && this.level > this.minLevel && (averageMs > 23.5 || slowRatio > 0.32 || stallFrames >= 2)) {
      direction = -1; this.headroomWindows = 0; this.cooldown = 4;
    } else if (averageMs < 15.5 && slowRatio < 0.04) {
      this.headroomWindows++;
      if (this.cooldown <= 0 && this.level < this.maxLevel && this.headroomWindows >= 4) {
        direction = 1; this.headroomWindows = 0; this.cooldown = 18;
      }
    } else this.headroomWindows = 0;

    if (!direction) return null;
    this.level += direction;
    return { level: this.level, profile: this.profile, direction, averageMs, slowRatio, stallFrames };
  }

  snapshot() {
    return { level: this.level, profile: this.profile.id, cooldown: this.cooldown, lastSample: this.lastSample };
  }
}
