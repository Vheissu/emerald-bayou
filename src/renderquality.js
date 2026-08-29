// The map and simulation stay identical at every tier. These profiles only budget GPU-heavy screen-space work.
// Cinematic is the existing presentation; lower tiers are selected from conservative hardware signals and only
// reached at runtime after sustained missed frame budgets.
export const MAX_DEVICE_PIXEL_RATIO = 2;
export const MAX_DRAW_PIXELS = 3_000_000;
export const FOUR_SAMPLE_MAX_PIXELS = 1_600_000;

export const QUALITY_PROFILES = Object.freeze([
  Object.freeze({
    id: 'fallback', label: 'Fallback', maxDrawPixels: 800_000, maxDevicePixelRatio: 1,
    msaaSamples: 0, shadowMapSize: 1024, reflectionScale: 0.25, reflectionInterval: 3,
    reflectionMipmaps: false, bloom: false, finalPass: false,
  }),
  Object.freeze({
    id: 'performance', label: 'Performance', maxDrawPixels: 1_250_000, maxDevicePixelRatio: 1.25,
    msaaSamples: 0, shadowMapSize: 1024, reflectionScale: 0.32, reflectionInterval: 2,
    reflectionMipmaps: false, bloom: false, finalPass: false,
  }),
  Object.freeze({
    id: 'balanced', label: 'Balanced', maxDrawPixels: 2_000_000, maxDevicePixelRatio: 1.6,
    msaaSamples: 2, shadowMapSize: 2048, reflectionScale: 0.4, reflectionInterval: 2,
    reflectionMipmaps: false, bloom: true, finalPass: false,
  }),
  Object.freeze({
    id: 'cinematic', label: 'Cinematic', maxDrawPixels: MAX_DRAW_PIXELS, maxDevicePixelRatio: MAX_DEVICE_PIXEL_RATIO,
    msaaSamples: 4, shadowMapSize: 4096, reflectionScale: 0.5, reflectionInterval: 1,
    reflectionMipmaps: true, bloom: true, finalPass: true,
  }),
]);

export function qualityProfile(level) {
  const index = Math.max(0, Math.min(QUALITY_PROFILES.length - 1, Math.round(Number.isFinite(level) ? level : QUALITY_PROFILES.length - 1)));
  return QUALITY_PROFILES[index];
}

export function initialQualityLevel({ deviceMemory, hardwareConcurrency, maxTextureSize, saveData = false } = {}) {
  if (saveData || (Number.isFinite(deviceMemory) && deviceMemory <= 2) || (Number.isFinite(hardwareConcurrency) && hardwareConcurrency <= 2) || (Number.isFinite(maxTextureSize) && maxTextureSize <= 2048)) return 0;
  if ((Number.isFinite(deviceMemory) && deviceMemory <= 4) || (Number.isFinite(hardwareConcurrency) && hardwareConcurrency <= 4) || (Number.isFinite(maxTextureSize) && maxTextureSize <= 4096)) return 1;
  if ((Number.isFinite(hardwareConcurrency) && hardwareConcurrency <= 6) || (Number.isFinite(maxTextureSize) && maxTextureSize <= 8192)) return 2;
  return QUALITY_PROFILES.length - 1;
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

  resetWindow() { this.elapsed = 0; this.frames = 0; this.slowFrames = 0; }

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
    if (!active || !Number.isFinite(frameSeconds) || frameSeconds <= 0 || frameSeconds > 0.2) { this.resetWindow(); return null; }
    this.cooldown = Math.max(0, this.cooldown - frameSeconds);
    this.elapsed += frameSeconds; this.frames++;
    if (frameSeconds > 1 / 45) this.slowFrames++;
    if (this.elapsed < this.sampleSeconds) return null;

    const averageMs = this.elapsed / Math.max(1, this.frames) * 1000;
    const slowRatio = this.slowFrames / Math.max(1, this.frames);
    this.lastSample = { averageMs, slowRatio, frames: this.frames };
    this.resetWindow();

    let direction = 0;
    if (this.cooldown <= 0 && this.level > this.minLevel && (averageMs > 23.5 || slowRatio > 0.32)) {
      direction = -1; this.headroomWindows = 0; this.cooldown = 4;
    } else if (averageMs < 15.5 && slowRatio < 0.04) {
      this.headroomWindows++;
      if (this.cooldown <= 0 && this.level < this.maxLevel && this.headroomWindows >= 4) {
        direction = 1; this.headroomWindows = 0; this.cooldown = 18;
      }
    } else this.headroomWindows = 0;

    if (!direction) return null;
    this.level += direction;
    return { level: this.level, profile: this.profile, direction, averageMs, slowRatio };
  }

  snapshot() {
    return { level: this.level, profile: this.profile.id, cooldown: this.cooldown, lastSample: this.lastSample };
  }
}
