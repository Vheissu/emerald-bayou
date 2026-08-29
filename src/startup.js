const FULL_WARM_MODELS = Object.freeze(['beau_boat', 'boat_dreams', 'sandbox_boat', 'realistic_alligator', 'turtle_boat', 'fish_a']);

const EFFECT_BUDGETS = Object.freeze({
  fallback: Object.freeze({ spray: 5000, plume: 1200, rain: 900, hail: 240 }),
  performance: Object.freeze({ spray: 8000, plume: 1800, rain: 1500, hail: 480 }),
  balanced: Object.freeze({ spray: 12000, plume: 2600, rain: 2200, hail: 720 }),
  cinematic: Object.freeze({ spray: 12000, plume: 2600, rain: 2200, hail: 720 }),
});

const PLANS = Object.freeze({
  fallback: Object.freeze({ id: 'fallback', effectBudget: EFFECT_BUDGETS.fallback, warmShaders: false, blockingModels: Object.freeze([]), deferOptionalModels: true, modelConcurrency: 1, modelReleaseDelayMs: 1800, modelBatchDelayMs: 1200, modelIdleTimeoutMs: 2500, terrainReadiness: 'local', minWaitMs: 250, maxWaitMs: 3000, compileDelayMs: 0 }),
  performance: Object.freeze({ id: 'performance', effectBudget: EFFECT_BUDGETS.performance, warmShaders: false, blockingModels: Object.freeze([]), deferOptionalModels: true, modelConcurrency: 1, modelReleaseDelayMs: 1200, modelBatchDelayMs: 650, modelIdleTimeoutMs: 1800, terrainReadiness: 'local', minWaitMs: 350, maxWaitMs: 4000, compileDelayMs: 0 }),
  balanced: Object.freeze({ id: 'balanced', effectBudget: EFFECT_BUDGETS.balanced, warmShaders: false, blockingModels: Object.freeze([]), deferOptionalModels: true, modelConcurrency: 2, modelReleaseDelayMs: 700, modelBatchDelayMs: 180, modelIdleTimeoutMs: 1200, terrainReadiness: 'local', minWaitMs: 500, maxWaitMs: 6000, compileDelayMs: 0 }),
  cinematic: Object.freeze({ id: 'cinematic', effectBudget: EFFECT_BUDGETS.cinematic, warmShaders: true, blockingModels: FULL_WARM_MODELS, deferOptionalModels: false, modelConcurrency: 4, modelReleaseDelayMs: 0, modelBatchDelayMs: 0, modelIdleTimeoutMs: 900, terrainReadiness: 'settled', minWaitMs: 800, maxWaitMs: 20000, compileDelayMs: 250 }),
});

export function startupPlan(profileId) {
  return PLANS[profileId] || PLANS.performance;
}

export function startupTerrainReady(mode, { settled = false, localVisible = false } = {}) {
  return mode === 'settled' ? Boolean(settled) : Boolean(localVisible);
}
