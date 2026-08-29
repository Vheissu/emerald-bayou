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
