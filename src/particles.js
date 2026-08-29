import * as THREE from 'three';
import * as TEX from './textures.js';

// ---------------------------------------------------------------------------
// Droplets: tiny fast-moving point sprites (ballistic), lit by the sun.
// ---------------------------------------------------------------------------
export class Spray {
  constructor(max = 12000) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max); this.size = new Float32Array(max); this.alpha = new Float32Array(max); this.baseAlpha = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { tSprite: { value: TEX.spraySprite() }, uScale: { value: 1400 }, sunView: { value: new THREE.Vector3(0, 1, 0) }, bioluminescence: { value: 0 }, bioColor: { value: new THREE.Color().setRGB(0.015, 0.38, 0.92) } },
      vertexShader: `
        attribute float aSize, aAlpha; varying float vA; uniform float uScale;
        void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = min(aSize * uScale / max(-mv.z, 0.5), 160.0); vA = aAlpha * smoothstep(0.6, 2.5, -mv.z); }`,
      fragmentShader: `
        uniform sampler2D tSprite; uniform vec3 sunView, bioColor; uniform float bioluminescence; varying float vA;
        void main() {
          vec4 s = texture2D(tSprite, gl_PointCoord);
          // fake sphere shading: sun side bright, opposite side sky-tinted
          vec2 o = gl_PointCoord - 0.5; float lit = clamp(dot(normalize(o + 1e-4), sunView.xy) * 0.5 + 0.5, 0.0, 1.0);
          vec3 col = mix(vec3(0.70, 0.80, 0.92), vec3(1.08, 1.05, 0.98), lit * 0.5 + 0.45);
          col = mix(col, bioColor, bioluminescence * 0.72); col += bioColor * bioluminescence * 0.26;
          gl_FragColor = vec4(col, s.a * vA);
        }`,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 2;
    this.head = 0;
  }
  emit(x, y, z, vx, vy, vz, size, life, alpha = 1) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.alpha[i] = alpha; this.baseAlpha[i] = alpha;
  }
  update(dt) {
    const p = this.pos, v = this.vel;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; p[i * 3 + 1] = -100; continue; }
      this.life[i] -= dt;
      v[i * 3 + 1] -= 9.8 * dt;
      const drag = Math.exp(-dt * 1.4);
      v[i * 3] *= drag; v[i * 3 + 2] *= drag;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (p[i * 3 + 1] < 0.02) { p[i * 3 + 1] = 0.02; v[i * 3 + 1] = 0; this.life[i] -= dt * 6; }
      this.size[i] += dt * 0.1;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, t * 3.0);
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true; this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

