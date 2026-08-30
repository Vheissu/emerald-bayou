const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

const AVIATION_COVER = Object.freeze({
  blackwater: 0.64,
  cypress: 0.68,
  mangrove: 0.72,
  'dead-river': 0.78,
  emerald: 0.88,
  rookery: 0.92,
  sawgrass: 1.1,
  broad: 1.13,
  prairie: 1.16,
});

export function wantedLevel(attention) {
  const heat = Math.max(0, Number(attention) || 0);
  return heat > 0.04 ? clamp(Math.ceil(heat), 1, 5) : 0;
}

export function pursuitSpeed(attention, playerSpeed) {
  const stars = wantedLevel(attention), speed = Math.max(0, Number(playerSpeed) || 0);
  return clamp(Math.max(12.6 + stars * 0.72, speed * 1.08 + 0.7 + stars * 0.18), 12.6, 19.5);
}

export function pursuitUnitCount(attention) {
  const stars = wantedLevel(attention);
  if (!stars) return 0;
  if (stars >= 4) return 3;
  if (stars >= 2) return 2;
  return 1;
}

export function pursuitAviationAvailable(attention, wind = 0, storm = 0) {
  return wantedLevel(attention) >= 5 && Math.max(0, Number(wind) || 0) < 24 && clamp(Number(storm) || 0, 0, 1) < 0.8;
}

export function pursuitAviationDelay(attention, wind = 0, storm = 0) {
  return pursuitAviationAvailable(attention, wind, storm) ? 9.5 : Infinity;
}

export function pursuitAviationVisualRange(attention, restrictedVisibility = 0, storm = 0, regionId = '') {
  if (wantedLevel(attention) < 5) return 0;
  const cover = AVIATION_COVER[regionId] || 0.86;
  const obscuration = clamp(restrictedVisibility, 0, 1) * 142 + clamp(storm, 0, 1) * 72;
  return clamp(450 * cover - obscuration, 145, 525);
}

export function pursuitAviationVisualHeld(aircraftDistance, beamDistance, attention, restrictedVisibility = 0, storm = 0, regionId = '', active = true) {
  if (!active || wantedLevel(attention) < 5) return false;
  const aircraft = Number(aircraftDistance), beam = Number(beamDistance);
  const beamRadius = clamp(18 - clamp(restrictedVisibility, 0, 1) * 4 - clamp(storm, 0, 1) * 2, 11, 18);
  return (Number.isFinite(aircraft) && aircraft <= pursuitAviationVisualRange(attention, restrictedVisibility, storm, regionId)) || (Number.isFinite(beam) && beam <= beamRadius);
}

export function pursuitBackupDelay(index, attention) {
  const stars = wantedLevel(attention), unit = Math.max(0, Math.floor(Number(index) || 0));
  if (unit === 0 && stars >= 2) return clamp(11.5 - stars * 1.5, 4, 8.5);
  if (unit === 1 && stars >= 4) return stars >= 5 ? 9.5 : 12;
  return Infinity;
}

export function pursuitTactic(role, attention, distance, side = 1, out = {}) {
  const stars = wantedLevel(attention), d = Math.max(0, Number(distance) || 0), flank = side < 0 ? -1 : 1;
  if (role === 1) {
    out.lead = d > 70 ? 2.3 : d > 30 ? 1.55 : 0.7;
    out.fore = d < 18 ? -1.5 : 20 + stars * 2.8;
    out.side = flank * (d < 16 ? 4.5 : 10 + stars * 1.25);
  } else if (role === 2) {
    out.lead = d > 65 ? 1.8 : d > 26 ? 1.08 : 0.42;
    out.fore = d < 17 ? -4 : 10 + stars * 1.8;
    out.side = -flank * (d < 15 ? 3.5 : 8 + stars * 1.15);
  } else {
    const aggressive = stars >= 2;
    out.lead = d > 65 ? 1.25 : d > 24 ? 0.58 : 0.12;
    out.fore = aggressive ? (d < 16 ? -0.4 : 7.5) : (d < 24 ? 8 : 2.5);
    out.side = flank * (aggressive ? (d < 16 ? 1.4 : 4.8) : (d < 24 ? 6.5 : 1.5));
  }
  return out;
}

