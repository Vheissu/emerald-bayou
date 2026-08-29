const lerp = (a, b, t) => a + (b - a) * t;

// Pick a shallow shelf with an unobstructed run back to water deep enough to float the skiff.
// Kept browser-neutral so the full procedural map can be sampled in headless verification.
export function findGroundingSite({ terrain, isBlocked = () => false, waterLevel = 0, deepSpot, random = Math.random, nearby = false }) {
  const min = nearby ? 46 : 125, max = nearby ? 72 : 285, side = nearby ? 48 : 190;
  let best = null, bestScore = Infinity;
  for (let anchor = 0; anchor < 10; anchor++) {
    const deep = deepSpot(min, max, side); if (!deep) continue;
    const deepDepth = waterLevel - terrain.heightAt(deep.x, deep.z); if (deepDepth < 0.95) continue;
    const phase = random() * Math.PI * 2;
    for (let i = 0; i < 16; i++) {
      const a = phase + i * Math.PI / 8, dx = Math.cos(a), dz = Math.sin(a);
      for (const distance of [14, 19, 25, 32, 40, 49]) {
        const x = deep.x + dx * distance, z = deep.z + dz * distance;
        if (isBlocked(x, z)) continue;
        const ground = terrain.heightAt(x, z), clearance = waterLevel - ground;
        if (clearance < 0.06 || clearance > 0.43) continue;
        const mx = lerp(x, deep.x, 0.52), mz = lerp(z, deep.z, 0.52);
        if (isBlocked(mx, mz) || waterLevel - terrain.heightAt(mx, mz) < 0.34) continue;
        const clearX = deep.x - dx * 8, clearZ = deep.z - dz * 8;
        if (isBlocked(clearX, clearZ) || waterLevel - terrain.heightAt(clearX, clearZ) < 0.95) continue;
        const score = Math.abs(clearance - 0.22) + Math.abs(distance - 25) * 0.006;
        if (score >= bestScore) continue;
        bestScore = score;
        const heading = Math.atan2(-dx, -dz), approachDistance = Math.min(distance - 5, 11);
        best = { x, z, ground, clearance, heading, clearX, clearZ, approachX: x - dx * approachDistance, approachZ: z - dz * approachDistance };
      }
    }
    if (bestScore < 0.035) break;
  }
  return best;
}