// ---------------------------------------------------------------------------
// Plume: camera-facing volumetric puffs for the prop-wash sheet / rooster tail.
// Alpha is eroded by animated noise over the puff's life (dissipation instead of fade-out),
// lit from the sun's screen-space direction, soft-blended against scene depth.
// ---------------------------------------------------------------------------
export class Plume {
  constructor(max = 2600) {
    this.max = max;
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.size = new Float32Array(max); this.grow = new Float32Array(max); this.rot = new Float32Array(max); this.rotV = new Float32Array(max);
    this.seed = new Float32Array(max); this.alpha = new Float32Array(max); this.baseAlpha = new Float32Array(max);
    this.data = new Float32Array(max * 4); // size, age01, rot, seed
    this.velAttr = new Float32Array(max * 3);
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index; geo.attributes.position = base.attributes.position; geo.attributes.uv = base.attributes.uv;
    geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aData', new THREE.InstancedBufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aVel', new THREE.InstancedBufferAttribute(this.velAttr, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo = geo;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tSprite: { value: TEX.plumeSprite() }, tNoise: { value: TEX.noiseTex() }, tDepth: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) }, near: { value: 0.3 }, far: { value: 5000 }, uTime: { value: 0 },
        sunView: { value: new THREE.Vector3(0, 1, 0) }, camVel: { value: new THREE.Vector3() },
        sunCol: { value: new THREE.Color(1.12, 1.08, 1.0) }, skyCol: { value: new THREE.Color(0.58, 0.70, 0.82) },
        bioluminescence: { value: 0 }, bioColor: { value: new THREE.Color().setRGB(0.015, 0.38, 0.92) },
      },
      vertexShader: `
        attribute vec3 aPos; attribute vec4 aData; attribute float aAlpha; attribute vec3 aVel;
        uniform vec3 camVel;
        varying vec2 vUv; varying vec2 vOff; varying float vAge, vSeed, vAlpha, vZ, vSmoke;
        void main() {
          vUv = uv; vAge = aData.y; vSeed = aData.w;
          float c = cos(aData.z), s = sin(aData.z);
          vec2 off = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
          // stretch the puff along its apparent (camera-relative) motion so sheets streak instead of balling up
          vec4 mv = viewMatrix * vec4(aPos, 1.0);
          vec3 rv = (viewMatrix * vec4(aVel - camVel, 0.0)).xyz;
          vec2 sv = rv.xy / max(-mv.z, 0.5); float sl = length(sv);
          vec2 dir = sl > 1e-3 ? sv / sl : vec2(1.0, 0.0); vec2 perp = vec2(-dir.y, dir.x);
          float stretch = 1.0 + min(length(aVel - camVel) * 0.12, 1.6);
          vec2 o = vec2(dot(off, dir) * stretch, dot(off, perp));
          off = dir * o.x + perp * o.y;
          vOff = off * 2.0;
          mv.xy += off * aData.x;
          vZ = -mv.z;
          // Negative alpha is an allocation-free type bit for dark engine smoke. The magnitude remains opacity.
          vSmoke = 1.0 - step(0.0, aAlpha);
          vAlpha = abs(aAlpha) * smoothstep(1.5, 4.5, vZ);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        precision highp float;
        uniform sampler2D tSprite, tNoise, tDepth; uniform vec2 resolution; uniform float near, far, uTime;
        uniform vec3 sunView, sunCol, skyCol, bioColor; uniform float bioluminescence;
        varying vec2 vUv; varying vec2 vOff; varying float vAge, vSeed, vAlpha, vZ, vSmoke;
        float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
        void main() {
          float shape = texture2D(tSprite, vUv).a;
          vec2 n1uv = vUv * 1.4 + vec2(vSeed * 3.7, vSeed * 1.3) + vec2(uTime * 0.025, -uTime * 0.015);
          vec2 n2uv = vUv * 3.2 + vec2(vSeed * 1.9, vSeed * 5.1) - vec2(uTime * 0.04, uTime * 0.02);
          float n = texture2D(tNoise, n1uv).r * 0.62 + texture2D(tNoise, n2uv).g * 0.38;
          float dens = shape * (0.45 + 1.1 * n);
          float erode = mix(0.18, 0.85, vAge);
          float a = smoothstep(erode, erode + 0.36, dens);
          a *= vAlpha;
          // soft particle: fade where the puff intersects geometry / water
          vec2 suv = gl_FragCoord.xy / resolution;
          float sceneZ = linZ(texture2D(tDepth, suv).r);
          a *= clamp((sceneZ - vZ) / 0.7, 0.0, 1.0);
          // lighting: sun side of the puff is bright, far side takes sky light; thin edges glow
          float lit = clamp(dot(normalize(vOff + 1e-4), sunView.xy) * 0.5 + 0.5, 0.0, 1.0);
          float thin = 1.0 - smoothstep(0.0, 0.9, dens);
          vec3 col = mix(skyCol, sunCol, lit * 0.7 + 0.22);
          col += sunCol * thin * 0.1;
          col *= 0.9 + 0.1 * n;
          vec3 soot = mix(vec3(0.075, 0.082, 0.08), vec3(0.23, 0.235, 0.22), lit * 0.22 + thin * 0.12);
          col = mix(col, soot, vSmoke);
          float glow = bioluminescence * (1.0 - vSmoke) * (1.0 - smoothstep(0.48, 0.94, vAge));
          col = mix(col, bioColor, glow * 0.72); col += bioColor * glow * 0.34;
          gl_FragColor = vec4(col, a);
        }`,
      transparent: true, depthWrite: false, depthTest: true, blending: THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 1;
    this.head = 0;
  }
  emit(x, y, z, vx, vy, vz, size, grow, life, alpha = 0.5, smoke = false) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.grow[i] = grow;
    this.rot[i] = Math.random() * 6.283; this.rotV[i] = (Math.random() - 0.5) * 1.2;
    const encodedAlpha = smoke ? -Math.abs(alpha) : Math.abs(alpha);
    this.seed[i] = Math.random(); this.alpha[i] = encodedAlpha; this.baseAlpha[i] = encodedAlpha;
  }
  update(dt, t) {
    const p = this.pos, v = this.vel, d = this.data;
    this.mat.uniforms.uTime.value = t;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; d[i * 4] = 0; p[i * 3 + 1] = -100; continue; }
      this.life[i] -= dt;
      const smoke = this.baseAlpha[i] < 0;
      v[i * 3 + 1] += (smoke ? 0.32 : -0.55) * dt;
      const drag = Math.exp(-dt * (smoke ? 0.58 : 1.7));
      v[i * 3] *= drag; v[i * 3 + 2] *= drag; v[i * 3 + 1] *= Math.exp(-dt * 1.2);
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      if (!smoke) {
        const floor = 0.05 + this.size[i] * 0.35;
        if (p[i * 3 + 1] < floor) { p[i * 3 + 1] += (floor - p[i * 3 + 1]) * Math.min(1, dt * 6); v[i * 3 + 1] = Math.max(v[i * 3 + 1], 0); }
      }
      this.size[i] += this.grow[i] * dt; this.rot[i] += this.rotV[i] * dt;
      const age = 1 - this.life[i] / this.maxLife[i];
      d[i * 4] = this.size[i]; d[i * 4 + 1] = age; d[i * 4 + 2] = this.rot[i]; d[i * 4 + 3] = this.seed[i];
      this.velAttr[i * 3] = v[i * 3]; this.velAttr[i * 3 + 1] = v[i * 3 + 1]; this.velAttr[i * 3 + 2] = v[i * 3 + 2];
      this.alpha[i] = this.baseAlpha[i] * Math.min(1, age * 5.0);
    }
    this.geo.attributes.aPos.needsUpdate = true; this.geo.attributes.aData.needsUpdate = true; this.geo.attributes.aAlpha.needsUpdate = true; this.geo.attributes.aVel.needsUpdate = true;
  }
}
