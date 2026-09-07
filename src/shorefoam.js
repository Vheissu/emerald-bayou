// Artistic response thresholds for this game's sea-state and wake solver, not physical wave-height measurements.
// Keeping the response explicit also gives the shader's zero-contribution gate a testable upper bound.
export const SHORE_FOAM = Object.freeze({ windStart: 0.18, windFull: 1.05, washStart: 0.025, washFull: 0.22,
  slopeStart: 0.12, slopeFull: 0.65, shelteredWindLoss: 0.7 });
const clamp = value => Math.max(0, Math.min(1, value));
const smooth = (a, b, value) => { const t = clamp((value - a) / (b - a)); return t * t * (3 - 2 * t); };

export function shoreFoamDrive(seaState, foam, wakeSlope, crest = 1, shelter = 0) {
  const p = SHORE_FOAM;
  const wind = smooth(p.windStart, p.windFull, seaState) * clamp(crest) * (1 - clamp(shelter) * p.shelteredWindLoss);
  const wash = Math.max(smooth(p.washStart, p.washFull, foam), smooth(p.slopeStart, p.slopeFull, wakeSlope));
  return Math.max(wind, wash);
}

export const SHORE_FOAM_GLSL = `
float shoreFoamDrive(float sea, float foam, float slope, float crest, float shelter) {
  float wind = smoothstep(${SHORE_FOAM.windStart}, ${SHORE_FOAM.windFull}, sea) * clamp(crest, 0.0, 1.0)
    * (1.0 - clamp(shelter, 0.0, 1.0) * ${SHORE_FOAM.shelteredWindLoss});
  float wash = max(smoothstep(${SHORE_FOAM.washStart}, ${SHORE_FOAM.washFull}, foam), smoothstep(${SHORE_FOAM.slopeStart}, ${SHORE_FOAM.slopeFull}, slope));
  return max(wind, wash);
}`;
