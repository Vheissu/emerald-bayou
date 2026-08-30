export const LIGHTNING_TRUNK_SEGMENTS = 24;
export const LIGHTNING_MAX_SEGMENTS = 72;
export const LIGHTNING_LIFETIME = 0.22;

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function pulse(t, start, duration, strength) {
  if (t < start || t >= start + duration) return 0;
  return strength * Math.exp(-(t - start) / duration * 2.8);
}

// Cloud-to-ground flashes commonly re-strike an ionized channel. Three short return strokes read as lightning at
// ordinary frame rates while leaving real dark gaps between them instead of fading like a lamp.
export function lightningStrokeEnvelope(elapsed = 0) {
  const t = Number(elapsed);
  if (!Number.isFinite(t) || t < 0 || t >= LIGHTNING_LIFETIME) return 0;
  return Math.max(
    pulse(t, 0, 0.052, 1),
    pulse(t, 0.073, 0.046, 0.78),
    pulse(t, 0.148, 0.052, 0.52),
  );
}

// Retain the bearing to the cloud end of the most recent strike so the sky can illuminate the responsible cell.
// The caller owns `out`; keeping the normalization here allocation-free matters when return strokes update it.
export function lightningSkyDirection(out, camera, x = 0, y = 220, z = 0) {
  if (!out) return out;
  const cx = Number(camera?.x) || 0, cy = Number(camera?.y) || 0, cz = Number(camera?.z) || 0;
  let dx = (Number(x) || 0) - cx, dy = (Number(y) || 0) - cy, dz = (Number(z) || 0) - cz;
  const length = Math.hypot(dx, dy, dz);
  if (length > 1e-6) { dx /= length; dy /= length; dz /= length; } else { dx = 0; dy = 1; dz = 0; }
  if (typeof out.set === 'function') out.set(dx, dy, dz);
  else { out.x = dx; out.y = dy; out.z = dz; }
  return out;
}

// Fill one retained LineSegments buffer. The trunk is written first, followed by a bounded set of upward/outward
// branches. A caller-owned trunk scratch keeps even the rare strike path free of temporary geometry allocations.
export function writeLightningStroke(positions, colors, trunk, {
  x = 0, y = 0, z = 0, height = 220, random = Math.random,
} = {}) {
  const capacity = Math.min(
    LIGHTNING_MAX_SEGMENTS,
    Math.floor((positions?.length || 0) / 6),
    Math.floor((colors?.length || 0) / 6),
  );
  if (capacity < LIGHTNING_TRUNK_SEGMENTS || !trunk || trunk.length < (LIGHTNING_TRUNK_SEGMENTS + 1) * 3) return 0;
  const randomFn = typeof random === 'function' ? random : Math.random;
  const baseX = Number.isFinite(Number(x)) ? Number(x) : 0;
  const baseY = Number.isFinite(Number(y)) ? Number(y) : 0;
  const baseZ = Number.isFinite(Number(z)) ? Number(z) : 0;
  const boltHeight = clamp(Number.isFinite(Number(height)) ? Number(height) : 220, 80, 360);
  const rise = boltHeight / LIGHTNING_TRUNK_SEGMENTS;
  trunk[0] = baseX; trunk[1] = baseY; trunk[2] = baseZ;

  let px = baseX, pz = baseZ, driftX = 0, driftZ = 0;
  for (let i = 1; i <= LIGHTNING_TRUNK_SEGMENTS; i++) {
    const k = i / LIGHTNING_TRUNK_SEGMENTS, wander = 0.72 + k * 4.4;
    driftX = driftX * 0.46 + (randomFn() - 0.5) * wander;
    driftZ = driftZ * 0.46 + (randomFn() - 0.5) * wander;
    px += driftX; pz += driftZ;
    const index = i * 3;
    trunk[index] = px; trunk[index + 1] = baseY + k * boltHeight; trunk[index + 2] = pz;
  }

  let segments = 0;
  const writeSegment = (ax, ay, az, bx, by, bz, intensity) => {
    if (segments >= capacity) return false;
    const offset = segments * 6;
    positions[offset] = ax; positions[offset + 1] = ay; positions[offset + 2] = az;
    positions[offset + 3] = bx; positions[offset + 4] = by; positions[offset + 5] = bz;
    const r = intensity * 0.88, g = intensity * 0.96;
    colors[offset] = r; colors[offset + 1] = g; colors[offset + 2] = intensity;
    colors[offset + 3] = r; colors[offset + 4] = g; colors[offset + 5] = intensity;
    segments++;
    return true;
  };

  for (let i = 0; i < LIGHTNING_TRUNK_SEGMENTS; i++) {
    const a = i * 3, b = a + 3, intensity = 2.7 - i / LIGHTNING_TRUNK_SEGMENTS * 0.45;
    writeSegment(trunk[a], trunk[a + 1], trunk[a + 2], trunk[b], trunk[b + 1], trunk[b + 2], intensity);
  }

  for (let i = 5; i < LIGHTNING_TRUNK_SEGMENTS - 1 && segments < capacity; i++) {
    const forcedFork = i === 9 || i === 16;
    if (!forcedFork && randomFn() > 0.12 + i / LIGHTNING_TRUNK_SEGMENTS * 0.2) continue;
    const origin = i * 3, angle = randomFn() * Math.PI * 2, length = 2 + Math.floor(randomFn() * 5);
    const outX = Math.cos(angle), outZ = Math.sin(angle), lift = rise * (0.32 + randomFn() * 0.5);
    let bx = trunk[origin], by = trunk[origin + 1], bz = trunk[origin + 2];
    for (let step = 0; step < length && segments < capacity; step++) {
      const spread = 1.8 + step * 0.82;
      const nx = bx + outX * spread + (randomFn() - 0.5) * 1.6;
      const ny = Math.min(baseY + boltHeight * 1.035, by + lift * (0.82 + randomFn() * 0.36));
      const nz = bz + outZ * spread + (randomFn() - 0.5) * 1.6;
      const intensity = 1.18 * (1 - step / (length + 0.65));
      writeSegment(bx, by, bz, nx, ny, nz, intensity);
      bx = nx; by = ny; bz = nz;
    }
  }
  return segments;
}
