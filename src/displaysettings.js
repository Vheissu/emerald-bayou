import { QUALITY_PROFILES } from './renderquality.js';

export const QUALITY_STORAGE_KEY = 'emeraldBayou.renderQuality';
export const QUALITY_PREFERENCES = Object.freeze(['auto', ...QUALITY_PROFILES.map(profile => profile.id)]);

export function parseQualityPreference(value) {
  return QUALITY_PREFERENCES.includes(value) ? value : 'auto';
}

export function nextQualityPreference(value) {
  const current = parseQualityPreference(value);
  return QUALITY_PREFERENCES[(QUALITY_PREFERENCES.indexOf(current) + 1) % QUALITY_PREFERENCES.length];
}

export function qualityControllerConfig(preference, hardwareLevel) {
  const parsed = parseQualityPreference(preference);
  if (parsed === 'auto') return { initialLevel: hardwareLevel, minLevel: 0, maxLevel: QUALITY_PROFILES.length - 1 };
  const level = Math.max(0, QUALITY_PROFILES.findIndex(profile => profile.id === parsed));
  return { initialLevel: level, minLevel: level, maxLevel: level };
}

export function qualityPreferenceLabel(preference, activeProfileId) {
  const parsed = parseQualityPreference(preference);
  const profileId = parsed === 'auto' ? activeProfileId : parsed;
  const profile = QUALITY_PROFILES.find(candidate => candidate.id === profileId) || QUALITY_PROFILES[QUALITY_PROFILES.length - 1];
  return parsed === 'auto' ? `Auto · ${profile.label}` : profile.label;
}

export function readQualityPreference(storage) {
  try { const target = storage === undefined ? globalThis.localStorage : storage; return parseQualityPreference(target?.getItem(QUALITY_STORAGE_KEY)); } catch (error) { return 'auto'; }
}

export function writeQualityPreference(preference, storage) {
  const parsed = parseQualityPreference(preference);
  try { const target = storage === undefined ? globalThis.localStorage : storage; target?.setItem(QUALITY_STORAGE_KEY, parsed); } catch (error) { /* storage can be disabled without disabling the game */ }
  return parsed;
}
