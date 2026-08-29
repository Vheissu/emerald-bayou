const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const finite = (value, fallback) => { const number = Number(value); return Number.isFinite(number) ? number : fallback; };

export const CHASE_CAMERA_SAMPLES = 12;

// Samples the heightfield along a caller-owned camera boom. The scalar return value lets the
// frame loop resolve its retained vectors without a Raycaster, intersection arrays, or garbage.
export function chaseCameraBoomLimit(query, heightAt) {
  if (!query || typeof heightAt !== 'function') return 1;
  const startX = Number(query.startX), startY = Number(query.startY), startZ = Number(query.startZ);
  const endX = Number(query.endX), endY = Number(query.endY), endZ = Number(query.endZ);
  if (!Number.isFinite(startX) || !Number.isFinite(startY) || !Number.isFinite(startZ)
    || !Number.isFinite(endX) || !Number.isFinite(endY) || !Number.isFinite(endZ)) return 1;

  const dx = endX - startX, dy = endY - startY, dz = endZ - startZ;
  if (dx * dx + dy * dy + dz * dz < 0.0001) return 1;
  const minFraction = clamp(finite(query.minFraction, 0.22), 0.05, 0.95);
  const clearance = Math.max(0.05, finite(query.clearance, 0.9));
  const safetyMargin = clamp(finite(query.safetyMargin, 0.035), 0, 0.25);
  const waterLevel = finite(query.waterLevel, 0);
  const samples = Math.round(clamp(finite(query.samples, CHASE_CAMERA_SAMPLES), 3, 32));
  let previousFraction = minFraction, previousGap = Infinity;

  for (let sample = 0; sample <= samples; sample++) {
    const fraction = minFraction + (1 - minFraction) * sample / samples;
    const x = startX + dx * fraction, y = startY + dy * fraction, z = startZ + dz * fraction;
    const terrainHeight = Number(heightAt(x, z));
    const floor = Number.isFinite(terrainHeight) ? Math.max(waterLevel, terrainHeight) : waterLevel;
    const gap = y - floor - clearance;
    if (gap < 0) {
      if (sample === 0 || !Number.isFinite(previousGap)) return minFraction;
      if (previousGap <= 0) return Math.max(minFraction, previousFraction - safetyMargin);
      const crossing = previousFraction + (fraction - previousFraction) * previousGap / (previousGap - gap);
      return Math.max(minFraction, crossing - safetyMargin);
    }
    previousFraction = fraction; previousGap = gap;
  }
  return 1;
}

// Obstructions win immediately so the camera cannot pass through a bank. Clearance returns at a
// slower exponential rate, preventing the camera from pumping in and out along a ragged shoreline.
export function chaseCameraBoomStep(current, limit, dt, recoveryRate = 2.4) {
  const safeCurrent = clamp(finite(current, 1), 0, 1);
  const safeLimit = clamp(finite(limit, safeCurrent), 0, 1);
  if (safeLimit <= safeCurrent) return safeLimit;
  const seconds = Math.max(0, finite(dt, 0)), rate = Math.max(0, finite(recoveryRate, 2.4));
  return Math.min(safeLimit, safeCurrent + (safeLimit - safeCurrent) * (1 - Math.exp(-seconds * rate)));
}