export function pursuitChannelClosurePlan(role, attention, distance, playerSpeed, visual = true, out = {}) {
  const stars = wantedLevel(attention), d = Math.max(0, Number(distance) || 0), speed = Math.max(0, Number(playerSpeed) || 0);
  out.eligible = role === 2 && stars >= 4 && Boolean(visual) && d >= 34 && d <= 250 && speed >= 4.5;
  out.lead = clamp(74 + speed * 2.1 + Math.max(0, stars - 4) * 8, 84, 124);
  out.duration = stars >= 5 ? 8.2 : 6.8;
  out.cooldown = stars >= 5 ? 10.5 : 13.5;
  out.approachSpeed = clamp(pursuitSpeed(attention, speed) * 1.04, 15.4, 19.5);
  out.setupTimeout = clamp(d / out.approachSpeed * 1.65 + 3, 10, 22);
  return out;
}

export function pursuitUnitCanRam(role, attention) {
  return role === 0 ? wantedLevel(attention) >= 2 : wantedLevel(attention) >= 3;
}

export function pursuitSightSampleCount(distance) {
  return clamp(Math.ceil(Math.max(0, Number(distance) || 0) / 14), 3, 20);
}

// Surface patrols cannot see through islands. The terrain mesh does not contain queryable foliage height, so an
// emergent bank also stands in for the mangrove, cypress and sawgrass screen growing on it. This runs at AI cadence,
// not render cadence, and performs no allocations.
export function pursuitSurfaceLineOfSight(terrain, fromX, fromZ, toX, toZ, waterLevel = 0) {
  if (!terrain || typeof terrain.heightAt !== 'function') return true;
  const dx = toX - fromX, dz = toZ - fromZ, distance = Math.hypot(dx, dz);
  if (!Number.isFinite(distance) || distance <= 18) return true;
  const segments = pursuitSightSampleCount(distance), level = Number.isFinite(waterLevel) ? waterLevel : 0;
  for (let index = 1; index < segments; index++) {
    const along = index / segments, ground = terrain.heightAt(fromX + dx * along, fromZ + dz * along);
    if (Number.isFinite(ground) && ground > level - 0.04) return false;
  }
  return true;
}

export function pursuitVisualHeld(nearestUnitDistance, lostDistance, lineOfSight = true) {
  return lineOfSight !== false && Number.isFinite(nearestUnitDistance) && nearestUnitDistance <= Math.max(0, Number(lostDistance) || 0);
}

// The airboat's fan dominates at throttle, while a fast hull still throws audible spray when the prop is backed off.
// Idle RPM is deliberately below the perceptible threshold so hiding behind a bank with the engine at idle remains
// useful counterplay. These values are gameplay ranges, not claims of measured real-world acoustic performance.
export function pursuitEngineNoise(rpm = 0, speed = 0, throttle = 0, wet = 1) {
  const prop = clamp((Math.max(0, Number(rpm) || 0) - 0.2) / 0.8, 0, 1);
  const thrust = clamp(Number(throttle) || 0, 0, 1), hull = clamp((Math.max(0, Number(speed) || 0) - 2) / 13, 0, 1) * clamp(Number(wet) || 0, 0, 1);
  return clamp(prop * 0.66 + prop * thrust * 0.22 + hull * hull * 0.36, 0, 1);
}

export function pursuitHearingRange(noise, attention, wind = 0, rain = 0, storm = 0, banked = false) {
  const level = clamp(Number(noise) || 0, 0, 1); if (level <= 0.015) return 0;
  const clear = 26 + Math.pow(level, 0.72) * (128 + wantedLevel(attention) * 12);
  const weatherMask = clamp(1 - Math.max(0, Number(wind) || 0) / 115 - clamp(Number(rain) || 0, 0, 1) * 0.19 - clamp(Number(storm) || 0, 0, 1) * 0.12, 0.48, 1);
  return clear * weatherMask * (banked ? 0.78 : 1);
}

export function pursuitHornRange(prolonged = false, wind = 0, rain = 0, storm = 0, banked = false) {
  const clear = prolonged ? 390 : 245;
  const weatherMask = clamp(1 - Math.max(0, Number(wind) || 0) / 150 - clamp(Number(rain) || 0, 0, 1) * 0.13 - clamp(Number(storm) || 0, 0, 1) * 0.08, 0.56, 1);
  return clear * weatherMask * (banked ? 0.82 : 1);
}

