import { WORLD_HALF } from './heightfield.js';

const TURN_OFFSETS = [0, -0.24, 0.24, -0.48, 0.48, -0.76, 0.76, -1.04, 1.04];
const START_OFFSETS = [0, -0.5, 0.5, -1, 1, -1.5, 1.5, Math.PI];
const lerp = (a, b, t) => a + (b - a) * t;

function attemptRaceCourse({ at, gateCount = 6, waterLevel, heightAt, isBlocked, worldHalf = WORLD_HALF }, startHeading) {
  const startDepth = waterLevel - heightAt(at.x, at.z);
  if (startDepth < 0.66 || startDepth > 6.4 || (isBlocked && isBlocked(at.x, at.z))) return null;
  const gates = [];
  let x = at.x, z = at.z, heading = startHeading, distance = 0;
  for (let i = 0; i < gateCount; i++) {
    const step = 70 + (i % 3) * 7, previousHeading = heading;
    let best = null, bestScore = -Infinity;
    for (const offset of TURN_OFFSETS) {
      const h = previousHeading + offset, nx = x - Math.sin(h) * step, nz = z - Math.cos(h) * step;
      if (Math.max(Math.abs(nx), Math.abs(nz)) > worldHalf - 420) continue;
      let minDepth = Infinity, depthSum = 0, safe = true;
      for (let sample = 1; sample <= 7; sample++) {
        const q = sample / 7, sx = lerp(x, nx, q), sz = lerp(z, nz, q), depth = waterLevel - heightAt(sx, sz);
        if (depth < 0.66 || depth > 6.4 || (isBlocked && isBlocked(sx, sz))) { safe = false; break; }
        minDepth = Math.min(minDepth, depth); depthSum += Math.min(depth, 3.8);
      }
      if (!safe) continue;
      for (let k = 0; k < gates.length - 1; k++) {
        if (Math.hypot(nx - gates[k].x, nz - gates[k].z) < 52) { safe = false; break; }
      }
      if (!safe) continue;
      const score = minDepth * 2.2 + depthSum * 0.18 - Math.abs(offset) * 1.25;
      if (score > bestScore) { bestScore = score; best = { x: nx, z: nz, heading: h, step }; }
    }
    if (!best) return null;
    distance += best.step; heading = best.heading; x = best.x; z = best.z;
    gates.push({ x, z, heading, r: 12, s: distance, label: `Gate ${i + 1} of ${gateCount}` });
  }
  return gates;
}

export function buildRaceCourse(options) {
  for (const offset of START_OFFSETS) {
    const course = attemptRaceCourse(options, options.at.heading + offset); if (course) return course;
  }
  return null;
}
