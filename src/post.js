import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { msaaSamplesFor } from './renderquality.js';

const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const unit = value => {
  const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
};

// Lens water is presentation state, not another particle simulation. Rain and chine spray lay down a film, landing
// splash adds an immediate sheet, and speed plus crosswind clear the exposed chase camera after the weather passes.
export function lensWetnessStep(current = 0, { rain = 0, spray = 0, splash = 0, wind = 0, speed = 0, dt = 0 } = {}) {
  let next = unit(current);
  const seconds = Math.max(0, Math.min(0.25, Number.isFinite(Number(dt)) ? Number(dt) : 0));
  if (!seconds) return next;
  const rainN = unit(rain), sprayN = unit(spray), splashN = unit(splash);
  const deposition = 1 - Math.exp(-seconds * (rainN * 1.35 + sprayN * 0.8));
  next += (1 - next) * deposition;
  if (splashN) next += (1 - next) * splashN * 0.68;
  const windN = unit((Number(wind) || 0) / 36), speedN = unit((Number(speed) || 0) / 14);
  const clearRate = (0.018 + windN * 0.038 + speedN * 0.07) * (1 - rainN * 0.88) * (1 - sprayN * 0.7);
  return unit(next - seconds * clearRate);
}

function quadPass(material) {
  const scene = new THREE.Scene(); const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); mesh.frustumCulled = false; scene.add(mesh);
  return { scene, cam, material };
}