export function pursuitSoundContact(distance, range) {
  const d = Number(distance), r = Math.max(0, Number(range) || 0);
  return Number.isFinite(d) && d >= 0 && r > 0 && d <= r;
}

export function pursuitSoundUncertainty(source = 'engine', signal = 0) {
  const strength = clamp(Number(signal) || 0, 0, 1);
  if (source === 'fog horn') return 12 + (1 - strength) * 21;
  if (source === 'horn') return 15 + (1 - strength) * 24;
  return 8 + (1 - strength) * 30;
}

export function pursuitLostProgress(lostFor, dt, visual = false, soundContact = false) {
  const lost = Math.max(0, Number(lostFor) || 0), step = Math.max(0, Number(dt) || 0);
  if (visual) return Math.max(0, lost - step * 2.2);
  return soundContact ? lost : lost + step;
}

export function pursuitSearchRadius(attention, lostFor = 0, soundContact = false, soundUncertainty = 0, fixAge = 0) {
  const stars = wantedLevel(attention), lost = Math.max(0, Number(lostFor) || 0);
  if (soundContact) {
    const uncertainty = Math.max(0, Number(soundUncertainty) || 0), age = Math.max(0, Number(fixAge) || 0);
    return clamp(14 + uncertainty + Math.min(24, age * 6), 22, 84);
  }
  return clamp(22 + stars * 4 + lost * 8.5, 26, 105 + stars * 12);
}

// Surface units divide one last-fix area instead of stacking on the same orbit. Callers pass a retained output
// record during play so coordinating the search does not create garbage at frame cadence.
export function pursuitSearchPlan(role, attention, lostFor = 0, lastHeading = 0, elapsed = 0, centerX = 0, centerZ = 0, soundContact = false, soundUncertainty = 0, fixAge = 0, out = {}) {
  const unit = clamp(Math.floor(Number(role) || 0), 0, 2), stars = wantedLevel(attention);
  const areaRadius = pursuitSearchRadius(attention, lostFor, soundContact, soundUncertainty, fixAge);
  const sweep = areaRadius * (unit === 0 ? 0.34 : unit === 1 ? 0.56 : 0.88);
  const sideScale = unit === 0 ? 0.75 : unit === 1 ? 0.72 : 0.86;
  const forwardBias = areaRadius * (unit === 1 ? 0.15 : unit === 2 ? 0.06 : 0);
  const phaseOffset = unit === 1 ? Math.PI * 2 / 3 : unit === 2 ? -Math.PI * 2 / 3 : 0;
  const rate = (soundContact ? 0.19 : 0.14) * (1 + unit * 0.09);
  const phase = Math.max(0, Number(elapsed) || 0) * rate + phaseOffset;
  const fore = Math.cos(phase) * sweep + forwardBias, side = Math.sin(phase) * sweep * sideScale;
  const heading = Number.isFinite(lastHeading) ? lastHeading : 0;
  const fx = -Math.sin(heading), fz = -Math.cos(heading), rx = Math.cos(heading), rz = -Math.sin(heading);
  const x = Number.isFinite(centerX) ? centerX : 0, z = Number.isFinite(centerZ) ? centerZ : 0;

  out.active = true; out.role = unit; out.sector = unit === 0 ? 'inner fix' : unit === 1 ? 'probable route' : 'outer exits';
  out.targetX = x + fx * fore + rx * side; out.targetZ = z + fz * fore + rz * side;
  out.radius = Math.hypot(fore, side); out.areaRadius = areaRadius;
  out.speed = clamp(7.2 + stars * 0.58 + unit * 0.45 + (soundContact ? 0.5 : 0), 7.5, 12);
  out.holdRadius = unit === 0 ? 6.5 : unit === 1 ? 8.5 : 10.5;
  return out;
}

