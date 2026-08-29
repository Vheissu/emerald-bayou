export function rampPoint(bar, distance) {
  if (!bar || !Number.isFinite(bar.x) || !Number.isFinite(bar.z) || !Number.isFinite(bar.dx) || !Number.isFinite(bar.dz)) return null;
  return { x: bar.x + bar.dx * distance, z: bar.z + bar.dz * distance };
}

export function splitRemaining(elapsed, splitStart, limit) {
  return Math.max(0, (Number(limit) || 0) - ((Number(elapsed) || 0) - (Number(splitStart) || 0)));
}

export function cargoEjectionReason(physics) {
  if (!physics) return '';
  if (physics.landedFrame && physics.airTime > 0.55) return 'The case came loose on landing';
  if (physics.impact > 6.8) return 'The hull slam broke the tie-down';
  if (Math.abs(physics.roll) > 0.68) return 'The case rolled off the deck';
  if (physics.hit > 5.5) return 'The collision threw the case overboard';
  return '';
}
