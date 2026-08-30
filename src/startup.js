const AUTHORED_MODEL_NAMES = Object.freeze(['beau_boat', 'boat_dreams', 'sandbox_boat', 'realistic_alligator', 'turtle_boat', 'fish_a', 'driver']);
export const OPTIONAL_MODEL_NAMES = Object.freeze([...AUTHORED_MODEL_NAMES, 'grass_a', 'grass_d', 'tree_c']);
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

// The map and simulation radius never change. These budgets only control how much foliage card detail is retained,
// how far terrain children are prepared ahead of a moving boat, and how much main-thread time a frame may spend
// turning completed worker grids into meshes. Low-end machines keep every physical tree in the near ring while far
// stands use larger, sparser cards, avoiding a million-instance background build after the title has already opened.
const STREAM_BUDGETS = Object.freeze({
  fallback: Object.freeze({ foliageDetail: 0.36, terrainPrefetch: 1.15, terrainFinalizeBudgetMs: 1.25, terrainWorkerLimit: 1 }),
  performance: Object.freeze({ foliageDetail: 0.56, terrainPrefetch: 1.2, terrainFinalizeBudgetMs: 2, terrainWorkerLimit: 1 }),
  balanced: Object.freeze({ foliageDetail: 0.82, terrainPrefetch: 1.3, terrainFinalizeBudgetMs: 3, terrainWorkerLimit: 2 }),
  cinematic: Object.freeze({ foliageDetail: 1, terrainPrefetch: 1.35, terrainFinalizeBudgetMs: 4, terrainWorkerLimit: 4 }),
});

const PLANS = Object.freeze({
  fallback: Object.freeze({ id: 'fallback', effectBudget: EFFECT_BUDGETS.fallback, streamBudget: STREAM_BUDGETS.fallback, warmShaders: false, blockingModels: Object.freeze([]), disabledModels: LOW_MEMORY_DISABLED_MODELS, solidGrass: 'off', deferOptionalModels: true, releaseModelsAtTitle: false, titleModelReleaseDelayMs: 0, modelConcurrency: 1, modelReleaseDelayMs: 1800, modelBatchDelayMs: 1200, modelIdleTimeoutMs: 2500, modelPressureMaxWaitMs: 12000, terrainReadiness: 'local', minWaitMs: 250, maxWaitMs: 3000, compileDelayMs: 0 }),
  performance: Object.freeze({ id: 'performance', effectBudget: EFFECT_BUDGETS.performance, streamBudget: STREAM_BUDGETS.performance, warmShaders: false, blockingModels: Object.freeze([]), disabledModels: LOW_MEMORY_DISABLED_MODELS, solidGrass: 'off', deferOptionalModels: true, releaseModelsAtTitle: false, titleModelReleaseDelayMs: 0, modelConcurrency: 1, modelReleaseDelayMs: 1200, modelBatchDelayMs: 650, modelIdleTimeoutMs: 1800, modelPressureMaxWaitMs: 8000, terrainReadiness: 'local', minWaitMs: 350, maxWaitMs: 4000, compileDelayMs: 0 }),
  balanced: Object.freeze({ id: 'balanced', effectBudget: EFFECT_BUDGETS.balanced, streamBudget: STREAM_BUDGETS.balanced, warmShaders: false, blockingModels: Object.freeze([]), disabledModels: BALANCED_DISABLED_MODELS, solidGrass: 'deferred', deferOptionalModels: true, releaseModelsAtTitle: false, titleModelReleaseDelayMs: 0, modelConcurrency: 1, modelReleaseDelayMs: 700, modelBatchDelayMs: 420, modelIdleTimeoutMs: 1600, modelPressureMaxWaitMs: 6000, terrainReadiness: 'local', minWaitMs: 500, maxWaitMs: 6000, compileDelayMs: 0 }),
  // Cinematic still warms the complete procedural presentation, but authored GLBs upgrade their visible stand-ins
  // progressively after the title opens. The title therefore never waits on an 8 MiB transfer or a settled 250 sq mi
  // terrain stream, while gameplay frame pressure can still pause each two-model decode batch.
  cinematic: Object.freeze({ id: 'cinematic', effectBudget: EFFECT_BUDGETS.cinematic, streamBudget: STREAM_BUDGETS.cinematic, warmShaders: true, blockingModels: Object.freeze([]), disabledModels: NO_DISABLED_MODELS, solidGrass: 'deferred', deferOptionalModels: true, releaseModelsAtTitle: true, titleModelReleaseDelayMs: 1200, modelConcurrency: 2, modelReleaseDelayMs: 700, modelBatchDelayMs: 250, modelIdleTimeoutMs: 1200, modelPressureMaxWaitMs: 6000, terrainReadiness: 'local', minWaitMs: 800, maxWaitMs: 6000, compileDelayMs: 0 }),
});

export function startupPlan(profileId) {
  return PLANS[profileId] || PLANS.performance;
}

export function startupTerrainReady(mode, { settled = false, localVisible = false } = {}) {
  return mode === 'settled' ? Boolean(settled) : Boolean(localVisible);
}
