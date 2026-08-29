import * as THREE from 'three';
import { updateAttributePrefix } from './cache.js';
import { regionAt } from './regions.js';

const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, Number(value) || 0));
const smooth = (low, high, value) => {
  const amount = clamp((value - low) / Math.max(1e-6, high - low));
  return amount * amount * (3 - 2 * amount);
};
const hourDistance = (hour, target) => {
  const distance = Math.abs((((Number(hour) || 0) % 24) + 24) % 24 - target);
  return Math.min(distance, 24 - distance);
};

export const FIREFLY_CELL_SIZE = 38;
export const FIREFLY_CAPACITY = 243;
export const FIREFLY_HABITAT = Object.freeze({
  blackwater: 0.86,
  sawgrass: 0.38,
  mangrove: 1,
  cypress: 0.96,
  emerald: 0.72,
  broad: 0.24,
  rookery: 0.82,
  prairie: 0.3,
  'dead-river': 0.76,
});

const CELL_OFFSETS = [];
for (let z = -4; z <= 4; z++) for (let x = -4; x <= 4; x++) CELL_OFFSETS.push({ x, z, d2: x * x + z * z });
CELL_OFFSETS.sort((a, b) => a.d2 - b.d2 || a.z - b.z || a.x - b.x);

function hashUint(x, z, slot, salt = 0) {
  let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ Math.imul((slot + 1) | 0, 0x6c8e9cf5) ^ Math.imul((salt + 11) | 0, 0x27d4eb2d);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  return (value ^ (value >>> 15)) >>> 0;
}

function hashUnit(x, z, slot, salt = 0) {
  return hashUint(x, z, slot, salt) / 4294967296;
}

export function fireflyActivity(input = {}) {
  const hour = (((Number(input.hour) || 0) % 24) + 24) % 24;
  const daylight = smooth(5.55, 6.55, hour) * (1 - smooth(19.05, 20.05, hour));
  const dusk = Math.exp(-Math.pow(hourDistance(hour, 20.15) / 1.55, 2));
  const time = (1 - daylight) * clamp(0.12 + dusk * 0.94);
  const habitat = FIREFLY_HABITAT[input.regionId] ?? FIREFLY_HABITAT.emerald;
  const wind = Math.max(0, Number(input.wind) || 0), rain = clamp(input.rain), storm = clamp(input.storm);
  const weather = (1 - smooth(5, 14, wind)) * (1 - smooth(0.24, 0.88, rain)) * (1 - smooth(0.28, 0.86, storm));
  const dampAir = 0.92 + smooth(0.00045, 0.0028, Math.max(0, Number(input.fog) || 0)) * 0.08;
  return clamp(time * habitat * weather * dampAir);
}

export function fireflyDisturbance(input = {}) {
  const distance = Math.max(0, Number(input.distance) || 0), speed = Math.max(0, Number(input.speed) || 0);
  const engine = smooth(1.5, 7.5, speed) * (1 - smooth(18, 65, distance));
  const cone = input.spotlight ? smooth(0.82, 0.97, Number(input.coneDot) || -1) * (1 - smooth(12, 115, distance)) : 0;
  return clamp(1 - engine * 0.62 - cone * 0.92);
}

