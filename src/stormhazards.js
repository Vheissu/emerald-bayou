import * as THREE from 'three';

const MPH = 2.23694;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

const fmtDist = metres => metres < 305 ? `${Math.max(1, Math.round(metres * 3.28084))} ft` : `${(metres / 1609.34).toFixed(2)} mi`;

function stormMaterial(color, roughness = 0.9, metalness = 0) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness });
}

function makeDebrisMesh(index) {
  const g = new THREE.Group();
  if (index % 3 === 0) {
    const bark = stormMaterial(index % 2 ? 0x4b3424 : 0x5a402a, 1);
    const len = 2.7 + (index % 4) * 0.34;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.19, len, 7), bark);
    trunk.rotation.z = Math.PI / 2; g.add(trunk);
    for (const side of [-1, 1]) {
      const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.07, 1.15, 6), bark);
      twig.position.set(side * len * 0.27, 0.05, side * 0.23); twig.rotation.set(side * 0.35, 0, side * 0.78); g.add(twig);
    }
    g.userData.radius = len * 0.45;
  } else if (index % 3 === 1) {
    const wood = stormMaterial(index % 2 ? 0x806546 : 0x6b5138, 0.96);
    const plank = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.13, 0.48), wood); g.add(plank);
    const split = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.09, 0.3), wood); split.position.set(0.65, 0.1, 0.35); split.rotation.y = -0.18; g.add(split);
    g.userData.radius = 1.35;
  } else {
    const tin = stormMaterial(index % 2 ? 0x68777a : 0x59696c, 0.48, 0.55);
    const sheet = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.07, 1.05), tin); g.add(sheet);
    const ribMat = stormMaterial(0x879294, 0.38, 0.7);
    for (let i = -2; i <= 2; i++) { const rib = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.055, 1.06), ribMat); rib.position.set(i * 0.4, 0.065, 0); g.add(rib); }
    g.userData.radius = 1.25;
  }
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.visible = false; return g;
}

function warpFunnel(geo, height, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = clamp((y + height * 0.5) / height);
    const a = Math.atan2(z, x), ripple = 1 + Math.sin(a * 3 + k * 24 + seed) * 0.045 + Math.sin(a * 7 - k * 17) * 0.018;
    const bend = (0.15 + k * 0.85) * (Math.sin(k * 7.4 + seed) * 0.72 + Math.sin(k * 15.1 + seed * 0.6) * 0.24);
    p.setXYZ(i, x * ripple + bend, y, z * ripple + Math.cos(k * 6.1 + seed) * bend * 0.65);
  }
  p.needsUpdate = true;
  return geo;
}

