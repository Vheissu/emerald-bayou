const materialsFor = object => Array.isArray(object?.material) ? object.material : object?.material ? [object.material] : [];

const sortedDefines = defines => Object.entries(defines || {}).sort(([a], [b]) => a.localeCompare(b));

// Uniform values do not change a compiled program. Shader source, defines and the GPU primitive path do. Using this
// key prevents pooled fuel sheens, search beams and other copies from each doing the same startup compilation.
export function shaderVariantKey(material, object = {}) {
  return JSON.stringify([
    material?.vertexShader || '', material?.fragmentShader || '', sortedDefines(material?.defines),
    material?.glslVersion || '', Boolean(material?.lights), Boolean(material?.fog), Boolean(material?.toneMapped),
    Number(material?.side) || 0, Number(material?.alphaTest) || 0,
    Boolean(object.isPoints), Boolean(object.isLine), Boolean(object.isInstancedMesh), Boolean(object.isSkinnedMesh),
  ]);
}

// Three skips zero-count particle buffers and invisible event meshes in normal renders. Their shaders can therefore
// compile on the exact frame that a collision, mission marker, fire or searchlight first appears. Collect only custom
// shader materials: warming the complete streamed world would lengthen loading and retain far more GPU state.
export function deferredShaderObjects(scenes = []) {
  const objects = [], materials = new Set(), variants = new Set();
  for (const scene of scenes) {
    if (!scene?.traverse) continue;
    scene.traverse(object => {
      const custom = materialsFor(object).filter(material => material?.isShaderMaterial);
      if (!custom.length) return;
      for (const material of custom) materials.add(material);
      const fresh = custom.map(material => shaderVariantKey(material, object)).filter(key => !variants.has(key));
      if (!fresh.length) return;
      for (const key of fresh) variants.add(key);
      objects.push({ object, targetScene: scene });
    });
  }
  return { objects, materials: materials.size, variants: variants.size };
}

export async function warmDeferredShaders(renderer, camera, scenes = [], now = () => performance.now()) {
  const startedAt = now(), deferred = deferredShaderObjects(scenes);
  let completed = 0, failures = 0;
  for (const { object, targetScene } of deferred.objects) {
    try {
      if (typeof renderer?.compileAsync === 'function') await renderer.compileAsync(object, camera, targetScene);
      else if (typeof renderer?.compile === 'function') renderer.compile(object, camera, targetScene);
      else throw new Error('renderer has no shader compiler');
      completed++;
    } catch (error) { failures++; }
  }
  return {
    objects: deferred.objects.length, materials: deferred.materials, variants: deferred.variants, completed, failures,
    durationMs: Math.max(0, now() - startedAt),
  };
}

// A few retained first-use objects use stock Three materials rather than ShaderMaterial, so the custom-material scan
// intentionally skips them. Warm one explicit object behind the loading card without changing its live visibility.
export async function warmRetainedObject(renderer, camera, targetScene, object, now = () => performance.now()) {
  const startedAt = now();
  if (!object) return { attempted: 0, completed: 0, failures: 0, durationMs: 0 };
  const visible = object.visible; object.visible = true;
  let completed = 0, failures = 0;
  try {
    if (typeof renderer?.compileAsync === 'function') await renderer.compileAsync(object, camera, targetScene);
    else if (typeof renderer?.compile === 'function') renderer.compile(object, camera, targetScene);
    else throw new Error('renderer has no shader compiler');
    completed = 1;
  } catch (error) { failures = 1; }
  finally { object.visible = visible; }
  return { attempted: 1, completed, failures, durationMs: Math.max(0, now() - startedAt) };
}
