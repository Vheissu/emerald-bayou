const FULL_WARM_MODELS = Object.freeze(['beau_boat', 'boat_dreams', 'sandbox_boat', 'realistic_alligator', 'turtle_boat', 'fish_a', 'driver']);
export const OPTIONAL_MODEL_NAMES = Object.freeze([...FULL_WARM_MODELS, 'grass_a', 'grass_d', 'tree_c']);
// Fallback and Performance keep the complete simulation with shared procedural stand-ins. Skipping every cosmetic
// GLB removes their network, decode, texture and geometry cost. Balanced retains authored boats, animals and grass,
// but uses the shared hero-tree stand-in instead of decoding the single 4.9 MB / 107k-vertex tree GLB during play.
const LOW_MEMORY_DISABLED_MODELS = OPTIONAL_MODEL_NAMES;
const BALANCED_DISABLED_MODELS = Object.freeze(['tree_c']);
const NO_DISABLED_MODELS = Object.freeze([]);

const EFFECT_BUDGETS = Object.freeze({
  fallback: Object.freeze({ spray: 5000, plume: 1200, rain: 900, hail: 240 }),
  performance: Object.freeze({ spray: 8000, plume: 1800, rain: 1500, hail: 480 }),
  balanced: Object.freeze({ spray: 12000, plume: 2600, rain: 2200, hail: 720 }),
  cinematic: Object.freeze({ spray: 12000, plume: 2600, rain: 2200, hail: 720 }),
});

const PLANS = Object.freeze({
  fallback: Object.freeze({ id: 'fallback', effectBudget: EFFECT_BUDGETS.fallback, warmShaders: false, blockingModels: Object.freeze([]), disabledModels: LOW_MEMORY_DISABLED_MODELS, solidGrass: 'off', deferOptionalModels: true, modelConcurrency: 1, modelReleaseDelayMs: 1800, modelBatchDelayMs: 1200, modelIdleTimeoutMs: 2500, modelPressureMaxWaitMs: 12000, terrainReadiness: 'local', minWaitMs: 250, maxWaitMs: 3000, compileDelayMs: 0 }),
  performance: Object.freeze({ id: 'performance', effectBudget: EFFECT_BUDGETS.performance, warmShaders: false, blockingModels: Object.freeze([]), disabledModels: LOW_MEMORY_DISABLED_MODELS, solidGrass: 'off', deferOptionalModels: true, modelConcurrency: 1, modelReleaseDelayMs: 1200, modelBatchDelayMs: 650, modelIdleTimeoutMs: 1800, modelPressureMaxWaitMs: 8000, terrainReadiness: 'local', minWaitMs: 350, maxWaitMs: 4000, compileDelayMs: 0 }),
  balanced: Object.freeze({ id: 'balanced', effectBudget: EFFECT_BUDGETS.balanced, warmShaders: false, blockingModels: Object.freeze([]), disabledModels: BALANCED_DISABLED_MODELS, solidGrass: 'deferred', deferOptionalModels: true, modelConcurrency: 1, modelReleaseDelayMs: 700, modelBatchDelayMs: 420, modelIdleTimeoutMs: 1600, modelPressureMaxWaitMs: 6000, terrainReadiness: 'local', minWaitMs: 500, maxWaitMs: 6000, compileDelayMs: 0 }),
  cinematic: Object.freeze({ id: 'cinematic', effectBudget: EFFECT_BUDGETS.cinematic, warmShaders: true, blockingModels: FULL_WARM_MODELS, disabledModels: NO_DISABLED_MODELS, solidGrass: 'blocking', deferOptionalModels: false, modelConcurrency: 4, modelReleaseDelayMs: 0, modelBatchDelayMs: 0, modelIdleTimeoutMs: 900, modelPressureMaxWaitMs: 0, terrainReadiness: 'settled', minWaitMs: 800, maxWaitMs: 20000, compileDelayMs: 250 }),
});

export function startupPlan(profileId) {
  return PLANS[profileId] || PLANS.performance;
}

export function startupTerrainReady(mode, { settled = false, localVisible = false } = {}) {
  return mode === 'settled' ? Boolean(settled) : Boolean(localVisible);
}
