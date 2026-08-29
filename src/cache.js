// Procedural cells can always be rebuilt from their coordinates. Keep a useful working set instead of retaining
// every cell touched during a trip across the whole map. Maps preserve insertion order, so this is a cheap FIFO trim;
// live render objects can protect the metadata they still reference.
export function trimOldest(map, limit, keep = null) {
  if (map.size <= limit) return 0;
  const target = Math.max(1, Math.floor(limit * 0.8));
  let removed = 0;
  for (const key of map.keys()) {
    if (keep && keep.has(key)) continue;
    map.delete(key); removed++;
    if (map.size <= target) break;
  }
  return removed;
}

// Streamed scenery can reuse immutable resource objects without keeping the scenery itself alive. Geometry data
// remains available for a later GPU upload even after Three.js releases an unused WebGL buffer.
export function sharedResource(resource) {
  if (resource) resource.userData = { ...(resource.userData || {}), sharedResource: true };
  return resource;
}

export function cachedResource(cache, key, create) {
  let resource = cache.get(key);
  if (!resource) { resource = sharedResource(create()); cache.set(key, resource); }
  return resource;
}

const attributeRanges = new WeakMap();

// Three.js clears updateRanges after each upload. Reuse one retained range object per attribute so dynamic effects
// transfer only their live packed prefix without allocating fresh range objects every frame.
export function updateAttributePrefix(attribute, componentCount) {
  if (!attribute || componentCount <= 0) return;
  let range = attributeRanges.get(attribute);
  if (!range) { range = { start: 0, count: 0 }; attributeRanges.set(attribute, range); }
  range.count = Math.min(attribute.array.length, Math.ceil(componentCount));
  attribute.clearUpdateRanges(); attribute.updateRanges.push(range); attribute.needsUpdate = true;
}
