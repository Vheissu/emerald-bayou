const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number(value) || 0));

// The air prop sits above the water. A floating deadhead can hammer the hull, but only a standing limb or debris
// that reaches the cage should wrap the prop. Keeping that distinction here prevents underwater-gill-net logic from
// behaving like an outboard motor while still letting the backcountry put something dangerous through the cage.
export function cageFoulingImpact(tag = '', impact = 0, cageImpact = false) {
  const force = Math.max(0, Number(impact) || 0);
  if (tag === 'snag') return clamp((force - 3.8) * 0.075, 0, 0.58);
  if (tag === 'storm-debris' && cageImpact) return clamp((force - 3.6) * 0.09, 0, 0.68);
  return 0;
}

export function cageFoulingPower(fouling = 0) {
  const wrap = clamp(fouling);
  if (wrap >= 0.96) return 0;
  return clamp(Math.pow(1 - wrap * 0.92, 1.4), 0.035, 1);
}

// Writes into a caller-owned record. This runs every frame while the cage is fouled, so it must not create garbage.
// Cutting is safe only after the throttle and prop settle. Pinning the throttle tightens the wrap and loads the engine.
export function cageFoulingStep(fouling = 0, progress = 0, conditions = {}, out = {}) {
  const dt = clamp(conditions.dt, 0, 0.1), throttle = Math.max(0, Number(conditions.throttle) || 0);
  const rpm = clamp(conditions.rpm), speed = Math.max(0, Number(conditions.speed) || 0);
  let wrap = clamp(fouling), cut = clamp(progress);
  const ready = wrap > 0.01 && throttle < 0.08 && rpm < 0.31 && speed < 2.5;
  const pinning = clamp((throttle - 0.18) / 0.82) * clamp((rpm - 0.18) / 0.62);

  if (wrap > 0.01 && pinning > 0) wrap = clamp(wrap + pinning * dt * (0.002 + wrap * 0.0045));
  if (conditions.cutting && ready) cut = clamp(cut + dt / (2.25 + wrap * 3.35));
  else cut = Math.max(0, cut - dt * (conditions.cutting ? 0.8 : 0.28));

  const cleared = cut >= 0.999;
  if (cleared) { wrap = 0; cut = 0; }
  out.fouling = wrap;
  out.progress = cut;
  out.ready = ready;
  out.pinning = pinning;
  out.engineWear = pinning * wrap * dt * 0.12;
  out.power = cageFoulingPower(wrap);
  out.cleared = cleared;
  return out;
}
