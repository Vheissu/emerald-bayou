import * as THREE from 'three';

const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// Intermittent slow, deep strokes give way to gliding. The three Blender poses deform only wings;
// the exported morph normals follow the same motion as the feathers.
export function pelicanFlightPose(time, phase, dive, target) {
  const fold = clamp(Number(dive) || 0);
  const stroke = Math.sin(time * 5.8 + phase);
  const effort = smooth(-0.2, 0.55, Math.sin(time * 0.48 + phase * 0.41)) * (1 - fold);
  target[0] = Math.max(0, stroke) * effort;
  target[1] = Math.max(0, -stroke) * effort;
  target[2] = fold;
  return target;
}

export class PelicanFlock {
  constructor(source, capacity = 10) {
    const names = source.morphTargetDictionary || {};
    if (source.geometry?.morphAttributes.position?.length !== 3 || source.geometry?.morphAttributes.normal?.length !== 3 || Array.isArray(source.material) || ['Upstroke', 'Downstroke', 'Dive'].some((name, i) => names[name] !== i)) {
      throw new Error('Pelican asset must contain the three authored flight poses');
    }
    this.mesh = new THREE.InstancedMesh(source.geometry, source.material, capacity);
    this.mesh.name = 'Brown pelican flock';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.capacity = capacity;
    this.activeCount = capacity;
    this.pose = { morphTargetInfluences: new Float32Array(3) };
    this.hidden = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) {
      this.mesh.setMatrixAt(i, this.hidden);
      this.mesh.setMorphAt(i, this.pose);
    }
    this.finishFrame();
  }
  beginFrame() { this.activeCount = 0; }
  setBird(slot, matrix, time, phase, dive = 0, visible = true) {
    if (visible) this.activeCount++;
    this.mesh.setMatrixAt(slot, visible ? matrix : this.hidden);
    pelicanFlightPose(time, phase, dive, this.pose.morphTargetInfluences);
    this.mesh.setMorphAt(slot, this.pose);
  }
  finishFrame() {
    this.mesh.visible = this.activeCount > 0;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.morphTexture.needsUpdate = true;
  }
  resourceStats() {
    const geo = this.mesh.geometry;
    return {
      capacity: this.capacity, activeBirds: this.activeCount, drawCalls: this.mesh.visible ? 1 : 0, trianglesPerBird: (geo.index?.count || geo.attributes.position.count) / 3,
      geometries: 1, materials: 1, imageTextures: this.mesh.material.map ? 1 : 0,
      poseUploadBytes: this.mesh.morphTexture.source.data.data.byteLength,
    };
  }
  dispose() {
    // Geometry, material and atlas belong to the model cache; only this flock's GPU buffers are owned here.
    this.mesh.removeFromParent(); this.mesh.dispose();
  }
}