function fireflyMaterial() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uActivity: { value: 0 },
      uBoat: { value: new THREE.Vector2() },
      uForward: { value: new THREE.Vector2(0, -1) },
      uSpeed: { value: 0 },
      uSpotOn: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: `
      attribute float aPhase;
      attribute float aRate;
      attribute float aSize;
      attribute float aPattern;
      attribute float aHabitat;
      uniform float uTime;
      uniform float uActivity;
      uniform vec2 uBoat;
      uniform vec2 uForward;
      uniform float uSpeed;
      uniform float uSpotOn;
      uniform vec2 uWind;
      varying float vGlow;

      void main() {
        vec3 firefly = position;
        float wander = uTime * (0.21 + aRate * 0.19) + aPhase * 37.0;
        firefly.xz += vec2(sin(wander * 1.17), cos(wander * 0.83)) * (0.18 + aSize * 0.17);
        firefly.xz += uWind * sin(wander * 0.31) * 0.08;
        firefly.y += sin(wander * 1.43) * (0.08 + aSize * 0.09);

        vec2 delta = firefly.xz - uBoat;
        float distanceToBoat = max(0.001, length(delta));
        float coneDot = dot(delta / distanceToBoat, normalize(uForward));
        float engine = smoothstep(1.5, 7.5, uSpeed) * (1.0 - smoothstep(18.0, 65.0, distanceToBoat));
        float spot = uSpotOn * smoothstep(0.82, 0.97, coneDot) * (1.0 - smoothstep(12.0, 115.0, distanceToBoat));
        float undisturbed = clamp(1.0 - engine * 0.62 - spot * 0.92, 0.0, 1.0);

        float cycle = fract(uTime * aRate + aPhase);
        float first = smoothstep(0.0, 0.045, cycle) * (1.0 - smoothstep(0.075, 0.16, cycle));
        float second = smoothstep(0.22, 0.265, cycle) * (1.0 - smoothstep(0.3, 0.39, cycle));
        float flash = max(first, second * step(0.62, aPattern));
        vGlow = flash * uActivity * undisturbed * aHabitat;

        vec4 mvPosition = modelViewMatrix * vec4(firefly, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp((48.0 + aSize * 28.0) / max(5.0, -mvPosition.z), 1.2, 9.5);
      }
    `,
    fragmentShader: `
      varying float vGlow;

      void main() {
        if (vGlow < 0.003) discard;
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        if (radius > 1.0) discard;
        float halo = 1.0 - smoothstep(0.08, 1.0, radius);
        float core = 1.0 - smoothstep(0.0, 0.18, radius);
        float alpha = (halo * 0.48 + core * 0.7) * vGlow;
        vec3 color = mix(vec3(0.48, 0.86, 0.16), vec3(1.0, 0.96, 0.58), core);
        gl_FragColor = vec4(color * (0.72 + core * 0.8), alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  material.name = 'bank firefly glow';
  return material;
}

export class NocturnalWetland {
  constructor(options) {
    Object.assign(this, options); // scene, terrain, world, phys, environment, regions, audio, profile
    this.regionAtFn = options.regionAtFn || regionAt;
    this.capacity = FIREFLY_CAPACITY;
    this.positions = new Float32Array(this.capacity * 3);
    this.phase = new Float32Array(this.capacity);
    this.rate = new Float32Array(this.capacity);
    this.size = new Float32Array(this.capacity);
    this.pattern = new Float32Array(this.capacity);
    this.habitat = new Float32Array(this.capacity);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aPhase', new THREE.BufferAttribute(this.phase, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aRate', new THREE.BufferAttribute(this.rate, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aPattern', new THREE.BufferAttribute(this.pattern, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('aHabitat', new THREE.BufferAttribute(this.habitat, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, 0);
    this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 260);
    this.material = fireflyMaterial();
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.name = 'seeded bank fireflies'; this.points.visible = false; this.points.frustumCulled = true; this.points.renderOrder = 43; this.points.layers.set(1);
    this.scene.add(this.points);
    this.forward = new THREE.Vector2(0, -1);
    this.valid = 0; this.drawCount = 0; this.qualityLimit = 0; this.rebuilds = 0;
    this.cellX = Number.NaN; this.cellZ = Number.NaN; this.waterBand = Number.NaN;
    this.activity = 0; this.targetActivity = 0; this.activityOverride = null;
    this.activityInput = { hour: 0, wind: 0, rain: 0, storm: 0, fog: 0, regionId: 'emerald' };
    this.setQuality(options.profile || {});
  }

  setQuality(profile = {}) {
    this.qualityLimit = Math.max(0, Math.min(this.capacity, Math.round(Number(profile.fireflyPoints) || 0)));
    this.updateDrawRange();
  }

  setActivityOverride(value = null, instant = false) {
    const numeric = Number(value);
    this.activityOverride = value == null || !Number.isFinite(numeric) ? null : clamp(numeric);
    if (instant) this.activity = this.activityOverride == null ? 0 : this.activityOverride;
  }

  updateDrawRange() {
    this.drawCount = Math.min(this.valid, this.qualityLimit);
    this.geometry.setDrawRange(0, this.drawCount);
    if (!this.drawCount) this.points.visible = false;
  }

  rebuild(force = false) {
    const centerX = Math.floor(this.phys.pos.x / FIREFLY_CELL_SIZE), centerZ = Math.floor(this.phys.pos.y / FIREFLY_CELL_SIZE);
    const waterLevel = Number(this.environment.waterLevel) || 0, waterBand = Math.round(waterLevel / 0.15);
    if (!force && centerX === this.cellX && centerZ === this.cellZ && waterBand === this.waterBand) return false;
    this.cellX = centerX; this.cellZ = centerZ; this.waterBand = waterBand;
    let count = 0;
    for (const offset of CELL_OFFSETS) {
      const cellX = centerX + offset.x, cellZ = centerZ + offset.z;
      for (let slot = 0; slot < 3 && count < this.capacity; slot++) {
        const x = (cellX + 0.08 + hashUnit(cellX, cellZ, slot, 1) * 0.84) * FIREFLY_CELL_SIZE;
        const z = (cellZ + 0.08 + hashUnit(cellX, cellZ, slot, 2) * 0.84) * FIREFLY_CELL_SIZE;
        const region = this.regionAtFn(x, z), density = FIREFLY_HABITAT[region?.id] ?? FIREFLY_HABITAT.emerald;
        if (hashUnit(cellX, cellZ, slot, 3) > density) continue;
        const ground = this.terrain.heightAt(x, z);
        if (!Number.isFinite(ground) || ground < waterLevel - 0.16 || ground > waterLevel + 2.6 || this.world?.blockedAt?.(x, z)) continue;
        let bank = ground <= waterLevel + 0.82;
        if (!bank) {
          const angle = hashUnit(cellX, cellZ, slot, 4) * Math.PI * 2, reach = 6.5;
          bank = this.terrain.heightAt(x + Math.cos(angle) * reach, z + Math.sin(angle) * reach) < waterLevel - 0.1;
        }
        if (!bank) continue;
        const index = count++, positionIndex = index * 3;
        this.positions[positionIndex] = x;
        this.positions[positionIndex + 1] = Math.max(ground, waterLevel) + 0.34 + hashUnit(cellX, cellZ, slot, 5) * 2.65;
        this.positions[positionIndex + 2] = z;
        this.phase[index] = hashUnit(cellX, cellZ, slot, 6);
        this.rate[index] = 0.17 + hashUnit(cellX, cellZ, slot, 7) * 0.18;
        this.size[index] = hashUnit(cellX, cellZ, slot, 8);
        this.pattern[index] = hashUnit(cellX, cellZ, slot, 9);
        this.habitat[index] = 0.68 + density * 0.32;
      }
      if (count >= this.capacity) break;
    }
    this.valid = count; this.rebuilds++;
    if (count) {
      updateAttributePrefix(this.geometry.attributes.position, count * 3);
      updateAttributePrefix(this.geometry.attributes.aPhase, count);
      updateAttributePrefix(this.geometry.attributes.aRate, count);
      updateAttributePrefix(this.geometry.attributes.aSize, count);
      updateAttributePrefix(this.geometry.attributes.aPattern, count);
      updateAttributePrefix(this.geometry.attributes.aHabitat, count);
    }
    this.geometry.boundingSphere.center.set((centerX + 0.5) * FIREFLY_CELL_SIZE, waterLevel + 1.5, (centerZ + 0.5) * FIREFLY_CELL_SIZE);
    this.updateDrawRange();
    return true;
  }

  update(dt, time, enabled = true) {
    if (!enabled) { this.points.visible = false; this.audio?.nightLife?.(0); return; }
    const values = this.environment.values || {}, current = this.regions?.current || this.regionAtFn(this.phys.pos.x, this.phys.pos.y), input = this.activityInput;
    input.hour = this.environment.hour; input.wind = (values.wind || 0) * (this.environment.gust || 1);
    input.rain = values.rain; input.storm = values.storm; input.fog = values.fog; input.regionId = current?.id;
    const natural = fireflyActivity(input);
    this.targetActivity = this.activityOverride == null ? natural : this.activityOverride;
    const step = Math.max(0, Math.min(0.1, Number(dt) || 0));
    this.activity += (this.targetActivity - this.activity) * (1 - Math.exp(-step * 1.8));
    if (this.targetActivity > 0.002 && this.qualityLimit > 0) this.rebuild(false);

    const uniforms = this.material.uniforms;
    uniforms.uTime.value = time;
    uniforms.uActivity.value = this.activity * (1 - clamp(this.environment.restrictedVisibility) * 0.42);
    uniforms.uBoat.value.set(this.phys.pos.x, this.phys.pos.y);
    if (this.phys.forward) this.phys.forward(this.forward); else this.forward.set(-Math.sin(this.phys.heading || 0), -Math.cos(this.phys.heading || 0));
    uniforms.uForward.value.copy(this.forward);
    uniforms.uSpeed.value = Math.max(0, Number(this.phys.speed) || 0);
    uniforms.uSpotOn.value = this.environment.spotOn ? 1 : 0;
    uniforms.uWind.value.set(Number(this.environment.windDir?.x) || 0, Number(this.environment.windDir?.z) || 0);
    this.points.visible = this.drawCount > 0 && this.activity > 0.004;
    this.audio?.nightLife?.(this.activity);
  }

  snapshot() {
    return { activity: this.activity, target: this.targetActivity, override: this.activityOverride, valid: this.valid, drawCount: this.drawCount, region: this.regions?.current?.id || this.regionAtFn(this.phys.pos.x, this.phys.pos.y)?.id || '' };
  }

  resourceStats() {
    let geometryBytes = 0;
    for (const attribute of Object.values(this.geometry.attributes)) geometryBytes += attribute.array.byteLength;
    return {
      capacity: this.capacity,
      valid: this.valid,
      drawCount: this.drawCount,
      qualityLimit: this.qualityLimit,
      drawCalls: this.points.visible ? 1 : 0,
      geometries: 1,
      materials: 1,
      attributes: Object.keys(this.geometry.attributes).length,
      geometryBytes,
      rebuilds: this.rebuilds,
    };
  }

  dispose() {
    this.points.removeFromParent(); this.geometry.dispose(); this.material.dispose(); this.audio?.nightLife?.(0);
  }
}
