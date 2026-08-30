import * as THREE from 'three';

const MPH = 2.23694;
const FEET = 3.28084;
const LINE_POINTS = 12;
const BOW_OFFSET = 2.2;
const clamp = (value, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number(value) || 0));
const smooth = (lo, hi, value) => {
  const t = clamp((value - lo) / Math.max(1e-6, hi - lo));
  return t * t * (3 - 2 * t);
};

export const ANCHOR_BOTTOMS = Object.freeze({
  muck: Object.freeze({ key: 'muck', label: 'soft muck', factor: 0.82 }),
  mud: Object.freeze({ key: 'mud', label: 'firm mud', factor: 1.12 }),
  grass: Object.freeze({ key: 'grass', label: 'sawgrass', factor: 0.68 }),
  shell: Object.freeze({ key: 'shell', label: 'shell bottom', factor: 0.94 }),
});

export function anchorRode(depth = 0) {
  const waterDepth = clamp(depth, 0.6, 8.5);
  return {
    depth: waterDepth,
    scope: clamp(waterDepth * 4, 7, 30),
    slack: clamp(2.6 + waterDepth * 1.35, 3.5, 12),
  };
}

export function anchorBottomProfile(sample = {}) {
  if ((Number(sample.lake) || 0) > 0.42) return ANCHOR_BOTTOMS.muck;
  if ((Number(sample.prairie) || 0) > 0.42) return ANCHOR_BOTTOMS.grass;
  if (Number.isFinite(sample.h) && sample.h > -1.35) return ANCHOR_BOTTOMS.shell;
  if ((Number(sample.s) || 0) > 0.55) return ANCHOR_BOTTOMS.mud;
  return ANCHOR_BOTTOMS.muck;
}

export function anchorHoldingCapacity(profile = ANCHOR_BOTTOMS.mud, depth = 3) {
  const depthFactor = 0.86 + smooth(0.8, 5.5, depth) * 0.24;
  return clamp(4 * (Number(profile.factor) || 1) * depthFactor, 2.25, 5.15);
}

// Caller-owned output keeps the hull's per-frame force path allocation-free.
export function anchorConstraintForce(constraint, bowX, bowZ, velocityX, velocityZ, out = {}) {
  out.x = 0; out.z = 0; out.force = 0; out.load = 0; out.distance = 0; out.extension = 0; out.taut = false;
  if (!constraint?.active || !constraint.engaged) return out;
  const dx = bowX - constraint.x, dz = bowZ - constraint.z;
  const distance = Math.hypot(dx, dz), extension = Math.max(0, distance - Math.max(0, Number(constraint.slack) || 0));
  out.distance = distance; out.extension = extension;
  if (extension <= 0.001 || distance <= 0.001) {
    constraint.distance = distance; constraint.force = 0; constraint.load = 0; constraint.taut = false;
    return out;
  }
  const nx = dx / distance, nz = dz / distance;
  const radialSpeed = (Number(velocityX) || 0) * nx + (Number(velocityZ) || 0) * nz;
  const requested = extension * 1.65 + Math.max(0, radialSpeed) * 1.8;
  const capacity = Math.max(0.1, Number(constraint.capacity) || 0.1), applied = Math.min(requested, capacity);
  out.x = -nx * applied; out.z = -nz * applied; out.force = applied; out.load = requested / capacity;
  out.taut = true;
  constraint.distance = distance; constraint.force = applied; constraint.load = out.load; constraint.taut = true;
  return out;
}

