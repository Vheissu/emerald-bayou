import * as THREE from 'three';

const KNOTS = 1.94384;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function fleckTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 32;
  const x = c.getContext('2d'); x.clearRect(0, 0, c.width, c.height);
  const fade = x.createLinearGradient(0, 0, c.width, 0);
  fade.addColorStop(0, 'rgba(235,247,240,0)'); fade.addColorStop(0.18, 'rgba(235,247,240,0.34)');
  fade.addColorStop(0.62, 'rgba(235,247,240,0.2)'); fade.addColorStop(1, 'rgba(235,247,240,0)');
  x.fillStyle = fade;
  x.beginPath(); x.ellipse(64, 16, 58, 4.1, -0.025, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(245,251,247,0.22)';
  for (const [px, py, rx, ry] of [[28, 13, 10, 1.8], [52, 19, 17, 1.4], [81, 13, 13, 1.2], [101, 18, 8, 1.5]]) {
    x.beginPath(); x.ellipse(px, py, rx, ry, 0.08, 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  return t;
}

// A cached local flow field. The bathymetry supplies the channel axis and constriction; the astronomical tide decides
// whether that axis is flooding or ebbing, while wind and pressure surge push exposed water across it. Everything that
// floats asks the same field, so the HUD, the player hull, traffic and loose wreckage cannot disagree about the water.
export class CurrentField {
  constructor(o) {
    Object.assign(this, o); // fxScene, terrain, water, environment, phys, game
    this.cache = new Map(); this.playerFlow = new THREE.Vector2(); this.playerSpeed = 0;
    this.debugPhase = null; this.debugIndex = 0; this.enabled = false;
    this._flow = new THREE.Vector2(); this._matrix = new THREE.Matrix4(); this._quat = new THREE.Quaternion();
    this._pos = new THREE.Vector3(); this._scale = new THREE.Vector3(); this._up = new THREE.Vector3(0, 1, 0);

    const geo = new THREE.PlaneGeometry(1, 1); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: fleckTexture(), color: 0xdcece4, transparent: true, opacity: 0, depthWrite: false,
      alphaTest: 0.012, side: THREE.DoubleSide, toneMapped: true,
    });
    this.count = 56; this.mesh = new THREE.InstancedMesh(geo, mat, this.count); this.mesh.name = 'surface-current';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.renderOrder = 71;
    this.tracers = Array.from({ length: this.count }, () => ({ x: 1e9, z: 1e9, vx: 0, vz: 0, life: 0, next: 0, size: 1, phase: Math.random() * 6.28 }));
    this._matrix.makeScale(0, 0, 0); for (let i = 0; i < this.count; i++) this.mesh.setMatrixAt(i, this._matrix);
    this.fxScene.add(this.mesh);

    this.keyHandler = e => {
      if (!import.meta.env.DEV || e.code !== 'F1' || e.repeat || !this.enabled) return;
      e.preventDefault();
      const modes = [
        { phase: 1, title: 'Flood current', line: 'Water is pushing inland through the cuts.' },
        { phase: 0, title: 'Slack water', line: 'The tide has stopped turning for a moment.' },
        { phase: -1, title: 'Ebb current', line: 'Water is draining hard toward the lower river.' },
        { phase: null, title: 'Natural current', line: 'The tide is back on the clock.' },
      ];
      const m = modes[this.debugIndex++ % modes.length]; this.debugPhase = m.phase; this.game.toast(m.title, m.line, 2.8);
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  tidePhase() {
    if (this.debugPhase !== null) return this.debugPhase;
    return clamp((this.environment.tideRate || 0) / 0.38, -1, 1);
  }

  stage() {
    const p = this.tidePhase(); return p > 0.13 ? 'flood' : p < -0.13 ? 'ebb' : 'slack';
  }

  hud() {
    const knots = this.playerSpeed * KNOTS;
    return knots < 0.12 ? 'slack water' : `${this.stage()} ${knots.toFixed(1)} kt`;
  }

  basisAt(x, z) {
    const C = 96, ci = Math.floor(x / C), cj = Math.floor(z / C), key = `${ci},${cj}`;
    let b = this.cache.get(key); if (b) return b;
    const hf = this.terrain.hf, c = hf.computeBase(x, z);
    let best = -1e9, dx = 0, dz = 1, axisDepth = 0;
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 8, ax = Math.cos(a), az = Math.sin(a);
      const h1 = hf.computeBase(x + ax * 32, z + az * 32).h, h2 = hf.computeBase(x - ax * 32, z - az * 32).h;
      const d1 = Math.max(0, -h1), d2 = Math.max(0, -h2), score = Math.min(d1, d2) * 1.35 + (d1 + d2) * 0.13;
      if (score > best) { best = score; dx = ax; dz = az; axisDepth = Math.min(d1, d2); }
    }
    // Give the undirected channel axis a stable downstream sign so neighbouring cached cells do not flip at random.
    if (dz < -0.15 || (Math.abs(dz) <= 0.15 && dx < 0)) { dx = -dx; dz = -dz; }
    const px = -dz, pz = dx;
    const sideH = Math.max(hf.computeBase(x + px * 21, z + pz * 21).h, hf.computeBase(x - px * 21, z - pz * 21).h);
    b = {
      x: dx, z: dz,
      channel: smooth(0.12, 0.82, c.s) * smooth(0.35, 2.2, axisDepth),
      pinch: smooth(-2.2, -0.18, sideH) * (1 - c.lake * 0.8),
      lake: clamp(c.lake),
    };
    this.cache.set(key, b);
    if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value);
    return b;
  }

  flowAt(x, z, out = this._flow) {
    const b = this.basisAt(x, z), V = this.environment.values;
    const depth = this.water.level - this.terrain.heightAt(x, z), wet = smooth(0.04, 0.62, depth);
    if (wet <= 0.001) return out.set(0, 0);
    const phase = this.tidePhase();
    const channelScale = lerp(0.26, 1, b.channel) * lerp(0.55, 1.42, b.pinch) * (1 - b.lake * 0.62);
    // About 0.12 m/s of freshwater drainage remains at slack. Flood tide reverses it; ebb reinforces it.
    const axial = (0.12 - phase * 0.72) * channelScale;
    const open = clamp(b.lake * 0.75 + (1 - b.channel) * 0.45);
    const windPush = (V.wind * 0.004 + V.surge * 0.42 + V.storm * 0.10) * lerp(0.28, 1, open);
    out.set(
      (b.x * axial + this.environment.windDir.x * windPush) * wet,
      (b.z * axial + this.environment.windDir.z * windPush) * wet,
    );
    return out;
  }

  spawnTracer(q) {
    const bx = this.phys.pos.x, bz = this.phys.pos.y;
    for (let k = 0; k < 12; k++) {
      const a = Math.random() * Math.PI * 2, r = 8 + Math.sqrt(Math.random()) * 82;
      const x = bx + Math.cos(a) * r, z = bz + Math.sin(a) * r;
      if (this.terrain.heightAt(x, z) > this.water.level - 0.16) continue;
      Object.assign(q, { x, z, vx: 0, vz: 0, life: 12 + Math.random() * 24, next: 0, size: 0.65 + Math.random() * 0.9, phase: Math.random() * 6.28 });
      return true;
    }
    q.life = 0; q.x = q.z = 1e9; return false;
  }

  update(dt, t, enabled = true) {
    this.enabled = enabled; this.mesh.visible = enabled;
    this.flowAt(this.phys.pos.x, this.phys.pos.y, this.playerFlow); this.playerSpeed = this.playerFlow.length();
    if (!enabled) return;
    const bx = this.phys.pos.x, bz = this.phys.pos.y;
    for (let i = 0; i < this.tracers.length; i++) {
      const q = this.tracers[i]; q.life -= dt; q.next -= dt;
      if (q.life <= 0 || Math.hypot(q.x - bx, q.z - bz) > 96 || this.terrain.heightAt(q.x, q.z) > this.water.level - 0.08) this.spawnTracer(q);
      if (q.life <= 0) { this._matrix.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this._matrix); continue; }
      if (q.next <= 0) {
        q.next = 0.34 + Math.random() * 0.32; const f = this.flowAt(q.x, q.z, this._flow);
        const k = 1 - Math.exp(-q.next * 1.8); q.vx += (f.x - q.vx) * k; q.vz += (f.y - q.vz) * k;
      }
      q.x += q.vx * dt; q.z += q.vz * dt;
      const sp = Math.hypot(q.vx, q.vz), a = Math.atan2(q.vx, q.vz);
      this._pos.set(q.x, this.water.waveHeight(q.x, q.z, t) + 0.026 + Math.sin(t * 0.7 + q.phase) * 0.004, q.z);
      this._quat.setFromAxisAngle(this._up, a);
      this._scale.set(0.10 * q.size, 1, (0.34 + sp * 1.65) * q.size);
      this._matrix.compose(this._pos, this._quat, this._scale); this.mesh.setMatrixAt(i, this._matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.material.opacity = clamp(0.045 + this.playerSpeed * 0.11 + this.environment.values.storm * 0.055, 0.045, 0.24);
  }
}
