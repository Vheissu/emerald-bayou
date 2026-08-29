const FULL_WARM_MODELS = Object.freeze(['beau_boat', 'boat_dreams', 'sandbox_boat', 'realistic_alligator', 'turtle_boat', 'fish_a']);

const PLANS = Object.freeze({
  fallback: Object.freeze({ id: 'fallback', warmShaders: false, blockingModels: Object.freeze([]), deferOptionalModels: true, modelConcurrency: 1, modelReleaseDelayMs: 650, terrainReadiness: 'local', minWaitMs: 250, maxWaitMs: 3000, compileDelayMs: 0 }),
  performance: Object.freeze({ id: 'performance', warmShaders: false, blockingModels: Object.freeze([]), deferOptionalModels: true, modelConcurrency: 1, modelReleaseDelayMs: 500, terrainReadiness: 'local', minWaitMs: 350, maxWaitMs: 4000, compileDelayMs: 0 }),
  balanced: Object.freeze({ id: 'balanced', warmShaders: false, blockingModels: Object.freeze([]), deferOptionalModels: true, modelConcurrency: 2, modelReleaseDelayMs: 350, terrainReadiness: 'local', minWaitMs: 500, maxWaitMs: 6000, compileDelayMs: 0 }),
  cinematic: Object.freeze({ id: 'cinematic', warmShaders: true, blockingModels: FULL_WARM_MODELS, deferOptionalModels: false, modelConcurrency: 4, modelReleaseDelayMs: 0, terrainReadiness: 'settled', minWaitMs: 800, maxWaitMs: 20000, compileDelayMs: 250 }),
});

export function startupPlan(profileId) {
  return PLANS[profileId] || PLANS.performance;
}

export function startupTerrainReady(mode, { settled = false, localVisible = false } = {}) {
  return mode === 'settled' ? Boolean(settled) : Boolean(localVisible);
}