export class Pipeline {
  constructor(renderer, camera, quality = {}) {
    this.renderer = renderer; this.camera = camera;
    this.quality = quality; this.bloomEnabled = quality.bloom !== false; this.finalEnabled = quality.finalPass !== false; this.lensWetness = 0; this.dormant = false;
    const size = new THREE.Vector2(); renderer.getDrawingBufferSize(size);
    this.size = size;
    const w = size.x, h = size.y;
    const depthA = new THREE.DepthTexture(w, h); depthA.format = THREE.DepthFormat; depthA.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: depthA, depthBuffer: true, samples: msaaSamplesFor(w, h, quality.msaaSamples) });
    const depthB = new THREE.DepthTexture(w, h); depthB.format = THREE.DepthFormat; depthB.type = THREE.UnsignedIntType;
    // The opaque scene has already been resolved from hardware MSAA before it reaches this target. Water and spray are
    // full-screen or alpha-soft, and the composite is followed by FXAA, so a second multisample colour + depth pair
    // only duplicates a very large set of GPU attachments (about 169 MiB at a 2560x1440 drawing buffer).
    this.compRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: depthB, depthBuffer: true });
    this.ldrRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.aaRT = new THREE.WebGLRenderTarget(this.finalEnabled ? w : 1, this.finalEnabled ? h : 1, { type: THREE.UnsignedByteType, depthBuffer: false });
    const bw = this.bloomEnabled ? Math.max(1, Math.floor(w / 4)) : 1, bh = this.bloomEnabled ? Math.max(1, Math.floor(h / 4)) : 1;
    this.bloomA = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false });
    this.bloomB = new THREE.WebGLRenderTarget(bw, bh, { type: THREE.HalfFloatType, depthBuffer: false });

    this.copy = quadPass(new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.sceneRT.texture }, tDepth: { value: depthA } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tColor, tDepth; varying vec2 vUv;
        void main(){ gl_FragColor = texture2D(tColor, vUv); gl_FragDepthEXT = texture2D(tDepth, vUv).r; }`,
      depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth,
    }));
    this.bright = quadPass(new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.compRT.texture }, threshold: { value: 1.0 } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tColor; uniform float threshold; varying vec2 vUv;
        void main(){ vec3 c = texture2D(tColor, vUv).rgb; float l = dot(c, vec3(0.3, 0.59, 0.11)); gl_FragColor = vec4(c * smoothstep(threshold, threshold + 1.0, l), 1.0); }`,
      depthTest: false, depthWrite: false,
    }));
    this.blur = quadPass(new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null }, dir: { value: new THREE.Vector2(1, 0) } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tColor; uniform vec2 dir; varying vec2 vUv;
        void main(){ vec3 s = vec3(0.0); float w[5]; w[0]=0.227; w[1]=0.194; w[2]=0.121; w[3]=0.054; w[4]=0.016;
          s += texture2D(tColor, vUv).rgb * w[0];
          for (int i = 1; i < 5; i++) { s += texture2D(tColor, vUv + dir * float(i)).rgb * w[i]; s += texture2D(tColor, vUv - dir * float(i)).rgb * w[i]; }
          gl_FragColor = vec4(s, 1.0); }`,
      depthTest: false, depthWrite: false,
    }));
    this.grade = quadPass(new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.compRT.texture }, tDepth: { value: depthB }, tBloom: { value: this.bloomA.texture }, tNoise: { value: null },
        near: { value: camera.near }, far: { value: camera.far }, exposure: { value: 1.0 },
        fogColor: { value: new THREE.Color(0.60, 0.69, 0.74) }, fogDensity: { value: 0.00032 }, fogMax: { value: 0.6 }, bloomAmt: { value: 0.12 }, bloomQuality: { value: this.bloomEnabled ? 1 : 0 },
        mistAmount: { value: 0 }, mistQuality: { value: quality.surfaceMist ?? 0 }, mistLevel: { value: 0 }, mistHeight: { value: 2.8 }, mistTime: { value: 0 }, mistWind: { value: new THREE.Vector2() },
        cloudShadowAmount: { value: 0 }, cloudShadowQuality: { value: quality.cloudShadows ?? 0 }, cloudShadowOffset: { value: new THREE.Vector2() },
        lensWetness: { value: 0 }, lensQuality: { value: quality.lensWater ?? 0 }, lensTime: { value: 0 }, lensWind: { value: 0 }, lensAspect: { value: w / Math.max(1, h) },
        invProj: { value: new THREE.Matrix4() }, camMat: { value: new THREE.Matrix4() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor, tDepth, tBloom, tNoise; uniform float near, far, exposure, fogDensity, fogMax, bloomAmt, bloomQuality; uniform vec3 fogColor, sunDir;
        uniform float mistAmount, mistQuality, mistLevel, mistHeight, mistTime; uniform vec2 mistWind;
        uniform float cloudShadowAmount, cloudShadowQuality; uniform vec2 cloudShadowOffset;
        uniform float lensWetness, lensQuality, lensTime, lensWind, lensAspect;
        uniform mat4 invProj, camMat; varying vec2 vUv;
        vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
        float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
        float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
        vec4 lensDropLayer(vec2 uv, float scale, float seed) {
          vec2 p = vec2(uv.x * lensAspect, uv.y) * scale;
          p.x += p.y * lensWind * 0.18;
          p.y += lensTime * 0.027 * (0.8 + seed * 0.07);
          vec2 id = floor(p), cell = fract(p) - 0.5;
          float h = hash21(id + vec2(seed, seed * 1.91));
          float density = smoothstep(1.0 - lensWetness * 0.52, 1.0, h);
          float fall = mix(0.07, 0.18, hash21(id.yx + seed * 2.37));
          float phase = fract(h * 17.0 + lensTime * fall);
          vec2 centre = vec2((hash21(id + seed * 3.1) - 0.5) * 0.5, 0.52 - phase);
          vec2 delta = cell - centre; delta.y *= 1.28;
          float radius = mix(0.065, 0.145, hash21(id + seed * 5.7));
          float dist = length(delta);
          float body = (1.0 - smoothstep(radius * 0.48, radius, dist)) * density;
          float outer = 1.0 - smoothstep(radius * 0.72, radius, dist);
          float inner = 1.0 - smoothstep(radius * 0.34, radius * 0.62, dist);
          float rim = max(0.0, outer - inner) * density;
          float trail = (1.0 - smoothstep(0.004, 0.045, abs(delta.x))) * (1.0 - smoothstep(0.025, 0.42, delta.y)) * step(0.0, delta.y) * density * 0.28;
          return vec4(delta / max(dist, 0.0001) * rim, max(body, trail), rim);
        }
        void main() {
          float lensStrength = lensWetness * lensQuality, lensMask = 0.0, lensRim = 0.0;
          vec2 lensSampleUv = vUv;
          if (lensStrength > 0.003) {
            vec4 coarseDrop = lensDropLayer(vUv, 5.2, 1.3);
            vec4 fineDrop = lensDropLayer(vUv + vec2(0.17, 0.07), 10.8, 4.7);
            vec2 lensNormal = coarseDrop.xy * 0.9 + fineDrop.xy * 0.48;
            lensMask = clamp(max(coarseDrop.z, fineDrop.z * 0.82), 0.0, 1.0);
            lensRim = clamp(max(coarseDrop.w, fineDrop.w * 0.72), 0.0, 1.0);
            vec2 refraction = vec2(lensNormal.x / max(lensAspect, 0.5), lensNormal.y) * 0.0065 * lensStrength;
            lensSampleUv = clamp(vUv + refraction, vec2(0.002), vec2(0.998));
          }
          vec3 c = texture2D(tColor, lensSampleUv).rgb;
          float d = texture2D(tDepth, vUv).r;
          // view ray for aerial perspective tint
          vec4 vp = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vec3 viewRay = normalize(vp.xyz / vp.w); vec3 vdir = normalize((camMat * vec4(viewRay, 0.0)).xyz);
          float sunAmt = pow(max(dot(vdir, sunDir), 0.0), 8.0);
          vec3 fc = mix(fogColor, vec3(0.95, 0.9, 0.8), sunAmt * 0.5);
          if (d < 0.99999) {
            float z = linZ(d);
            float cloudStrength = cloudShadowAmount * cloudShadowQuality;
            float mistStrength = mistAmount * mistQuality;
            float rayDist = 0.0; vec3 cameraWorld = vec3(0.0), worldPos = vec3(0.0);
            if (cloudStrength > 0.001 || mistStrength > 0.001) {
              rayDist = min(z / max(-viewRay.z, 0.05), 7500.0);
              cameraWorld = camMat[3].xyz;
              worldPos = cameraWorld + vdir * rayDist;
            }
            if (cloudStrength > 0.001) {
              // Intersect the sightline endpoint's ray to the sun with a broad notional cloud deck. Its retained
              // wind offset moves the cover through world space, while mipmapped shared noise keeps distant banks
              // stable. Luminous lamps and lightning remain light sources instead of being painted dark.
              float cloudHeight = 720.0;
              vec2 cloudWorld = worldPos.xz + sunDir.xz * max(0.0, cloudHeight - worldPos.y) / max(sunDir.y, 0.08);
              vec2 cloudUv = (cloudWorld - cloudShadowOffset) * 0.00128;
              vec4 cloudNoise = texture2D(tNoise, cloudUv);
              float cloudField = cloudNoise.r * 0.76 + cloudNoise.g * 0.24;
              float cloudPatch = smoothstep(0.43, 0.66, cloudField);
              float sourceProtection = 1.0 - smoothstep(0.92, 2.4, dot(c, vec3(0.2126, 0.7152, 0.0722)));
              float shadow = cloudPatch * cloudStrength * sourceProtection * 0.19;
              c *= 1.0 - shadow;
            }
            float dist = z;
            float f = 1.0 - exp(-dist * fogDensity);
            f = clamp(f, 0.0, fogMax);
            c = mix(c, fc * 1.05, f);
            // Low fog has a real height instead of tinting the entire view equally. Reconstructing the endpoint makes
            // open water and lower trunks carry the bank while the tops of cypress remain visible above it.
            if (mistStrength > 0.001) {
              float mistRayDist = min(rayDist, 900.0);
              vec3 mistWorldPos = cameraWorld + vdir * mistRayDist;
              float h0 = max(cameraWorld.y - mistLevel, 0.0), h1 = max(mistWorldPos.y - mistLevel, 0.0);
              float heightDensity = (exp(-h0 / mistHeight) + exp(-h1 / mistHeight)) * 0.5;
              vec2 drift = mistWind * mistTime;
              float broad = texture2D(tNoise, mistWorldPos.xz * 0.0022 - drift * 0.0022).r;
              float detail = texture2D(tNoise, mistWorldPos.xz * 0.0061 - drift * 0.0047 + 0.37).g;
              float patchDensity = mix(0.52, 1.28, smoothstep(0.18, 0.82, broad * 0.7 + detail * 0.3));
              float bank = (1.0 - exp(-mistRayDist * 0.0032 * heightDensity * patchDensity)) * mistStrength;
              bank *= smoothstep(18.0, 75.0, mistRayDist);
              bank = clamp(bank, 0.0, 0.42 * mistStrength);
              c = mix(c, fc * 1.035, bank);
            }
          }
          c += texture2D(tBloom, vUv).rgb * bloomAmt * bloomQuality;
          if (lensStrength > 0.003) {
            c *= 1.0 - lensMask * lensStrength * 0.055;
            c += vec3(0.11, 0.135, 0.15) * lensRim * lensStrength;
          }
          c *= exposure;
          // gentle filmic grade: lift greens, soft contrast
          c = aces(c);
          c = pow(c, vec3(1.0 / 1.02));
          float lum = dot(c, vec3(0.3, 0.59, 0.11));
          c = mix(vec3(lum), c, 1.08);
          // vignette
          vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q) * 0.55;
          c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));
    this.depthView = quadPass(new THREE.ShaderMaterial({
      uniforms: { tDepth: { value: depthA }, near: { value: camera.near }, far: { value: camera.far } },
      vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tDepth; uniform float near, far; varying vec2 vUv;
        void main(){ float d = texture2D(tDepth, vUv).r; float z = 2.0 * near * far / (far + near - (d * 2.0 - 1.0) * (far - near)); gl_FragColor = vec4(vec3(1.0 - z / 200.0), 1.0); if (d >= 1.0) gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }`,
      depthTest: false, depthWrite: false,
    }));
    this.blit = quadPass(new THREE.ShaderMaterial({
      uniforms: { tColor: { value: null } }, vertexShader: QUAD_VS,
      fragmentShader: `uniform sampler2D tColor; varying vec2 vUv; void main(){ vec3 c = texture2D(tColor, vUv).rgb; gl_FragColor = vec4(pow(c / (1.0 + c), vec3(1.0/2.2)), 1.0); }`, depthTest: false, depthWrite: false }));
    this.fxaa = quadPass(new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms), vertexShader: FXAAShader.vertexShader, fragmentShader: FXAAShader.fragmentShader, depthTest: false, depthWrite: false,
    }));
    this.fxaa.material.uniforms.tDiffuse.value = this.ldrRT.texture;
    this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
    // final: subtle far depth-of-field (poisson gather, foreground-protected) + contrast-adaptive sharpen
    this.final = quadPass(new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.aaRT.texture }, tDepth: { value: depthB }, resolution: { value: new THREE.Vector2(w, h) },
        near: { value: camera.near }, far: { value: camera.far },
        dofStart: { value: 70.0 }, dofRange: { value: 420.0 }, maxCoc: { value: h * 0.0022 }, sharpen: { value: 0.32 },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor, tDepth; uniform vec2 resolution; uniform float near, far, dofStart, dofRange, maxCoc, sharpen;
        varying vec2 vUv;
        float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
        float coc(vec2 uv) { float d = texture2D(tDepth, uv).r; float z = d >= 1.0 ? far : linZ(d); return smoothstep(dofStart, dofStart + dofRange, z) * maxCoc; }
        void main() {
          vec2 px = 1.0 / resolution;
          vec3 c = texture2D(tColor, vUv).rgb;
          float c0 = coc(vUv);
          vec3 col = c;
          if (c0 > 0.35) {
            const vec2 taps[12] = vec2[12](vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621), vec2(0.962,-0.195), vec2(0.473,-0.480), vec2(0.519,0.767), vec2(0.185,-0.893), vec2(0.507,0.064), vec2(0.896,0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));
            vec3 acc = c; float wsum = 1.0;
            for (int i = 0; i < 12; i++) {
              vec2 uv = vUv + taps[i] * c0 * px;
              float ct = coc(uv);
              float w = clamp(ct / max(c0, 0.001), 0.0, 1.0); // sharp foreground does not bleed into the blur
              acc += texture2D(tColor, uv).rgb * w; wsum += w;
            }
            col = acc / wsum;
          }
          // sharpen where in focus
          float sh = sharpen * (1.0 - clamp(c0 / max(maxCoc, 0.001), 0.0, 1.0));
          if (sh > 0.001) {
            vec3 n = texture2D(tColor, vUv + vec2(px.x, 0.0)).rgb + texture2D(tColor, vUv - vec2(px.x, 0.0)).rgb + texture2D(tColor, vUv + vec2(0.0, px.y)).rgb + texture2D(tColor, vUv - vec2(0.0, px.y)).rgb;
            vec3 hp = c - n * 0.25;
            col += hp * sh;
          }
          gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    }));
    this.setQuality(quality);
  }
  setQuality(quality = {}) {
    this.quality = quality; this.bloomEnabled = quality.bloom !== false; this.finalEnabled = quality.finalPass !== false;
    if (this.grade) {
      this.grade.material.uniforms.bloomQuality.value = this.bloomEnabled ? 1 : 0;
      this.grade.material.uniforms.mistQuality.value = quality.surfaceMist ?? 0;
      this.grade.material.uniforms.cloudShadowQuality.value = quality.cloudShadows ?? 0;
      this.grade.material.uniforms.lensQuality.value = quality.lensWater ?? 0;
    }
  }
  hibernate() {
    if (this.dormant) return false;
    this.resize(1, 1); this.dormant = true;
    return true;
  }
  resume() {
    if (!this.dormant) return false;
    this.dormant = false;
    return true;
  }
  updateLensWeather(time = 0, conditions = {}) {
    this.lensWetness = lensWetnessStep(this.lensWetness, conditions);
    const u = this.grade.material.uniforms;
    u.lensWetness.value = this.lensWetness;
    u.lensTime.value = Number.isFinite(Number(time)) ? Number(time) : 0;
    u.lensWind.value = Math.max(-1, Math.min(1, Number(conditions.windScreen) || 0));
    return this.lensWetness;
  }
  resize(w, h) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    this.size.set(w, h);
    const samples = msaaSamplesFor(w, h, this.quality.msaaSamples), sameSize = this.sceneRT.width === w && this.sceneRT.height === h;
    if (this.sceneRT.samples !== samples) { this.sceneRT.samples = samples; if (sameSize) this.sceneRT.dispose(); }
    this.sceneRT.setSize(w, h); this.compRT.setSize(w, h); this.ldrRT.setSize(w, h);
    this.aaRT.setSize(this.finalEnabled ? w : 1, this.finalEnabled ? h : 1);
    this.final.material.uniforms.resolution.value.set(w, h); this.final.material.uniforms.maxCoc.value = this.finalEnabled ? h * 0.0022 : 0;
    const bw = this.bloomEnabled ? Math.max(1, Math.floor(w / 4)) : 1, bh = this.bloomEnabled ? Math.max(1, Math.floor(h / 4)) : 1;
    this.bloomA.setSize(bw, bh); this.bloomB.setSize(bw, bh);
    this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
    this.grade.material.uniforms.lensAspect.value = w / Math.max(1, h);
  }
  memoryStats() {
    const width = this.size.x, height = this.size.y, pixels = width * height, samples = this.sceneRT.samples;
    // Approximate WebGL attachment bytes: RGBA16F + D32 resolve targets, their multisample renderbuffers, the second
    // HDR/depth composite, the active RGBA8 passes and the optional quarter-resolution RGBA16F bloom targets.
    const sceneBytes = pixels * 12 * (1 + samples);
    const compositeBytes = pixels * 12, postBytes = pixels * 4 + (this.finalEnabled ? pixels * 4 : 4);
    const bloomBytes = this.bloomEnabled ? Math.floor(width / 4) * Math.floor(height / 4) * 16 : 16;
    const grade = this.grade.material.uniforms;
    return {
      width, height, pixels, samples, dormant: this.dormant, bloom: this.bloomEnabled, finalPass: this.finalEnabled,
      surfaceMist: grade.mistQuality.value, cloudShadows: grade.cloudShadowQuality.value, cloudShadowAmount: grade.cloudShadowAmount.value,
      cloudShadowExtraPasses: 0, cloudShadowExtraPrograms: 0, cloudShadowExtraTextures: 0, cloudShadowExtraAttachmentBytes: 0,
      lensWater: grade.lensQuality.value, lensWetness: this.lensWetness,
      estimatedAttachmentBytes: sceneBytes + compositeBytes + postBytes + bloomBytes,
    };
  }
  // scene: opaque world. overlays: array of scenes rendered on top (water, fx)
  render(scene, camera, overlays, mode = 'full') {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT); r.setClearColor(0x000000, 1); r.clear(); r.render(scene, camera);
    if (mode === 'refl' && this.reflTexture) { this.blit.material.uniforms.tColor.value = this.reflTexture; r.setRenderTarget(null); r.render(this.blit.scene, this.blit.cam); return; }
    if (mode === 'depth') { r.setRenderTarget(null); r.render(this.depthView.scene, this.depthView.cam); return; }
    r.setRenderTarget(this.compRT); r.clear();
    r.render(this.copy.scene, this.copy.cam);
    const prevAuto = r.autoClear; r.autoClear = false;
    for (const s of overlays) r.render(s, camera);
    r.autoClear = prevAuto;
    // Bloom remains part of the cinematic and balanced paths. The two lower tiers keep the weather grade but avoid
    // three extra render-target passes and the attachments behind them.
    if (this.bloomEnabled) {
      r.setRenderTarget(this.bloomA); r.render(this.bright.scene, this.bright.cam);
      this.blur.material.uniforms.tColor.value = this.bloomA.texture; this.blur.material.uniforms.dir.value.set(1 / this.bloomA.width, 0);
      r.setRenderTarget(this.bloomB); r.render(this.blur.scene, this.blur.cam);
      this.blur.material.uniforms.tColor.value = this.bloomB.texture; this.blur.material.uniforms.dir.value.set(0, 1 / this.bloomA.height);
      r.setRenderTarget(this.bloomA); r.render(this.blur.scene, this.blur.cam);
    }
    // grade
    const u = this.grade.material.uniforms;
    u.invProj.value.copy(camera.projectionMatrixInverse); u.camMat.value.copy(camera.matrixWorld);
    r.setRenderTarget(this.ldrRT); r.render(this.grade.scene, this.grade.cam);
    if (this.finalEnabled) {
      r.setRenderTarget(this.aaRT); r.render(this.fxaa.scene, this.fxaa.cam);
      r.setRenderTarget(null); r.render(this.final.scene, this.final.cam);
    } else {
      r.setRenderTarget(null); r.render(this.fxaa.scene, this.fxaa.cam);
    }
  }
}
