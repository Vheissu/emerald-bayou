import * as THREE from 'three';

export const EGRET_POSES = Object.freeze(['Flight', 'Upstroke', 'Downstroke', 'Probe', 'StepLeft', 'StepRight']);
const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));

// Flight poses include the retracted neck and trailing legs. They form a convex blend, so the body never receives
// three full flight deformations at once. Ground actions affect separate neck and leg regions of the mesh.
export function egretPose(time, phase, flight, probe, walking, target) {
  const air = clamp(flight), ground = 1 - air;
  const stroke = Math.sin(time * 8.7 + phase), effort = 0.82;
  target[1] = air * Math.max(0, stroke) * effort;
  target[2] = air * Math.max(0, -stroke) * effort;
  target[0] = air - target[1] - target[2];
  target[3] = ground * clamp(probe);
  const step = Math.sin(time * 3.6 + phase);
  target[4] = ground * clamp(walking) * Math.max(0, step);
  target[5] = ground * clamp(walking) * Math.max(0, -step);
  return target;
}

export class EgretFlock {
  constructor(source, capacity = 16) {
    const names = source.morphTargetDictionary || {}, geometry = source.geometry;
    if (Array.isArray(source.material) || geometry?.morphAttributes.position?.length !== EGRET_POSES.length
      || geometry?.morphAttributes.normal?.length !== EGRET_POSES.length || EGRET_POSES.some((name, i) => names[name] !== i)) {
      throw new Error('Egret asset must contain the six authored flight and ground poses');
    }
    this.mesh = new THREE.InstancedMesh(geometry, source.material, capacity);
    this.mesh.name = 'Great egret residents'; this.mesh.frustumCulled = false;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const side = source.material.shadowSide ?? (source.material.side === THREE.DoubleSide ? THREE.DoubleSide
      : source.material.side === THREE.FrontSide ? THREE.BackSide : THREE.FrontSide);
    this.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side,
      map: source.material.map, alphaMap: source.material.alphaMap, alphaTest: source.material.alphaTest });
    this.mesh.customDepthMaterial = this.depth;
    this.capacity = capacity; this.activeCount = capacity;
    this.pose = { morphTargetInfluences: new Float32Array(EGRET_POSES.length) };
    this.hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) { this.mesh.setMatrixAt(i, this.hidden); this.mesh.setMorphAt(i, this.pose); }
    this.finishFrame();
  }
  async prepare(prepare) {
    if (!prepare) return;
    // Both the lit draw and the morphing shadow draw must be ready before the stand-ins are hidden.
    await prepare(this.mesh);
    const material = this.mesh.material;
    try { this.mesh.material = this.depth; await prepare(this.mesh); }
    finally { this.mesh.material = material; }
  }
  beginFrame() { this.activeCount = 0; }
  setBird(slot, matrix, time, phase, flight, probe, walking, visible = true) {
    if (visible) this.activeCount++;
    this.mesh.setMatrixAt(slot, visible ? matrix : this.hidden);
    egretPose(time, phase, flight, probe, walking, this.pose.morphTargetInfluences);
    this.mesh.setMorphAt(slot, this.pose);
  }
  finishFrame() {
    this.mesh.visible = this.activeCount > 0;
    this.mesh.instanceMatrix.needsUpdate = true; this.mesh.morphTexture.needsUpdate = true;
  }
  resourceStats() {
    const geometry = this.mesh.geometry;
    return { capacity: this.capacity, activeBirds: this.activeCount, drawCalls: this.mesh.visible ? 1 : 0,
      trianglesPerBird: (geometry.index?.count || geometry.attributes.position.count) / 3,
      geometries: 1, materials: 1, shadowMaterials: 1, imageTextures: this.mesh.material.map ? 1 : 0,
      poseUploadBytes: this.mesh.morphTexture.source.data.data.byteLength };
  }
  dispose() {
    // Only the instance buffers, pose texture and custom shadow material belong to this flock.
    this.mesh.removeFromParent(); this.mesh.dispose(); this.depth.dispose();
  }
}
