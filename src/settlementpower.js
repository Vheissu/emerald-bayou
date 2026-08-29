const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const finite = (value, fallback = 0) => { const number = Number(value); return Number.isFinite(number) ? number : fallback; };

export const MAX_SETTLEMENT_LIGHTS = 5;
export const MAX_SETTLEMENT_OUTAGES = 24;

const WEATHER_STRESS = Object.freeze({ squall: 0.05, thunderstorm: 0.18, hail: 0.25, tropical: 0.42, hurricane: 0.62 });

export function settlementGridStress(weather, values = {}, effectiveWind = values.wind) {
  const base = WEATHER_STRESS[weather] || 0;
  if (!base) return 0;
  const wind = clamp((finite(effectiveWind) - 12) / 30);
  const lightning = clamp(finite(values.lightning));
  const storm = clamp(finite(values.storm));
  const surge = clamp(finite(values.surge) / 1.1);
  return clamp(base + wind * 0.18 + lightning * 0.05 + storm * 0.04 + surge * 0.08, 0, 0.86);
}

export function settlementPowerRoll(key, day = 1) {
  const text = String(key ?? '');
  let hash = (2166136261 ^ (Math.trunc(finite(day, 1)) * 374761393)) >>> 0;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  hash ^= hash >>> 16; hash = Math.imul(hash, 0x7feb352d); hash ^= hash >>> 15; hash = Math.imul(hash, 0x846ca68b); hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

export function settlementPowerTarget(roll, stress, forcedOutage = false) {
  if (forcedOutage) return 0;
  const load = clamp(finite(stress)), value = clamp(finite(roll, 1));
  if (load < 0.015) return 1;
  if (value < load) return 0;
  const brownoutBand = Math.min(0.18, (1 - load) * 0.55);
  if (brownoutBand > 0 && value < load + brownoutBand) return 0.48 + (value - load) / brownoutBand * 0.3;
  return 1;
}

export function settlementPowerStep(current, target, dt) {
  const from = clamp(finite(current, 1)), to = clamp(finite(target, from)), seconds = clamp(finite(dt), 0, 1);
  const rate = to < from ? 5.2 : 0.14;
  return clamp(to + (from - to) * Math.exp(-seconds * rate));
}

export function settlementLightLevel(power, stress, time, phase = 0) {
  const supply = clamp(finite(power)), load = clamp(finite(stress));
  if (supply < 0.015) return 0;
  const instability = clamp((1 - supply) * 0.92 + load * 0.22);
  if (instability < 0.02) return supply;
  const t = finite(time), p = finite(phase);
  const tremor = 0.5 + Math.sin(t * 17.3 + p) * 0.3 + Math.sin(t * 31.7 + p * 1.91) * 0.2;
  let factor = 1 - instability * (0.06 + clamp(tremor) * 0.18);
  if (load > 0.42 && Math.sin(t * (4.1 + p * 0.03) + p * 2.3) > 0.955) factor *= 0.24 + (1 - instability) * 0.32;
  return clamp(supply * factor);
}

export function settlementStrikeOutageMinutes(distance, lightning, roll) {
  const metres = Math.max(0, finite(distance, Infinity));
  if (metres > 105) return 0;
  const proximity = 1 - clamp(metres / 105), electrical = clamp(finite(lightning));
  const chance = clamp(proximity * 0.72 + electrical * (0.08 + proximity * 0.2));
  if (clamp(finite(roll, 1)) > chance) return 0;
  return 30 + proximity * 95 + electrical * 35;
}

export function normalizeSettlementOutages(raw, minutes = 0, limit = MAX_SETTLEMENT_OUTAGES) {
  const now = finite(minutes), max = Math.max(1, Math.trunc(finite(limit, MAX_SETTLEMENT_OUTAGES))), outages = new Map();
  if (Array.isArray(raw)) for (const record of raw) {
    if (!Array.isArray(record) || record.length < 2) continue;
    const key = String(record[0] ?? '').slice(0, 72), expiry = finite(record[1], -Infinity);
    if (!key || expiry <= now || expiry > now + 1440) continue;
    outages.set(key, Math.max(expiry, outages.get(key) || 0));
  }
  while (outages.size > max) {
    let oldestKey = '', oldestExpiry = Infinity;
    for (const [key, expiry] of outages) if (expiry < oldestExpiry) { oldestKey = key; oldestExpiry = expiry; }
    if (!oldestKey) break; outages.delete(oldestKey);
  }
  return outages;
}

export function serializeSettlementOutages(outages, minutes = 0, limit = MAX_SETTLEMENT_OUTAGES) {
  const records = [], now = finite(minutes), max = Math.max(1, Math.trunc(finite(limit, MAX_SETTLEMENT_OUTAGES)));
  if (outages instanceof Map) for (const [key, expiry] of outages) if (Number.isFinite(expiry) && expiry > now) records.push([String(key).slice(0, 72), expiry]);
  records.sort((a, b) => b[1] - a[1]);
  if (records.length > max) records.length = max;
  return records;
}

export function resetSettlementCandidates(slots) {
  for (const slot of slots) { slot.key = ''; slot.x = 0; slot.y = 0; slot.z = 0; slot.distanceSq = Infinity; }
  return slots;
}

export function insertNearestSettlement(slots, key, x, y, z, distanceSq) {
  const d2 = finite(distanceSq, Infinity);
  if (!slots.length || !key || !Number.isFinite(d2)) return false;
  let index = -1;
  for (let i = 0; i < slots.length; i++) if (d2 < slots[i].distanceSq) { index = i; break; }
  if (index < 0) return false;
  for (let i = slots.length - 1; i > index; i--) {
    const source = slots[i - 1], target = slots[i];
    target.key = source.key; target.x = source.x; target.y = source.y; target.z = source.z; target.distanceSq = source.distanceSq;
  }
  const slot = slots[index]; slot.key = String(key); slot.x = finite(x); slot.y = finite(y); slot.z = finite(z); slot.distanceSq = d2;
  return true;
}