function funnelMaterial(color, phase) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uOpacity: { value: 0.2 }, uPhase: { value: phase } },
    vertexShader: `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: `
      uniform vec3 uColor; uniform float uTime, uOpacity, uPhase; varying vec2 vUv;
      void main() {
        float a = vUv.x * 6.2831853;
        float s1 = sin(a * 5.0 - vUv.y * 48.0 + uTime * 5.8 + uPhase);
        float s2 = sin(a * 11.0 + vUv.y * 73.0 - uTime * 3.1 + uPhase * 2.0);
        float s3 = sin(a * 2.0 - vUv.y * 19.0 + uTime * 1.7);
        float wisps = smoothstep(-0.15, 0.82, s1 * 0.54 + s2 * 0.28 + s3 * 0.18);
        float ends = smoothstep(0.0, 0.055, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y));
        float alpha = uOpacity * ends * (0.22 + wisps * 0.95);
        vec3 col = mix(uColor, vec3(0.82, 0.91, 0.92), wisps * 0.42 + vUv.y * 0.12);
        gl_FragColor = vec4(col, alpha);
      }
    `,
    transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide,
  });
}

function makeSpout() {
  const group = new THREE.Group(); group.name = 'waterspout'; group.visible = false;
  const outerMat = funnelMaterial(0x52676d, 1.3);
  const innerMat = funnelMaterial(0xb4c5c6, 4.7);
  const outer = new THREE.Mesh(warpFunnel(new THREE.CylinderGeometry(7.6, 0.55, 86, 24, 12, true), 86, 1.7), outerMat); outer.position.y = 43;
  const inner = new THREE.Mesh(warpFunnel(new THREE.CylinderGeometry(4.4, 0.28, 74, 18, 10, true), 74, 4.2), innerMat); inner.position.y = 37;
  group.add(outer, inner);
  const spirals = [];
  for (let strand = 0; strand < 3; strand++) {
    const pts = [];
    for (let i = 0; i < 110; i++) {
      const k = i / 109, y = 0.35 + k * 82, r = lerp(0.7, 7.1, Math.pow(k, 0.72)) * (0.88 + Math.sin(k * 27 + strand) * 0.1);
      const a = k * Math.PI * 13 + strand * Math.PI * 2 / 3;
      pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    }
    const mat = new THREE.LineBasicMaterial({ color: 0xdce7e6, transparent: true, opacity: 0.2, depthWrite: false });
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat); spirals.push(line); group.add(line);
  }
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xe7f1ed, transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(7.8, 0.13, 6, 52), ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = 0.22; group.add(ring);
  return { group, outer, inner, spirals, ring, active: false, x: 0, z: 0, life: 0, maxLife: 1, spin: 0, emit: 0, damageCd: 0 };
}

function makeStrike(scene) {
  const group = new THREE.Group(); group.visible = false;
  const mat = new THREE.MeshBasicMaterial({ color: 0xe9fbff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.55, 0.9, 40), mat); ring.rotation.x = -Math.PI / 2; group.add(ring);
  const light = new THREE.PointLight(0xdff7ff, 0, 145, 2); light.position.y = 4; group.add(light); scene.add(group);
  return { group, ring, light, life: 0, maxLife: 0.7 };
}

export class StormHazards {
  constructor(o) {
    Object.assign(this, o); // scene, terrain, world, water, phys, game, audio, environment, currents, condition, plume, spray
    this.debris = Array.from({ length: 12 }, (_, i) => {
      const mesh = makeDebrisMesh(i); this.scene.add(mesh);
      const d = { mesh, active: false, x: 0, z: 0, vx: 0, vz: 0, heading: 0, spin: 0, phase: Math.random() * 6.28, life: 0, hitCd: 0, radius: mesh.userData.radius };
      d.obs = { x: 0, z: 0, r: d.radius, tag: 'storm-debris', onHit: (into, nx, nz, p) => this.hitDebris(d, into, nx, nz, p) };
      return d;
    });
    this.obstacles = []; this.phys.addObs('storm-hazards', this.obstacles);
    this.spout = makeSpout(); this.scene.add(this.spout.group);
    this.strikes = Array.from({ length: 4 }, () => makeStrike(this.scene));
    this.spawnT = 6; this.spoutT = 28 + Math.random() * 32; this.noticeT = 0; this.noticeTitle = ''; this.noticeLine = ''; this.hudT = 0;
    this.enabled = false; this.debugIndex = 0; this._f = new THREE.Vector2(); this._r = new THREE.Vector2(); this._flow = new THREE.Vector2();
    this.el = document.getElementById('hazardState');
    this.stats = this.game.save.weatherHazards || { debrisHits: 0, nearStrikes: 0, spouts: 0 };
    this.game.save.weatherHazards = this.stats;
    this.keyHandler = e => {
      if (!import.meta.env.DEV || e.code !== 'F3' || e.repeat || !this.enabled) return;
      e.preventDefault();
      if (e.shiftKey) this.spawnSpout(true, true);
      else {
        const kind = this.debugIndex++ % 3;
        if (kind === 0) this.spawnDebris(true);
        else if (kind === 1) this.forceLightning();
        else this.spawnSpout(true, false);
      }
    };
    window.addEventListener('keydown', this.keyHandler);
  }

  waterSpot(min, max, sideMax, close = false) {
    const p = this.phys, f = p.forward(this._f), r = p.right(this._r);
    for (let i = 0; i < 70; i++) {
      const ahead = min + Math.random() * (max - min), side = (Math.random() - 0.5) * sideMax * 2;
      const x = p.pos.x + f.x * ahead + r.x * side, z = p.pos.y + f.y * ahead + r.y * side;
      const h = this.terrain.heightAt(x, z);
      if (h > -0.72 || h < -6.5 || (this.world && this.world.blockedAt(x, z))) continue;
      return { x, z };
    }
    if (!close) return null;
    return { x: p.pos.x + f.x * min, z: p.pos.y + f.y * min };
  }

  alert(title, line, seconds = 3.2) {
    this.noticeTitle = title; this.noticeLine = line; this.noticeT = seconds; this.hudT = 0;
  }

  spawnDebris(debug = false) {
    const d = this.debris.find(q => !q.active); if (!d) return false;
    const at = debug ? this.waterSpot(18, 27, 8, true) : this.waterSpot(42, 210, 175); if (!at) return false;
    const wind = this.environment.values.wind;
    Object.assign(d, {
      active: true, x: at.x, z: at.z,
      vx: this.environment.windDir.x * (0.25 + wind * 0.035) + (Math.random() - 0.5) * 0.5,
      vz: this.environment.windDir.z * (0.25 + wind * 0.035) + (Math.random() - 0.5) * 0.5,
      heading: Math.random() * Math.PI * 2, spin: (Math.random() - 0.5) * 0.42, life: debug ? 75 : 55 + Math.random() * 65, hitCd: 0,
    });
    d.mesh.visible = true;
    if (debug) { this.alert('Storm debris', 'Wind-thrown material is crossing the channel.', 4); this.game.toast('Debris in the channel', 'Slow down. It can get into the prop.', 2.7); }
    return true;
  }

  deactivateDebris(d) { d.active = false; d.mesh.visible = false; }

  hitDebris(d, into, nx, nz) {
    if (d.hitCd > 0 || into < 1.5) return;
    d.hitCd = 0.75; d.vx -= nx * into * 0.42; d.vz -= nz * into * 0.42; d.spin += (Math.random() - 0.5) * into * 0.22;
    this.audio.knock(clamp(into / 8, 0.2, 0.9)); this.game.shake = Math.max(this.game.shake, clamp(into / 14, 0.08, 0.45));
    this.alert('Debris strike', into > 5 ? 'Check the prop and hull.' : 'Something hard passed under the cage.', 2.6);
    if (into > 3) this.game.toast('Storm debris', into > 6 ? 'Hard hit. The prop took some of it.' : 'Branches under the hull.', 2.3);
    for (let i = 0; i < 18; i++) this.spray.emit(d.x + (Math.random() - 0.5) * 2, this.water.level + 0.08, d.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 0.8 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.018 + Math.random() * 0.025, 0.35 + Math.random() * 0.35, 0.65);
    this.stats.debrisHits = (this.stats.debrisHits || 0) + 1; this.game.persist();
  }

  updateDebris(dt, t) {
    const V = this.environment.values, severity = smooth(0.5, 1, V.storm) * smooth(9, 30, V.wind);
    const target = Math.round(severity * this.debris.length);
    this.spawnT -= dt;
    let active = 0;
    for (const d of this.debris) if (d.active) active++;
    if (active < target && this.spawnT <= 0) { this.spawnDebris(false); this.spawnT = lerp(5.5, 1.5, severity); }
    this.obstacles.length = 0;
    for (const d of this.debris) {
      if (!d.active) continue;
      d.hitCd = Math.max(0, d.hitCd - dt); d.life -= dt * (severity > 0.2 ? 1 : 3.5);
      const flow = this.currents ? this.currents.flowAt(d.x, d.z, this._flow) : null;
      const targetVx = this.environment.windDir.x * (0.22 + V.wind * 0.038) + (flow ? flow.x : 0);
      const targetVz = this.environment.windDir.z * (0.22 + V.wind * 0.038) + (flow ? flow.y : 0);
      d.vx += (targetVx - d.vx) * (1 - Math.exp(-dt * 0.38)); d.vz += (targetVz - d.vz) * (1 - Math.exp(-dt * 0.38));
      const nx = d.x + d.vx * dt, nz = d.z + d.vz * dt;
      if (this.terrain.heightAt(nx, nz) > -0.45 || (this.world && this.world.blockedAt(nx, nz))) { d.vx *= -0.58; d.vz *= -0.58; d.heading += 1.7; }
      else { d.x = nx; d.z = nz; }
      d.heading += d.spin * dt;
      const y = this.water.waveHeight(d.x, d.z, t) - 0.04;
      d.mesh.position.set(d.x, y, d.z); d.mesh.rotation.set(Math.sin(t * 0.75 + d.phase) * 0.07, d.heading, Math.sin(t * 0.91 + d.phase) * 0.1, 'YXZ');
      d.obs.x = d.x; d.obs.z = d.z; this.obstacles.push(d.obs);
      if (d.life <= 0 || Math.hypot(d.x - this.phys.pos.x, d.z - this.phys.pos.y) > 540) this.deactivateDebris(d);
    }
  }

  forceLightning() {
    const at = this.waterSpot(20, 30, 8, true);
    this.environment.triggerLightning(this.environment.camera.position, at);
  }

  lightning(strike) {
    let s = this.strikes.find(q => q.life <= 0) || this.strikes.reduce((a, b) => a.life < b.life ? a : b);
    s.life = s.maxLife; s.group.visible = true; s.group.position.set(strike.x, strike.y + 0.03, strike.z); s.group.scale.setScalar(1); s.ring.material.opacity = 1; s.light.intensity = 520;
    if (strike.water) {
      for (let i = 0; i < 75; i++) {
        const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 7;
        this.spray.emit(strike.x, strike.y + 0.06, strike.z, Math.cos(a) * v, 2.2 + Math.random() * 5.2, Math.sin(a) * v, 0.018 + Math.random() * 0.035, 0.45 + Math.random() * 0.55, 0.9);
      }
      for (let i = 0; i < 20; i++) this.plume.emit(strike.x + (Math.random() - 0.5) * 2, strike.y + 0.1, strike.z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2.5, 1.8 + Math.random() * 4, (Math.random() - 0.5) * 2.5, 0.35 + Math.random() * 0.45, 1.2, 0.8 + Math.random() * 0.45, 0.45);
    }
    const d = Math.hypot(strike.x - this.phys.pos.x, strike.z - this.phys.pos.y);
    if (d < 150) { this.audio.shot(clamp(1 - d / 190, 0.16, 0.65)); this.alert('Lightning strike', `${fmtDist(d)} off the boat.`, 3.2); }
    if (d < 52) {
      const q = 1 - d / 52;
      this.condition.damage(0.35 + q * 1.25, 1.2 + q * 5.2); this.condition.powerCut = Math.max(this.condition.powerCut, 0.7 + q * 1.1);
      const dx = this.phys.pos.x - strike.x, dz = this.phys.pos.y - strike.z, dl = Math.hypot(dx, dz) || 1;
      this.phys.vel.x += dx / dl * (0.8 + q * 2.2); this.phys.vel.y += dz / dl * (0.8 + q * 2.2); this.phys.angVel += (Math.random() - 0.5) * q * 1.2;
      this.game.shake = Math.max(this.game.shake, 0.45 + q * 0.45); this.game.toast('Lightning in the water', 'The engine stumbled. Keep clear of the open channel.', 3.1);
      this.stats.nearStrikes = (this.stats.nearStrikes || 0) + 1; this.game.persist();
    }
  }

  updateStrikes(dt) {
    for (const s of this.strikes) {
      if (s.life <= 0) continue;
      s.life -= dt; const age = 1 - clamp(s.life / s.maxLife), fade = clamp(s.life / 0.45);
      s.group.scale.setScalar(1 + age * 18); s.ring.material.opacity = fade * fade * 0.85; s.light.intensity = fade * 520;
      if (s.life <= 0) s.group.visible = false;
    }
  }

  spawnSpout(debug = false, close = false) {
    const at = close ? this.waterSpot(11, 15, 4, true) : debug ? this.waterSpot(72, 88, 22, true) : this.waterSpot(95, 190, 120);
    if (!at) return false;
    const S = this.spout; Object.assign(S, { active: true, x: at.x, z: at.z, life: debug ? 46 : 35 + Math.random() * 30, maxLife: debug ? 46 : 65, spin: Math.random() * 6.28, emit: 0, damageCd: 0 });
    S.maxLife = S.life; S.group.visible = true; S.group.position.set(S.x, this.water.level, S.z); S.group.scale.setScalar(0.01);
    this.spoutT = 80 + Math.random() * 90; this.stats.spouts = (this.stats.spouts || 0) + 1; this.game.persist();
    this.environment.alert('Waterspout', 'Funnel on the water. Give it room.', 5.5); this.audio.warn();
    if (debug) this.game.toast('Waterspout', close ? 'Too close. Turn out and use full power.' : 'A funnel has touched down across the channel.', close ? 3.1 : 1.8);
    return true;
  }

  endSpout() { this.spout.active = false; this.spout.group.visible = false; }

  updateSpout(dt, t) {
    const S = this.spout, V = this.environment.values;
    this.spoutT -= dt;
    const canForm = (this.environment.key === 'tropical' || this.environment.key === 'hurricane') && V.storm > 0.86;
    if (!S.active && canForm && this.spoutT <= 0) this.spawnSpout(false, false);
    if (!S.active) return;
    S.life -= dt * (V.storm > 0.7 ? 1 : 2.8); S.damageCd = Math.max(0, S.damageCd - dt); S.spin += dt * (1.5 + V.wind * 0.035);
    const drift = 0.45 + V.wind * 0.024, flow = this.currents ? this.currents.flowAt(S.x, S.z, this._flow) : null;
    const nx = S.x + (this.environment.windDir.x * drift + (flow ? flow.x * 0.35 : 0)) * dt;
    const nz = S.z + (this.environment.windDir.z * drift + (flow ? flow.y * 0.35 : 0)) * dt;
    if (this.terrain.heightAt(nx, nz) < -0.38 && !(this.world && this.world.blockedAt(nx, nz))) { S.x = nx; S.z = nz; }
    const appear = smooth(0, 2.2, S.maxLife - S.life) * smooth(0, 3.2, S.life);
    S.group.visible = appear > 0.01; S.group.scale.setScalar(appear); S.group.position.set(S.x, this.water.level, S.z); S.group.rotation.y = S.spin;
    S.outer.material.uniforms.uTime.value = t; S.outer.material.uniforms.uOpacity.value = 0.18 + V.storm * 0.09;
    S.inner.material.uniforms.uTime.value = t * 1.08; S.inner.material.uniforms.uOpacity.value = 0.11 + V.storm * 0.07;
    S.ring.material.opacity = 0.22 + V.storm * 0.22;
    for (let i = 0; i < S.spirals.length; i++) S.spirals[i].material.opacity = 0.2 + V.rain * 0.17;

    S.emit += dt * (34 + V.wind * 1.3);
    while (S.emit >= 1) {
      S.emit--;
      const a = Math.random() * Math.PI * 2, r = 3.5 + Math.random() * 6.5, tx = -Math.sin(a), tz = Math.cos(a);
      this.plume.emit(S.x + Math.cos(a) * r, this.water.level + 0.18, S.z + Math.sin(a) * r, tx * (3 + Math.random() * 4), 1.2 + Math.random() * 3.5, tz * (3 + Math.random() * 4), 0.45 + Math.random() * 0.65, 1.5, 0.75 + Math.random() * 0.55, 0.38);
      if (Math.random() < 0.55) this.spray.emit(S.x + Math.cos(a) * r, this.water.level + 0.08, S.z + Math.sin(a) * r, tx * (4 + Math.random() * 5), 2 + Math.random() * 4, tz * (4 + Math.random() * 5), 0.025 + Math.random() * 0.04, 0.45 + Math.random() * 0.5, 0.72);
    }
    if (Math.random() < dt * 7) this.plume.emit(S.x + (Math.random() - 0.5) * 8, this.water.level + 72 + Math.random() * 10, S.z + (Math.random() - 0.5) * 8, this.environment.windDir.x * 2, 0.2, this.environment.windDir.z * 2, 3 + Math.random() * 3.5, 2.2, 2.2, 0.22);

    const dx = S.x - this.phys.pos.x, dz = S.z - this.phys.pos.y, d = Math.hypot(dx, dz), q = clamp((92 - d) / 82);
    if (q > 0) {
      const rx = dx / (d || 1), rz = dz / (d || 1), pull = q * q;
      this.phys.vel.x += (rx * (1.4 + V.wind * 0.05) - rz * 3.4) * pull * dt;
      this.phys.vel.y += (rz * (1.4 + V.wind * 0.05) + rx * 3.4) * pull * dt;
      this.phys.angVel += pull * 0.7 * dt; this.phys.rollVel += Math.sin(t * 5.4) * pull * 0.55 * dt;
      this.game.shake = Math.max(this.game.shake, pull * 0.24);
      if (d < 18 && S.damageCd <= 0) {
        S.damageCd = 0.8; this.condition.damage(0.55 + pull * 1.15, 0.2 + pull * 0.7); this.audio.knock(0.22 + pull * 0.25);
        this.phys.vy += pull * 0.8; this.phys.wipeT = Math.max(this.phys.wipeT, 0.35 + pull * 0.9);
        this.game.toast('Inside the spray ring', 'The funnel is pulling the stern around.', 2.2);
      }
    }
    this.game.mapMarkers.push({ kind: 'hazard', x: S.x, z: S.z, color: '#d7f1f4', r: 6, clamp: d < 520 });
    if (S.life <= 0 || Math.hypot(S.x - this.phys.pos.x, S.z - this.phys.pos.y) > 620) this.endSpout();
  }

  render() {
    if (!this.el) return;
    let title = '', line = '';
    if (this.spout.active) {
      const d = Math.hypot(this.spout.x - this.phys.pos.x, this.spout.z - this.phys.pos.y);
      if (d < 430) { title = 'Waterspout'; line = `${fmtDist(d)} · ${d < 70 ? 'pulling the hull' : 'moving with the wind'}`; }
    }
    if (!title && this.noticeT > 0) { title = this.noticeTitle; line = this.noticeLine; }
    this.el.classList.toggle('on', Boolean(title)); this.el.innerHTML = title ? `<span>${title}</span><small>${line}</small>` : '';
  }

  update(dt, t, enabled = true) {
    this.enabled = enabled;
    if (!enabled) { this.obstacles.length = 0; if (this.el) this.el.classList.remove('on'); return; }
    this.noticeT = Math.max(0, this.noticeT - dt);
    this.updateDebris(dt, t); this.updateStrikes(dt); this.updateSpout(dt, t);
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.12; this.render(); }
  }

  stamps(out) {
    if (this.spout.active) {
      const S = this.spout; out.push({ x: S.x, z: S.z, radius: 7.8, height: -1.5, foam: 3.6, foamRadius: 8.6 });
      for (let i = 0; i < 4; i++) { const a = S.spin + i * Math.PI / 2; out.push({ x: S.x + Math.cos(a) * 7, z: S.z + Math.sin(a) * 7, radius: 2.2, height: 0.3, foam: 1.1, foamRadius: 2.4 }); }
    }
    for (const d of this.debris) if (d.active && Math.hypot(d.x - this.phys.pos.x, d.z - this.phys.pos.y) < 90) out.push({ x: d.x, z: d.z, radius: 0.65, height: -0.12, foam: 0.12, foamRadius: 0.7 });
  }
}
