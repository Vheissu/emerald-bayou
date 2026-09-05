import * as THREE from 'three';

export const SCENE_POINT_LIGHTS = 12;
export const SCENE_SPOT_LIGHTS = 4;
const capacity = (value, maximum) => Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : maximum;

// Three bakes visible light counts into every lit material's program. Keep that count fixed while gameplay still
// owns its lamps, strobes and hidden rigs. Only these proxy lights participate in rendering; unused slots stay at zero.
export class SceneLightPool {
  constructor(scene, { points = SCENE_POINT_LIGHTS, spots = SCENE_SPOT_LIGHTS } = {}) {
    this.scene = scene; this.sources = []; this.registered = new WeakSet();
    this.group = new THREE.Group(); this.group.name = 'fixed scene light pool';
    this.points = this.makeSlots(capacity(points, SCENE_POINT_LIGHTS), false);
    this.spots = this.makeSlots(capacity(spots, SCENE_SPOT_LIGHTS), true);
    this.stats = { sources: 0, pointSlots: this.points.length, spotSlots: this.spots.length, activePoints: 0, activeSpots: 0, omittedPoints: 0, omittedSpots: 0 };
    this.register(scene); scene.add(this.group);
    // Recovery rigs are built and released as the player reaches them. Inspect only the affected subtree, never the
    // streamed scene each frame, and release detached sources so this registry cannot keep old wrecks alive.
    this.onAdded = event => { if (event.child !== this.group) this.register(event.child); };
    this.onRemoved = event => this.unregister(event.child);
    scene.addEventListener('childadded', this.onAdded); scene.addEventListener('childremoved', this.onRemoved);
  }

  makeSlots(count, spot) {
    const slots = [];
    for (let i = 0; i < count; i++) {
      const light = spot ? new THREE.SpotLight(0xffffff, 0) : new THREE.PointLight(0xffffff, 0);
      light.name = `pooled ${spot ? 'spot' : 'point'} light ${i}`; light.userData.sceneLightProxy = true;
      this.group.add(light);
      if (spot) this.group.add(light.target);
      slots.push({ light, source: null, next: null, score: -1 });
    }
    return slots;
  }

  register(root) {
    root.traverse(light => {
      if ((!light.isPointLight && !light.isSpotLight) || light.castShadow || light.map || light.userData.sceneLightProxy || this.registered.has(light)) return;
      this.registered.add(light);
      this.sources.push({ light, layers: light.layers.mask, position: new THREE.Vector3(), spot: light.isSpotLight === true });
      light.layers.mask = 0; // Keep the logical light and its parent visible to gameplay, but out of all render cameras.
    });
    this.stats.sources = this.sources.length;
  }

  isVisible(light) {
    for (let owner = light; owner; owner = owner.parent) {
      if (!owner.visible) return false;
      if (owner === this.scene) return true;
    }
    return false;
  }

  unregister(root) {
    let write = 0;
    for (const source of this.sources) {
      let within = false;
      for (let owner = source.light; owner; owner = owner.parent) if (owner === root) { within = true; break; }
      if (within) { source.light.layers.mask = source.layers; this.registered.delete(source.light); }
      else this.sources[write++] = source;
    }
    this.sources.length = write; this.stats.sources = write;
    for (const slots of [this.points, this.spots]) for (const slot of slots) {
      if (slot.source && !this.registered.has(slot.source.light)) { slot.source = null; slot.next = null; slot.light.intensity = 0; }
    }
  }

  sync(camera) {
    for (const slot of this.points) { slot.next = null; slot.score = -1; }
    for (const slot of this.spots) { slot.next = null; slot.score = -1; }
    let points = 0, spots = 0;
    for (const source of this.sources) {
      const light = source.light;
      if (!(light.intensity > 0) || !(source.layers & camera.layers.mask) || !this.isVisible(light)) continue;
      light.getWorldPosition(source.position);
      const color = light.color, brightness = color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
      if (!(brightness > 0)) continue;
      const slots = source.spot ? this.spots : this.points;
      if (source.spot) spots++; else points++;
      let score = brightness * light.intensity / (1 + source.position.distanceToSquared(camera.position));
      // A small retention bias keeps equally bright peripheral lamps from exchanging slots on every camera sway.
      for (const slot of slots) if (slot.source === source) { score *= 1.15; break; }
      let index = 0; while (index < slots.length && score <= slots[index].score) index++;
      if (index === slots.length) continue;
      for (let i = slots.length - 1; i > index; i--) { slots[i].next = slots[i - 1].next; slots[i].score = slots[i - 1].score; }
      slots[index].next = source; slots[index].score = score;
    }
    this.applySlots(this.points); this.applySlots(this.spots);
    this.stats.activePoints = Math.min(points, this.points.length); this.stats.activeSpots = Math.min(spots, this.spots.length);
    this.stats.omittedPoints = Math.max(0, points - this.points.length); this.stats.omittedSpots = Math.max(0, spots - this.spots.length);
    return this.stats;
  }

  applySlots(slots) {
    for (const slot of slots) {
      slot.source = slot.next;
      const proxy = slot.light, source = slot.source;
      if (!source) { proxy.intensity = 0; continue; }
      const light = source.light;
      proxy.position.copy(source.position); proxy.color.copy(light.color); proxy.intensity = light.intensity;
      proxy.distance = light.distance; proxy.decay = light.decay;
      if (source.spot) {
        light.target.getWorldPosition(proxy.target.position);
        proxy.angle = light.angle; proxy.penumbra = light.penumbra;
        proxy.target.updateMatrixWorld();
      }
    }
  }

  dispose() {
    this.scene.removeEventListener('childadded', this.onAdded); this.scene.removeEventListener('childremoved', this.onRemoved);
    for (const source of this.sources) if (source.light.layers.mask === 0) source.light.layers.mask = source.layers;
    for (const slot of this.points) slot.light.dispose();
    for (const slot of this.spots) slot.light.dispose();
    this.group.removeFromParent(); this.sources.length = 0;
  }
}
