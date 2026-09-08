const tiltLimit = 0.2;
const limitTilt = value => Math.max(-tiltLimit, Math.min(tiltLimit, value));

// Sample the actual surface under a small boat's centre, bow, stern and beam. Results live on the retained agent;
// steering heel, wind lean, planing trim and impact kick remain separate, owned by their existing controllers.
export function sampleHullSurface(out, field, x, z, heading, t, receiver = out, halfLength = 2.05, halfBeam = 0.74) {
  const sample = typeof field === 'function' ? field : field.boatWaveHeight || field.waveHeight;
  const fx = -Math.sin(heading), fz = -Math.cos(heading), rx = -fz, rz = fx;
  const center = sample.call(field, x, z, t, receiver);
  const bow = sample.call(field, x + fx * halfLength, z + fz * halfLength, t, receiver);
  const stern = sample.call(field, x - fx * halfLength, z - fz * halfLength, t, receiver);
  const right = sample.call(field, x + rx * halfBeam, z + rz * halfBeam, t, receiver);
  const left = sample.call(field, x - rx * halfBeam, z - rz * halfBeam, t, receiver);
  out.waterHeight = Number.isFinite(center) ? center : Number.isFinite(out.waterHeight) ? out.waterHeight : 0;
  out.waterPitch = Number.isFinite(bow) && Number.isFinite(stern) ? limitTilt(Math.atan2(bow - stern, halfLength * 2)) : 0;
  out.waterRoll = Number.isFinite(right) && Number.isFinite(left) ? limitTilt(Math.atan2(right - left, halfBeam * 2)) : 0;
  return out;
}
