import * as THREE from 'three';
import { sharedResource } from './cache.js';
import { navigationLightVisibility } from './navigationrules.js';

export const DIRECTED_NAVIGATION_LIGHT_CAPACITY = 16;

// A small powered johnboat carries red and green sidelights plus a white stern light. Mission and incident craft
// reuse these three local offsets; the renderer pool below moves the bulbs instead of adding three Object3Ds to
// every pooled hull in the world.
export const SMALL_POWER_NAVIGATION_LIGHT_LAYOUT = Object.freeze({
  port: Object.freeze({ x: -0.72, y: 0.86, z: -0.12 }),
  starboard: Object.freeze({ x: 0.72, y: 0.86, z: -0.12 }),
  stern: Object.freeze({ x: 0, y: 0.82, z: 1.35 }),
});

const BULB_GEOMETRY = sharedResource(new THREE.SphereGeometry(0.055, 8, 6));
const BULB_MATERIALS = Object.freeze({
  port: sharedResource(new THREE.MeshBasicMaterial({ color: 0xff3028, toneMapped: false })),
  starboard: sharedResource(new THREE.MeshBasicMaterial({ color: 0x35ff86, toneMapped: false })),
  stern: sharedResource(new THREE.MeshBasicMaterial({ color: 0xffe7b3, toneMapped: false })),
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function makeLightInstances(material, capacity, name) {
  const mesh = new THREE.InstancedMesh(BULB_GEOMETRY, material, capacity);
  mesh.name = name; mesh.count = 0; mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}

// Directed boats are short-lived combinations of several retained mission pools. A single fixed instanced display
// gives every eligible craft correct sectors at night without one material, geometry, light or mesh allocation per
// boat. Metadata is supplied by visitActiveVessels as its optional fifth argument; old four-argument visitors remain
// unchanged.
export class DirectedNavigationLights {
  constructor(scene, { capacity = DIRECTED_NAVIGATION_LIGHT_CAPACITY, maxDistance = 680 } = {}) {
    this.capacity = Math.max(1, Math.min(64, Math.trunc(finite(capacity, DIRECTED_NAVIGATION_LIGHT_CAPACITY))));
    this.maxDistance = Math.max(80, finite(maxDistance, 680)); this.maxDistanceSq = this.maxDistance * this.maxDistance;
    this.group = new THREE.Group(); this.group.name = 'directed vessel navigation light pool'; this.group.visible = false;
    this.port = makeLightInstances(BULB_MATERIALS.port, this.capacity, 'directed port lights');
    this.starboard = makeLightInstances(BULB_MATERIALS.starboard, this.capacity, 'directed starboard lights');
    this.stern = makeLightInstances(BULB_MATERIALS.stern, this.capacity, 'directed stern lights');
    this.group.add(this.port, this.starboard, this.stern); scene?.add?.(this.group);
    this._matrix = new THREE.Matrix4(); this._visibility = { port: true, starboard: true, stern: true };
    this._visitor = (x, z, speed, kind, vessel) => this.add(x, z, speed, kind, vessel);
    this.observerX = 0; this.observerZ = 0; this.active = false; this.vessels = 0; this.droppedLights = 0;
    this.portCount = 0; this.starboardCount = 0; this.sternCount = 0;
  }

  clear() {
    this.active = false; this.vessels = 0; this.droppedLights = 0;
    this.portCount = 0; this.starboardCount = 0; this.sternCount = 0;
    this.port.count = 0; this.starboard.count = 0; this.stern.count = 0; this.group.visible = false;
  }

  update(sources, observer, environment, enabled = true) {
    this.vessels = 0; this.droppedLights = 0; this.portCount = 0; this.starboardCount = 0; this.sternCount = 0;
    const hour = finite(environment?.hour, 12), night = Number.isFinite(Number(environment?.night))
      ? Math.max(0, Number(environment.night)) : (hour < 6.1 || hour > 19.2 ? 1 : 0);
    const restricted = Math.max(0, finite(environment?.restrictedVisibility)), storm = Math.max(0, finite(environment?.values?.storm));
    this.active = Boolean(enabled && (night > 0.03 || restricted > 0.25 || storm > 0.42));
    this.group.visible = this.active;
    if (this.active) {
      this.observerX = finite(observer?.x); this.observerZ = finite(observer?.z);
      if (Array.isArray(sources)) for (let i = 0; i < sources.length; i++) sources[i]?.visitActiveVessels?.(this._visitor);
    }
    this.port.count = this.portCount; this.starboard.count = this.starboardCount; this.stern.count = this.sternCount;
    if (this.portCount) this.port.instanceMatrix.needsUpdate = true;
    if (this.starboardCount) this.starboard.instanceMatrix.needsUpdate = true;
    if (this.sternCount) this.stern.instanceMatrix.needsUpdate = true;
    return this.vessels;
  }

  add(x, z, _speed, kind, vessel) {
    if (!this.active || kind !== 'skiff' || vessel?.navigationLights !== true) return false;
    const px = Number(x), pz = Number(z), heading = Number(vessel.heading);
    if (!Number.isFinite(px) || !Number.isFinite(pz) || !Number.isFinite(heading)) return false;
    const dx = this.observerX - px, dz = this.observerZ - pz, distanceSq = dx * dx + dz * dz;
    if (distanceSq > this.maxDistanceSq) return false;
    const c = Math.cos(heading), s = Math.sin(heading);
    const visible = navigationLightVisibility(dx * c - dz * s, dx * s + dz * c, this._visibility);
    const layout = vessel.navigationLightLayout || SMALL_POWER_NAVIGATION_LIGHT_LAYOUT;
    const meshY = Number(vessel.mesh?.position?.y), baseY = Number.isFinite(meshY) ? meshY : 0;
    const scale = Math.min(3.2, 1 + Math.sqrt(distanceSq) * 0.008);
    let written = false;
    if (visible.port) written = this.write(this.port, 'portCount', layout.port, px, baseY, pz, c, s, scale) || written;
    if (visible.starboard) written = this.write(this.starboard, 'starboardCount', layout.starboard, px, baseY, pz, c, s, scale) || written;
    if (visible.stern) written = this.write(this.stern, 'sternCount', layout.stern, px, baseY, pz, c, s, scale) || written;
    if (written) this.vessels++;
    return written;
  }

  write(mesh, countKey, local, x, y, z, c, s, scale) {
    const index = this[countKey];
    if (index >= this.capacity) { this.droppedLights++; return false; }
    this._matrix.makeScale(scale, scale, scale);
    this._matrix.setPosition(x + local.x * c + local.z * s, y + local.y, z - local.x * s + local.z * c);
    mesh.setMatrixAt(index, this._matrix); this[countKey] = index + 1;
    return true;
  }

  resourceStats() {
    return {
      capacity: this.capacity, active: this.active, vessels: this.vessels,
      port: this.portCount, starboard: this.starboardCount, stern: this.sternCount,
      droppedLights: this.droppedLights, drawCalls: (this.portCount > 0 ? 1 : 0) + (this.starboardCount > 0 ? 1 : 0) + (this.sternCount > 0 ? 1 : 0),
      geometries: 1, materials: 3, textures: 0, pointLights: 0, instanceBytes: this.capacity * 16 * 4 * 3,
    };
  }
}
