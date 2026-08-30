export function rampPoint(bar, distance) {
  if (!bar || !Number.isFinite(bar.x) || !Number.isFinite(bar.z) || !Number.isFinite(bar.dx) || !Number.isFinite(bar.dz)) return null;
  return { x: bar.x + bar.dx * distance, z: bar.z + bar.dz * distance };
}

export function splitRemaining(elapsed, splitStart, limit) {
  return Math.max(0, (Number(limit) || 0) - ((Number(elapsed) || 0) - (Number(splitStart) || 0)));
}

// Cumulative distances are built once with the mission definitions. During a race both hulls can then be compared
// along the course without allocating vectors or searching every gate each frame.
export function raceCourseDistances(start, gates) {
  const out = new Float32Array(gates.length);
  let x = Number(start?.x) || 0, z = Number(start?.z) || 0, distance = 0;
  for (let i = 0; i < gates.length; i++) {
    const gate = gates[i];
    distance += Math.hypot(gate.x - x, gate.z - z); out[i] = distance;
    x = gate.x; z = gate.z;
  }
  return out;
}

export function raceCourseProgress(start, gates, distances, nextGate, x, z) {
  if (!gates.length) return 0;
  const index = Math.max(0, Math.min(gates.length, Math.floor(Number(nextGate) || 0)));
  if (index >= gates.length) return distances[gates.length - 1] || 0;
  const from = index ? gates[index - 1] : start, gate = gates[index];
  const dx = gate.x - from.x, dz = gate.z - from.z, length = Math.hypot(dx, dz) || 1;
  const along = Math.max(0, Math.min(1, (((Number(x) || 0) - from.x) * dx + ((Number(z) || 0) - from.z) * dz) / (length * length)));
  return (index ? distances[index - 1] : 0) + along * length;
}

export function racePositionLabel(playerProgress, rivalProgress, name = 'Mud Hen') {
  const gap = Math.round(Math.abs((Number(playerProgress) || 0) - (Number(rivalProgress) || 0)));
  if (gap < 5) return `Side by side with ${name}`;
  return playerProgress > rivalProgress ? `${gap} m ahead of ${name}` : `${gap} m behind ${name}`;
}

export function cargoEjectionReason(physics) {
  if (!physics) return '';
  if (physics.landedFrame && physics.airTime > 0.55) return 'The case came loose on landing';
  if (physics.impact > 6.8) return 'The hull slam broke the tie-down';
  if (Math.abs(physics.roll) > 0.68) return 'The case rolled off the deck';
  if (physics.hit > 5.5) return 'The collision threw the case overboard';
  return '';
}
