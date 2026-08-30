const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const signedSquare = value => value * Math.abs(value);

function projectedCoefficient(x, z, lateralX, lateralZ) {
  const speed = Math.hypot(x, z);
  if (speed < 1e-6) return 0;
  const side = Math.abs(x * lateralX + z * lateralZ) / speed;
  // The open fan cage and driver make the airboat roughly twice as bluff broadside as bow-on.
  return 0.00012 + Math.pow(clamp(side, 0, 1), 1.35) * 0.00016;
}

export function combinedSurfaceWind(baseDirection, baseSpeed = 0, localOutflow = null, out = {}) {
  out.x = 0; out.z = 0; out.speed = 0;
  const speed = clamp(finite(baseSpeed), 0, 60), bx0 = finite(baseDirection?.x), bz0 = finite(baseDirection?.z);
  const baseLength = Math.hypot(bx0, bz0);
  const baseX = baseLength > 1e-6 ? bx0 / baseLength * speed : 0, baseZ = baseLength > 1e-6 ? bz0 / baseLength * speed : 0;
  const windX = baseX + finite(localOutflow?.x), windZ = baseZ + finite(localOutflow?.z), length = Math.hypot(windX, windZ);
  if (length <= 1e-6) return out;
  out.x = windX / length; out.z = windZ / length; out.speed = Math.min(60, length);
  return out;
}

// NASA's drag equation makes aerodynamic force proportional to apparent-air-speed squared. Subtracting the
// no-wind load preserves the boat's established calm-water handling; the remaining force is the weather load only.
// Coefficients are kept in the USCG flat-bottom-skiff leeway range rather than turning hurricane wind into an arcade
// impulse. `out` is caller-owned because this runs every frame.
export function airboatWindLoad(windDirection, windSpeed = 0, boat, out = {}) {
  out.ax = 0; out.az = 0; out.yaw = 0; out.heel = 0; out.apparentSpeed = 0; out.crosswind = 0;
  const speed = clamp(finite(windSpeed), 0, 60), dirX0 = finite(windDirection?.x), dirZ0 = finite(windDirection?.z);
  const dirLength = Math.hypot(dirX0, dirZ0);
  if (!boat?.vel || speed <= 0 || dirLength < 1e-6) return out;

  const dirX = dirX0 / dirLength, dirZ = dirZ0 / dirLength;
  const windX = dirX * speed, windZ = dirZ * speed;
  const velocityX = finite(boat.vel.x), velocityZ = finite(boat.vel.y);
  const heading = finite(boat.heading), lateralX = -Math.cos(heading), lateralZ = Math.sin(heading);
  const airX = windX - velocityX, airZ = windZ - velocityZ;
  const calmX = -velocityX, calmZ = -velocityZ;
  const airSpeed = Math.hypot(airX, airZ), calmSpeed = Math.hypot(calmX, calmZ);
  const airCoefficient = projectedCoefficient(airX, airZ, lateralX, lateralZ);
  const calmCoefficient = projectedCoefficient(calmX, calmZ, lateralX, lateralZ);
  const wet = clamp(finite(boat.wet), 0, 1), exposure = 0.58 + (1 - wet) * 0.42;
  const mass = clamp(1 + Math.max(0, finite(boat.loaded)) * 0.18 + Math.max(0, finite(boat.damageLoad)), 0.55, 3);
  const scale = exposure / mass;

  out.ax = (airX * airSpeed * airCoefficient - calmX * calmSpeed * calmCoefficient) * scale;
  out.az = (airZ * airSpeed * airCoefficient - calmZ * calmSpeed * calmCoefficient) * scale;
  const airSide = airX * lateralX + airZ * lateralZ, calmSide = calmX * lateralX + calmZ * lateralZ;
  const sideLoad = signedSquare(airSide) - signedSquare(calmSide);
  // The fan cage sits aft of the hull's lateral resistance, so a beam wind pushes the stern downwind and points the
  // bow into the wind. The same load produces a small, readable leeward heel under strong gusts.
  out.yaw = clamp(-sideLoad * 0.00022 * scale, -0.42, 0.42);
  out.heel = clamp(-sideLoad * 0.000065 * scale, -0.14, 0.14);
  out.apparentSpeed = airSpeed;
  out.crosswind = airSide;
  return out;
}

export function applyAirboatWind(boat, windDirection, windSpeed = 0, dt = 0, out = {}) {
  const load = airboatWindLoad(windDirection, windSpeed, boat, out), step = clamp(finite(dt), 0, 1 / 15);
  if (!boat?.vel) return load;
  boat.vel.x += load.ax * step; boat.vel.y += load.az * step;
  boat.angVel = finite(boat.angVel) + load.yaw * step;
  boat.windHeel = load.heel; boat.apparentWind = load.apparentSpeed; boat.crosswind = load.crosswind;
  return load;
}

// Search-and-rescue leeway is a long-term drift velocity rather than a one-frame force. Each persistent crew keeps a
// fixed left/right divergence so its track does not jitter as gusts change.
export function vesselLeeway(windDirection, windSpeed = 0, windage = 0.02, divergence = 0, out = {}) {
  out.x = 0; out.z = 0; out.speed = 0;
  const speed = clamp(finite(windSpeed), 0, 60), dirX0 = finite(windDirection?.x), dirZ0 = finite(windDirection?.z);
  const dirLength = Math.hypot(dirX0, dirZ0);
  if (speed <= 0 || dirLength < 1e-6) return out;
  const amount = Math.min(2.25, speed * clamp(finite(windage), 0, 0.05));
  const angle = clamp(finite(divergence), -Math.PI / 3, Math.PI / 3), c = Math.cos(angle), s = Math.sin(angle);
  const dirX = dirX0 / dirLength, dirZ = dirZ0 / dirLength;
  out.x = (dirX * c - dirZ * s) * amount;
  out.z = (dirX * s + dirZ * c) * amount;
  out.speed = amount;
  return out;
}

export function vesselWindHeel(windDirection, windSpeed = 0, heading = 0, scale = 1) {
  const speed = clamp(finite(windSpeed), 0, 60), dirX0 = finite(windDirection?.x), dirZ0 = finite(windDirection?.z);
  const dirLength = Math.hypot(dirX0, dirZ0);
  if (speed <= 0 || dirLength < 1e-6) return 0;
  const lateralX = -Math.cos(finite(heading)), lateralZ = Math.sin(finite(heading));
  const side = (dirX0 / dirLength * lateralX + dirZ0 / dirLength * lateralZ) * speed;
  return clamp(-signedSquare(side) * 0.000065 * clamp(finite(scale), 0, 2), -0.14, 0.14);
}
