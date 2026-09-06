// Terrain and its foliage are placed in world space once. Wind moves vertices in their existing shaders, not these
// Object3D transforms. Bake after attachment so a chunk's local origin is retained exactly, then stop recomputing it.
export function cacheStaticWorldTransforms(root) {
  root.updateWorldMatrix(true, true);
  let count = 0;
  root.traverse(object => {
    object.matrixAutoUpdate = false;
    object.matrixWorldAutoUpdate = false;
    count++;
  });
  return count;
}

// Pool owners hide complete boats and event rigs while inactive. Three's normal scene update still walks every
// hidden descendant. Suspend only those top-level branches; explicit forced updates and on-demand world-position
// queries keep their normal Three behaviour. Becoming visible flushes every descendant before the next render.
export class SceneTransformCache {
  constructor(scene) {
    this.scene = scene;
    this.branches = new Map();
    this.stats = { registered: 0, skippedBranches: 0 };
    this.originalSceneAutoUpdate = scene.matrixAutoUpdate;
    // The game already owns an identity scene matrix. Avoid forcing all descendants dirty on every frame.
    scene.updateMatrix(); scene.matrixAutoUpdate = false;
    this.onAdded = event => this.register(event.child);
    this.onRemoved = event => this.unregister(event.child);
    for (const child of scene.children) this.register(child);
    scene.addEventListener('childadded', this.onAdded);
    scene.addEventListener('childremoved', this.onRemoved);
  }
  register(root) {
    if (!root.isGroup || this.branches.has(root)) return;
    const original = root.updateMatrixWorld, stats = this.stats;
    const update = function (force) {
      if (!this.visible && !force) {
        this.matrixWorldNeedsUpdate = true;
        stats.skippedBranches++;
        return;
      }
      return original.call(this, force);
    };
    this.branches.set(root, { original, update });
    root.updateMatrixWorld = update;
    this.stats.registered = this.branches.size;
  }
  unregister(root) {
    const entry = this.branches.get(root);
    if (!entry) return;
    if (root.updateMatrixWorld === entry.update) root.updateMatrixWorld = entry.original;
    this.branches.delete(root); this.stats.registered = this.branches.size;
  }
  dispose() {
    this.scene.removeEventListener('childadded', this.onAdded);
    this.scene.removeEventListener('childremoved', this.onRemoved);
    for (const root of this.branches.keys()) this.unregister(root);
    this.scene.matrixAutoUpdate = this.originalSceneAutoUpdate;
  }
}
