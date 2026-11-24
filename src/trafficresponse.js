const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));

export function pursuitYieldStrength(active, attention, distance, playerSpeed, kind = 'john', enforcement = false) {
  if (!active || enforcement) return 0;
  const d = Number(distance);
  if (!Number.isFinite(d) || d < 0) return 0;
  const reach = kind === 'canoe' ? 210 : 180;
  if (d >= reach) return 0;
  const proximity = clamp((reach - d) / (reach * 0.72));
  const speedUrgency = clamp((Math.max(0, Number(playerSpeed) || 0) - 2) / 14);
  const heatUrgency = clamp(Math.max(0, Number(attention) || 0) / 5);
  const vulnerability = kind === 'canoe' ? 1 : 0.86;
  return clamp(proximity * (0.5 + speedUrgency * 0.24 + heatUrgency * 0.2) * vulnerability);
}

export function pursuitYieldSpeedScale(strength, kind = 'john') {
  const yieldStrength = clamp(Number(strength) || 0);
  return 1 - yieldStrength * (kind === 'canoe' ? 0.86 : 0.58);
}

export function hornYieldStrength(distance, aheadDot, closingSpeed, kind = 'john', prolonged = false) {
  const d = Number(distance), ahead = Number(aheadDot), closing = Math.max(0, Number(closingSpeed) || 0);
  if (!Number.isFinite(d) || d < 0 || !Number.isFinite(ahead)) return 0;
  const reach = prolonged ? (kind === 'canoe' ? 260 : 230) : (kind === 'canoe' ? 200 : 175);
  if (d >= reach || ahead <= -0.15) return 0;
  const proximity = clamp((reach - d) / (reach * 0.72));
  const bowSector = clamp((ahead + 0.15) / 1.15);
  const closingUrgency = clamp((closing - 0.8) / 13);
  const vulnerability = kind === 'canoe' ? 1.14 : 1;
  return clamp(proximity * bowSector * (0.22 + closingUrgency * 0.62) * vulnerability);
}

export function hornYieldSpeedScale(strength, kind = 'john') {
  const yieldStrength = clamp(Number(strength) || 0);
  return 1 - yieldStrength * (kind === 'canoe' ? 0.72 : 0.46);
}

export function createClosePass() {
  return { strength: 0, notice: 0, hold: 0, bearing: 0, closest: Infinity, timeToClosest: Infinity };
}

export function clearClosePass(pass) {
  pass.strength = 0; pass.notice = 0; pass.hold = 0; pass.bearing = 0;
  pass.closest = Infinity; pass.timeToClosest = Infinity;
}

export function stepClosePass(pass, boat, player, wake, dt, blocked = false) {
  if (blocked) {
    clearClosePass(pass);
    return 0;
  }
  const dx = player.pos.x - boat.x, dz = player.pos.y - boat.z;
  const distance = Math.hypot(dx, dz);
  const forwardX = -Math.sin(boat.heading), forwardZ = -Math.cos(boat.heading);
  const velocityX = (player.vel?.x ?? -Math.sin(player.heading) * player.speed) - forwardX * boat.speed;
  const velocityZ = (player.vel?.y ?? -Math.cos(player.heading) * player.speed) - forwardZ * boat.speed;
  const relativeSpeedSq = velocityX * velocityX + velocityZ * velocityZ;
  const dot = dx * velocityX + dz * velocityZ;
  const approaching = distance < 108 && dot < 0 && relativeSpeedSq > 0.25;
  pass.timeToClosest = approaching ? -dot / relativeSpeedSq : Infinity;
  pass.closest = approaching ? Math.hypot(dx + velocityX * pass.timeToClosest, dz + velocityZ * pass.timeToClosest) : Infinity;
  const lightCraft = boat.kind === 'canoe' || boat.kind === 'skiff';
  const closing = -(dot / Math.max(1, distance));
  const fast = clamp((Math.abs(player.speed) - 3) / 10);
  const clear = (lightCraft ? 15 : 11) + fast * 4;
  const prediction = approaching && pass.timeToClosest < 6.5 && closing > 1.4 && pass.closest < clear
    ? clamp(1 - pass.closest / clear) * (0.48 + fast * 0.52) * clamp((7.2 - pass.timeToClosest) / 4.5)
    : 0;
  const passing = distance < clear
    ? clamp(1 - distance / clear) * Math.max(fast, clamp((relativeSpeedSq - 9) / 100)) * 0.85 : 0;
  const impact = clamp((Math.abs(wake) - 0.018) / (lightCraft ? 0.16 : 0.21));
  const risk = Math.max(prediction, passing, impact);
  pass.notice = risk > 0.12 ? Math.min(1, pass.notice + dt) : Math.max(0, pass.notice - dt * 2);
  if (risk > 0.12) {
    const localX = Math.cos(boat.heading) * dx - Math.sin(boat.heading) * dz;
    pass.bearing = Math.atan2(localX, forwardX * dx + forwardZ * dz);
  }
  const urgent = (prediction > 0.38 && (distance < 16 || pass.timeToClosest < 1.4)) || impact > 0.42;
  const noticed = pass.notice >= (boat.passReactionDelay ?? 0.26);
  if (urgent || (noticed && risk > 0.12)) pass.hold = lightCraft ? 1.8 : 1.3;
  else pass.hold = Math.max(0, pass.hold - dt);
  const target = Math.max(pass.hold > 0 ? 0.26 : 0, noticed || urgent ? risk : 0);
  pass.strength += (target - pass.strength) * (1 - Math.exp(-dt * (target > pass.strength ? 8 : 2.4)));
  return pass.strength;
}

// Existing terrain and navigation rules still choose the course. When none has
// priority, favor the dry-land-safe probe with more room to pass the player astern.
export function closePassProbeScore(dx, dz, forwardX, forwardZ, courseSpeed, playerVX, playerVZ, strength) {
  const dvx = playerVX - forwardX * courseSpeed, dvz = playerVZ - forwardZ * courseSpeed;
  const closing = dx * dvx + dz * dvz;
  const time = clamp(-closing / Math.max(0.2, dvx * dvx + dvz * dvz), 0, 4.5);
  return Math.min(22, Math.hypot(dx + dvx * time, dz + dvz * time)) * strength * 0.36;
}
