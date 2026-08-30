const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const smoothstep = (edge0, edge1, value) => {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const WRANGLER_ASSIST_SECONDS = 11;
export const WRANGLER_WAKE_RELEASE = 0.72;

// The helpful position is outside the animal's working circle, but close enough to
// keep another boat from entering the cut. Speed is metres per second.
export function wranglerStationQuality(distance, speed, airborne = false) {
  if (airborne) return 0;
  const d = Math.max(0, Number(distance) || 0), pace = Math.max(0, Number(speed) || 0);
  const outside = smoothstep(12, 17, d), inside = 1 - smoothstep(30, 35, d);
  const idle = 1 - smoothstep(1.25, 2.6, pace);
  return clamp(outside * inside * idle);
}

export function wranglerAssistStep(progress, dt, distance, speed, airborne = false) {
  const step = clamp(dt, 0, 0.25), quality = wranglerStationQuality(distance, speed, airborne);
  const change = quality > 0.02 ? step * quality / WRANGLER_ASSIST_SECONDS : -step / 7.5;
  return clamp((Number(progress) || 0) + change);
}

// Wake danger combines the hull's speed with how quickly it is closing on the animal.
// A jump landing inside the capture circle is dangerous even before the hull settles.
export function wranglerWakeThreat(distance, speed, closingSpeed = 0, airborne = false) {
  const d = Math.max(0, Number(distance) || 0), pace = Math.max(0, Number(speed) || 0), closing = Math.max(0, Number(closingSpeed) || 0);
  if (d >= 42) return 0;
  const proximity = 1 - smoothstep(12, 42, d);
  const motion = smoothstep(1.2, 8.5, pace), approach = smoothstep(0.4, 6, closing);
  const landing = airborne && d < 30 ? 0.28 * (1 - smoothstep(20, 30, d)) : 0;
  return clamp(proximity * (motion * 0.78 + approach * 0.3) + landing);
}

export function wranglerWakeStep(risk, dt, threat) {
  const step = clamp(dt, 0, 0.25), danger = clamp(threat);
  const change = danger > 0.08 ? step * danger * 1.7 : -step * 0.28;
  return clamp((Number(risk) || 0) + change);
}