export class BoatAnchor {
  constructor(options) {
    Object.assign(this, options); // scene, terrain, water, phys, game, audio, environment, currents
    this.enabled = false;
    this.state = {
      active: false, engaged: false, resetRequested: false, status: 'up',
      x: 0, z: 0, bottomY: 0, depth: 0, scope: 0, slack: 0, capacity: 0,
      load: 0, force: 0, distance: 0, taut: false, riskLoad: 0,
      settingT: 0, settingDuration: 1.1, dragT: 0, dragDistance: 0, warnedDrag: false,
      bottomKey: '', bottomLabel: '',
    };
    this._forward = new THREE.Vector2();
    this._current = new THREE.Vector2();
    this._hud = { active: false, status: 'up', text: '', load: 0, warning: false, depthFeet: 0, scopeFeet: 0 };
    this.positions = new Float32Array(LINE_POINTS * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setDrawRange(0, LINE_POINTS);
    this.material = new THREE.LineBasicMaterial({ color: 0xb8ab8d, transparent: true, opacity: 0.76, depthWrite: false, toneMapped: true });
    this.line = new THREE.Line(this.geometry, this.material);
    this.line.name = 'player-anchor-rode'; this.line.visible = false; this.line.frustumCulled = false; this.line.renderOrder = 68;
    this.scene.add(this.line);
    this.eventTarget = options.eventTarget || globalThis.window;
    this.keyHandler = event => this.onKey(event);
    this.eventTarget?.addEventListener?.('keydown', this.keyHandler);
  }

  onKey(event) {
    if (event.code !== 'KeyG' || event.repeat || !this.enabled || !this.game.playing || this.game.paused || this.game.inputLock || this.game.menuOpen || this.game.mapOpen || this.game.resultOpen) return;
    event.preventDefault?.();
    if (this.state.active) this.raise(); else this.deploy();
  }

  refusal(reason) {
    this.game.toast('Anchor stays aboard', reason, 2.1);
    return false;
  }

  deploy() {
    if (this.state.active) return false;
    if (this.game.fishing?.blocking?.()) return this.refusal('Reel the fishing line in first.');
    if ((this.phys.towDrag || 0) > 0.003) return this.refusal('Clear the tow line first.');
    if (this.phys.airborne || this.phys.wet < 0.5 || this.phys.landFac > 0.2) return this.refusal('The hull needs open water.');
    if (this.phys.speed * MPH > 4.5) return this.refusal('Idle below 4.5 mph before dropping it.');

    const forward = this.phys.forward(this._forward);
    const x = this.phys.pos.x + forward.x * BOW_OFFSET, z = this.phys.pos.y + forward.y * BOW_OFFSET;
    const bottomY = this.terrain.heightAt(x, z), depth = this.water.level - bottomY;
    if (depth < 0.65) return this.refusal('There is not enough water under the bow.');
    if (depth > 8.5) return this.refusal('The bottom is beyond this rode.');

    const sample = this.terrain.hf?.computeBase?.(x, z) || { h: bottomY, s: 1, lake: 0, prairie: 0 };
    const bottom = anchorBottomProfile(sample), rode = anchorRode(depth), state = this.state;
    state.active = true; state.engaged = false; state.resetRequested = false; state.status = 'setting';
    state.x = x; state.z = z; state.bottomY = bottomY; state.depth = rode.depth; state.scope = rode.scope; state.slack = rode.slack;
    state.capacity = anchorHoldingCapacity(bottom, rode.depth); state.load = 0; state.force = 0; state.distance = 0; state.taut = false; state.riskLoad = 0;
    state.settingT = state.settingDuration; state.dragT = 0; state.dragDistance = 0; state.warnedDrag = false;
    state.bottomKey = bottom.key; state.bottomLabel = bottom.label;
    this.phys.anchorConstraint = state; this.line.visible = true; this.updateLine();
    this.audio?.thud?.(0.16);
    this.game.toast('Anchor away', `${bottom.label} · ${Math.round(rode.scope * FEET)} ft of rode`, 2.4);
    return true;
  }

  raise(silent = false) {
    const state = this.state;
    if (!state.active && !state.resetRequested) return false;
    state.active = false; state.engaged = false; state.resetRequested = false; state.status = 'up'; state.taut = false;
    state.load = 0; state.force = 0; state.riskLoad = 0; state.dragT = 0;
    if (this.phys.anchorConstraint === state) this.phys.anchorConstraint = null;
    this.line.visible = false;
    if (!silent) { this.audio?.thud?.(0.1); this.game.toast('Anchor aboard', 'The bow is free.', 1.8); }
    return true;
  }

  update(dt, time, enabled = true) {
    this.enabled = !!enabled;
    const state = this.state;
    if (state.resetRequested) this.raise(true);
    if (!state.active) return;
    this.updateLine();
    if (!enabled || this.game.paused) return;

    if (!state.engaged) {
      state.settingT -= dt;
      if (state.settingT <= 0) { state.settingT = 0; state.engaged = true; state.status = 'set'; }
      return;
    }

    state.bottomY = this.terrain.heightAt(state.x, state.z);
    state.depth = clamp(this.water.level - state.bottomY, 0.6, 8.5);
    const currentSpeed = this.currents?.flowAt?.(state.x, state.z, this._current)?.length?.() || 0;
    const wind = (Number(this.environment?.values?.wind) || 0) * (Number(this.environment?.gust) || 1);
    const sea = Number(this.environment?.values?.sea) || 0;
    const weatherLoad = state.taut
      ? Math.max(0, wind - 18) * 0.018 + Math.max(0, sea - 0.8) * 0.16 + Math.max(0, currentSpeed - 0.65) * 0.22
      : 0;
    state.riskLoad = state.load + weatherLoad;
    if (state.taut && state.riskLoad > 1) {
      state.status = 'dragging'; state.dragT += dt;
      const forward = this.phys.forward(this._forward);
      const bowX = this.phys.pos.x + forward.x * BOW_OFFSET, bowZ = this.phys.pos.y + forward.y * BOW_OFFSET;
      const dx = bowX - state.x, dz = bowZ - state.z, distance = Math.hypot(dx, dz);
      if (distance > 0.001) {
        const step = Math.min(distance, (0.1 + Math.min(2.4, state.riskLoad - 1) * 0.72) * dt);
        state.x += dx / distance * step; state.z += dz / distance * step; state.dragDistance += step;
      }
      if (!state.warnedDrag && state.dragT > 0.55) {
        state.warnedDrag = true; this.audio?.warn?.();
        this.game.toast('Anchor dragging', 'Ease the throttle or weigh it.', 2.5);
      }
    } else {
      state.status = state.taut ? 'holding' : 'set'; state.dragT = Math.max(0, state.dragT - dt * 2);
    }
  }

  updateLine() {
    const state = this.state;
    if (!state.active) { this.line.visible = false; return; }
    const forward = this.phys.forward(this._forward);
    const bowX = this.phys.pos.x + forward.x * BOW_OFFSET, bowY = this.phys.y + 0.76, bowZ = this.phys.pos.y + forward.y * BOW_OFFSET;
    const progress = state.engaged ? 1 : clamp(1 - state.settingT / state.settingDuration);
    const endY = this.water.level + (state.bottomY + 0.08 - this.water.level) * progress;
    const sag = state.engaged ? (state.taut ? 0.16 : Math.min(1.45, state.depth * 0.3)) : 0.12;
    for (let i = 0; i < LINE_POINTS; i++) {
      const t = i / (LINE_POINTS - 1), j = i * 3;
      this.positions[j] = bowX + (state.x - bowX) * t;
      this.positions[j + 1] = Math.max(endY, bowY + (endY - bowY) * t - Math.sin(Math.PI * t) * sag);
      this.positions[j + 2] = bowZ + (state.z - bowZ) * t;
    }
    this.geometry.attributes.position.needsUpdate = true; this.line.visible = true;
  }

  hud() {
    const state = this.state, hud = this._hud;
    hud.active = state.active; hud.status = state.status; hud.load = clamp(state.riskLoad); hud.warning = state.status === 'dragging';
    hud.depthFeet = Math.round(state.depth * FEET); hud.scopeFeet = Math.round(state.scope * FEET);
    hud.text = state.status === 'setting' ? `SETTING · ${hud.depthFeet} FT` : state.status === 'dragging' ? 'DRAGGING' : state.status === 'holding' ? `HOLD · ${hud.depthFeet} FT` : `SET · ${hud.depthFeet} FT`;
    return hud;
  }

  resourceStats() {
    return {
      active: this.state.active, status: this.state.status, load: this.state.riskLoad, draggedMetres: this.state.dragDistance,
      drawCalls: 1, geometries: 1, materials: 1, textures: 0, geometryBytes: this.positions.byteLength,
    };
  }

  dispose() {
    this.eventTarget?.removeEventListener?.('keydown', this.keyHandler);
    if (this.phys.anchorConstraint === this.state) this.phys.anchorConstraint = null;
    this.line.removeFromParent(); this.geometry.dispose(); this.material.dispose();
  }
}