export function pursuitSearchlightPlan(active, hour = 12, restrictedVisibility = 0, storm = 0, visual = true, role = 0, unitX = 0, unitZ = 0, unitHeading = 0, targetX = 0, targetZ = 0, elapsed = 0, out = {}) {
  const h = ((Number(hour) || 0) % 24 + 24) % 24, restricted = clamp(Number(restrictedVisibility) || 0, 0, 1), weather = clamp(Number(storm) || 0, 0, 1);
  const unit = clamp(Math.floor(Number(role) || 0), 0, 2), night = h < 6.15 || h > 19.1;
  const on = Boolean(active) && (night || restricted > 0.58 || weather > 0.68);
  const x = Number.isFinite(unitX) ? unitX : 0, z = Number.isFinite(unitZ) ? unitZ : 0;
  const tx = Number.isFinite(targetX) ? targetX : x, tz = Number.isFinite(targetZ) ? targetZ : z;
  const heading = Number.isFinite(unitHeading) ? unitHeading : 0, dx = tx - x, dz = tz - z;
  const desired = Math.hypot(dx, dz) > 0.01 ? Math.atan2(-dx, -dz) : heading;
  const phase = Math.max(0, Number(elapsed) || 0);
  const scan = visual
    ? (unit === 1 ? 0.035 : unit === 2 ? -0.035 : 0)
    : Math.sin(phase * (0.41 + unit * 0.035) + unit * 2.1) * (0.12 + restricted * 0.055) + Math.sin(phase * 0.17 + unit * 0.9) * 0.045;
  const worldHeading = Math.atan2(Math.sin(desired + scan), Math.cos(desired + scan));
  const baseLength = unit === 0 ? 44 : unit === 1 ? 40 : 38;

  out.active = on; out.night = night; out.role = unit; out.targeted = Boolean(visual); out.worldLight = on && unit === 0;
  out.worldHeading = worldHeading; out.relativeHeading = Math.atan2(Math.sin(worldHeading - heading), Math.cos(worldHeading - heading));
  out.length = clamp(baseLength * (1 - restricted * 0.19 - weather * 0.1), 28, 46); out.width = unit === 0 ? 7 : 6;
  out.intensity = out.worldLight ? 760 * clamp(1 - weather * 0.22 - restricted * 0.12, 0.55, 1) : 0;
  return out;
}

// Searchlights can extend a low-heat patrol's moonless visual range, but remain a narrow, weather-limited cone.
// The caller supplies the signed bearing error so this helper stays independent of scene objects and allocation-free.
export function pursuitSearchlightVisualHeld(distance, bearingError, restrictedVisibility = 0, storm = 0, active = true) {
  if (!active) return false;
  const d = Number(distance), angle = Number(bearingError);
  if (!Number.isFinite(d) || d < 0 || !Number.isFinite(angle)) return false;
  const restricted = clamp(Number(restrictedVisibility) || 0, 0, 1), weather = clamp(Number(storm) || 0, 0, 1);
  const reach = clamp(145 - restricted * 56 - weather * 26, 72, 145);
  const halfAngle = clamp(0.13 + restricted * 0.012 + weather * 0.008, 0.13, 0.15);
  const wrapped = Math.atan2(Math.sin(angle), Math.cos(angle));
  return d <= reach && Math.abs(wrapped) <= halfAngle;
}

export function pursuitLostDistance(attention, restrictedVisibility = 0, storm = 0, night = 0, moonlight = 0) {
  const stars = wantedLevel(attention), darkness = clamp(Number(night) || 0, 0, 1) * (1 - clamp(Number(moonlight) || 0, 0, 1) * 0.52);
  const concealment = clamp(restrictedVisibility, 0, 1) * 58 + clamp(storm, 0, 1) * 24 + darkness * 80;
  return clamp(165 + stars * 24 - concealment, 78, 275);
}

export function pursuitLostTime(attention, restrictedVisibility = 0) {
  return clamp(4.2 + wantedLevel(attention) * 1.35 - clamp(restrictedVisibility, 0, 1) * 1.4, 3.2, 11);
}

export function pursuitSirenLevel(distance, attention, active = true) {
  if (!active) return 0;
  const d = Number(distance);
  if (!Number.isFinite(d) || d < 0 || d >= 520) return 0;
  const audible = 1 - clamp((d - 22) / 498, 0, 1);
  const heat = 0.76 + wantedLevel(attention) * 0.048;
  return clamp(audible * audible * heat, 0, 1);
}

export function canEscapePursuit(attention, elapsed, lostFor, restrictedVisibility = 0) {
  const minimumRun = 9 + wantedLevel(attention) * 3.2;
  return elapsed >= minimumRun && lostFor >= pursuitLostTime(attention, restrictedVisibility);
}
