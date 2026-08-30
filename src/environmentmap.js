import * as THREE from 'three';
import { environmentMapBudget } from './renderquality.js';

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

// The direct sun/moon lights keep moving every frame. The PMREM only needs a new broad lighting distribution when
// the dome crosses a meaningful solar or weather band; quantising here prevents an expensive convolution loop.
export function environmentReflectionSignature({ hour = 12, sunAltitude = 1, storm = 0, cover = 0.49 } = {}) {
  const rawHour = Number(hour), wrappedHour = ((Number.isFinite(rawHour) ? rawHour : 12) % 24 + 24) % 24;
  const altitude = Math.max(-1, Math.min(1, Number(sunAltitude) || 0));
  let solar = 'night';
  if (altitude >= -0.07 && altitude < 0.1) solar = wrappedHour < 12 ? 'dawn' : 'dusk';
  else if (altitude >= 0.1 && altitude < 0.48) solar = wrappedHour < 12 ? 'morning' : 'evening';
  else if (altitude >= 0.48) solar = wrappedHour < 11 ? 'late-morning' : wrappedHour < 14 ? 'noon' : 'afternoon';

  // In the procedural sky a lower cover threshold fills more of the dome.
  const coverN = clamp(cover), cloud = coverN < 0.28 ? 'closed' : coverN < 0.44 ? 'overcast' : 'broken';
  const stormN = clamp(storm), weather = stormN < 0.18 ? 'calm' : stormN < 0.62 ? 'storm' : 'severe';
  return `${solar}:${cloud}:${weather}`;
}

function defaultTargetFactory(renderer, skyScene, size) {
  const generator = new THREE.PMREMGenerator(renderer);
  try { return generator.fromScene(skyScene, 0, 0.1, 4000, { size }); }
  finally { generator.dispose(); }
}

export class SkyEnvironmentMap {
  constructor({ renderer, scene, skyScene, skyUniforms, profile, targetFactory = defaultTargetFactory, now = () => performance.now() }) {
    this.renderer = renderer; this.scene = scene; this.skyScene = skyScene; this.skyUniforms = skyUniforms;
    this.profile = profile; this.targetFactory = targetFactory; this.now = now;
    this.target = null; this.targetSize = 0; this.lastSignature = ''; this.lastCaptureMs = -Infinity;
    this.captures = 0; this.replacements = 0; this.disposals = 0; this.failures = 0;
    this.lastReason = ''; this.lastError = ''; this.lastCaptureDurationMs = 0;
  }

  setProfile(profile) {
    const changed = Number(profile?.environmentMapSize) !== Number(this.profile?.environmentMapSize);
    this.profile = profile;
    return changed;
  }

  needsRefresh(state, nowMs = this.now()) {
    const size = Math.max(16, Number(this.profile?.environmentMapSize) || 16);
    if (!this.target || this.targetSize !== size) return true;
    const interval = Math.max(0, Number(this.profile?.environmentMapRefreshSeconds) || 0);
    if (!interval) return false;
    if (environmentReflectionSignature(state) === this.lastSignature) return false;
    return Number(nowMs) - this.lastCaptureMs >= interval * 1000;
  }

  capture(state, reason = 'atmosphere', nowMs = this.now()) {
    const size = Math.max(16, Number(this.profile?.environmentMapSize) || 16);
    const startedAt = this.now(), oldTarget = this.target, replacing = !!oldTarget;
    this.scene.environment = null; this.target = null; this.targetSize = 0;
    if (oldTarget) { oldTarget.dispose(); this.disposals++; }

    // Lightning and rainbows last seconds. Baking either into a map would leave a false flash or coloured arc on
    // glossy surfaces until the next refresh, so suppress only those two uniforms during the synchronous capture.
    const transient = [];
    for (const key of ['flash', 'rainbow']) {
      const uniform = this.skyUniforms?.[key];
      if (uniform) { transient.push([uniform, uniform.value]); uniform.value = 0; }
    }

    let target = null;
    try {
      target = this.targetFactory(this.renderer, this.skyScene, size);
      if (!target?.texture || typeof target.dispose !== 'function') throw new Error('environment capture returned no render target');
      this.target = target; this.targetSize = size; this.scene.environment = target.texture;
      this.lastSignature = environmentReflectionSignature(state); this.lastCaptureMs = Number(nowMs) || 0;
      this.lastReason = reason; this.lastError = ''; this.captures++; if (replacing) this.replacements++;
      return true;
    } catch (error) {
      if (target && typeof target.dispose === 'function') { target.dispose(); this.disposals++; }
      this.failures++; this.lastReason = `${reason}:failed`; this.lastError = String(error?.message || error || 'unknown capture error');
      return false;
    } finally {
      for (const [uniform, value] of transient) uniform.value = value;
      this.lastCaptureDurationMs = Math.max(0, this.now() - startedAt);
    }
  }

  dispose() {
    if (!this.target) return false;
    this.scene.environment = null; this.target.dispose(); this.target = null; this.targetSize = 0; this.disposals++;
    return true;
  }

  resourceStats() {
    const size = Math.max(16, Number(this.profile?.environmentMapSize) || 16), budget = environmentMapBudget(size);
    return {
      profile: this.profile?.id || '', size, targetSize: this.targetSize,
      refreshSeconds: Math.max(0, Number(this.profile?.environmentMapRefreshSeconds) || 0),
      signature: this.lastSignature, captures: this.captures, replacements: this.replacements,
      disposals: this.disposals, failures: this.failures, lastReason: this.lastReason, lastError: this.lastError,
      lastCaptureDurationMs: this.lastCaptureDurationMs,
      ...budget,
      retainedBytes: this.target ? budget.retainedBytes : 0,
    };
  }
}
