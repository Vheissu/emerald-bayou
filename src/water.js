import * as THREE from 'three';
import * as TEX from './textures.js';

export const MAX_WAKE_STAMPS = 20;
const MURK_SIZE = 2400, MURK_PX = 240; // 10 m per texel
export const WAKE_SIZE = 150; // metres covered by wake sim

export class Water {
  constructor(renderer, sunDir, quality = {}) {
    this.renderer = renderer;
    this.size = new THREE.Vector2();
    renderer.getDrawingBufferSize(this.size);
    this.reflectionScale = quality.reflectionScale ?? 0.5;
    this.reflectionMipmaps = quality.reflectionMipmaps !== false;
    this.level = 0;
    this.seaState = 0;
    this.windAngle = 0;
    this.rain = 0;
    this.hail = 0;
    this.windSpeed = 0;

    // ---- reflection ----
    this.reflRT = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(this.size.x * this.reflectionScale)), Math.max(1, Math.floor(this.size.y * this.reflectionScale)), {
      type: THREE.HalfFloatType, generateMipmaps: this.reflectionMipmaps, minFilter: this.reflectionMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter, magFilter: THREE.LinearFilter,
    });
    this.reflCamera = new THREE.PerspectiveCamera();
    this.textureMatrix = new THREE.Matrix4();

    // ---- wake simulation ----
    const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false };
    this.wakeResolution = Math.max(128, Math.round(quality.wakeResolution ?? 512));
    this.wakeMaxStamps = Math.max(1, Math.min(MAX_WAKE_STAMPS, Math.round(quality.wakeMaxStamps ?? MAX_WAKE_STAMPS)));
    this.wakeA = new THREE.WebGLRenderTarget(this.wakeResolution, this.wakeResolution, rtOpts);
    this.wakeB = new THREE.WebGLRenderTarget(this.wakeResolution, this.wakeResolution, rtOpts);
    this.wakeOrigin = new THREE.Vector2(0, 0);
    this.wakeCell = WAKE_SIZE / this.wakeResolution;
    this.wakeNeedsClear = true;
    this.stamps = []; for (let i = 0; i < MAX_WAKE_STAMPS; i++) this.stamps.push(new THREE.Vector4());
    this.foamStamps = []; for (let i = 0; i < MAX_WAKE_STAMPS; i++) this.foamStamps.push(new THREE.Vector4());
    this.simMat = new THREE.ShaderMaterial({
      uniforms: {
        tPrev: { value: null }, shift: { value: new THREE.Vector2() }, advection: { value: new THREE.Vector2() }, damp: { value: 0.985 }, foamDecay: { value: 0.962 },
        stamps: { value: this.stamps }, foamStamps: { value: this.foamStamps }, stampCount: { value: this.wakeMaxStamps }, texel: { value: 1 / this.wakeResolution },
      },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        varying vec2 vUv; uniform sampler2D tPrev; uniform vec2 shift, advection; uniform float damp, foamDecay, texel;
        uniform vec4 stamps[${MAX_WAKE_STAMPS}]; uniform vec4 foamStamps[${MAX_WAKE_STAMPS}]; uniform int stampCount;
        vec4 fetch(vec2 uv) { if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return vec4(0.0); return texture2D(tPrev, uv); }
        void main() {
          vec2 uv = vUv + shift - advection;
          vec4 c = fetch(uv);
          vec4 l = fetch(uv - vec2(texel, 0.0)), r = fetch(uv + vec2(texel, 0.0)), d = fetch(uv - vec2(0.0, texel)), u = fetch(uv + vec2(0.0, texel));
          float h = c.r, hp = c.g;
          float nh = (l.r + r.r + d.r + u.r) * 0.5 - hp;
          nh = nh * damp;
          // slight smoothing to kill grid noise
          nh = mix(nh, (l.r + r.r + d.r + u.r) * 0.25, 0.02);
          float foam = (c.b * 12.0 + l.b + r.b + d.b + u.b) / 16.0 * foamDecay;
          for (int i = 0; i < ${MAX_WAKE_STAMPS}; i++) {
            if (i >= stampCount) break;
            vec4 s = stamps[i];
            if (s.z > 0.0) { float dd = length(vUv - s.xy) / s.z; nh += s.w * exp(-dd * dd * 2.5); }
            vec4 f = foamStamps[i];
            if (f.z > 0.0) { float dd = length(vUv - f.xy) / f.z; foam += f.w * exp(-dd * dd * 2.0); }
          }
          gl_FragColor = vec4(nh, h, clamp(foam, 0.0, 2.0), 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.simScene = new THREE.Scene();
    this.simQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.simMat);
    this.simScene.add(this.simQuad);
    this.simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // ---- water surface ----
    this.uniforms = {
      tRefr: { value: null }, tDepth: { value: null }, tRefl: { value: this.reflRT.texture },
      tNormal: { value: TEX.waterNormal() }, tFoam: { value: TEX.foam() }, tWake: { value: this.wakeA.texture },
      reflMatrix: { value: this.textureMatrix }, resolution: { value: this.size },
      near: { value: 0.3 }, far: { value: 5000 }, uTime: { value: 0 },
      sunDir: { value: sunDir.clone().normalize() }, sunColor: { value: new THREE.Color(1.0, 0.96, 0.88) },
      absorb: { value: new THREE.Vector3(0.52, 0.13, 0.50) },
      scatterColor: { value: new THREE.Color(0.010, 0.15, 0.085) },
      scatterK: { value: 0.3 },
      wakeOrigin: { value: this.wakeOrigin }, wakeSize: { value: WAKE_SIZE }, wakeTexel: { value: 1 / this.wakeResolution },
      rippleStrength: { value: 0.16 }, wakeStrength: { value: 6.0 }, dbg: { value: 0 },
      seaState: { value: 0 }, weatherWind: { value: new THREE.Vector2(1, 0) },
      rainAmount: { value: 0 }, hailAmount: { value: 0 }, precipitationRipples: { value: Math.max(0, Math.min(1, quality.precipitationRipples ?? 1)) },
      bioluminescence: { value: 0 }, bioColor: { value: new THREE.Color().setRGB(0.015, 0.38, 0.92) },
      tShadow: { value: null }, shadowMatrix: { value: new THREE.Matrix4() }, shadowTexel: { value: 1 / 4096 }, shadowOn: { value: 0 },
      sunIntensity: { value: 1.5 },
      tMurk: { value: null }, murkOrigin: { value: new THREE.Vector2(1e9, 1e9) }, murkSize: { value: MURK_SIZE },
    };
    // water character map (still backwater / duckweed / lake) around the camera, rendered by the terrain workers
    this.murkData = new Uint8ClampedArray(MURK_PX * MURK_PX * 4);
    this.murkTex = new THREE.DataTexture(this.murkData, MURK_PX, MURK_PX, THREE.RGBAFormat); this.murkTex.minFilter = THREE.LinearFilter; this.murkTex.magFilter = THREE.LinearFilter; this.murkTex.needsUpdate = true;
    this.uniforms.tMurk.value = this.murkTex; this.murkCenter = new THREE.Vector2(1e9, 1e9); this.murkBusy = false;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `
        uniform mat4 reflMatrix;
        varying vec3 vWorld; varying vec4 vRefl;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vRefl = reflMatrix * wp;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        precision highp float;
        uniform sampler2D tRefr, tDepth, tRefl, tNormal, tFoam, tWake;
        uniform vec2 resolution; uniform float near, far, uTime;
        uniform vec3 sunDir, sunColor, absorb, scatterColor; uniform float scatterK;
        uniform vec2 wakeOrigin; uniform float wakeSize, wakeTexel, rippleStrength, wakeStrength; uniform int dbg;
        uniform float seaState; uniform vec2 weatherWind; uniform float rainAmount, hailAmount, precipitationRipples;
        uniform float bioluminescence; uniform vec3 bioColor;
        uniform sampler2DShadow tShadow; uniform mat4 shadowMatrix; uniform float shadowTexel, shadowOn, sunIntensity;
        uniform sampler2D tMurk; uniform vec2 murkOrigin; uniform float murkSize;
        varying vec3 vWorld; varying vec4 vRefl;
        float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
        float ign(vec2 p) { return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y)); }
        vec2 hash22(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.xx + p3.yz) * p3.zy);
        }
        // One short-lived expanding ring per deterministic cell. Keeping each centre and radius inside its cell avoids
        // clipped seams without sampling neighbouring cells, textures or another surface simulation.
        vec3 precipitationRing(vec2 world, float now, float cellSize, float rate, float seed, float coverage, float maxRadius) {
          vec2 cell = floor(world / cellSize);
          vec2 local = fract(world / cellSize) - 0.5;
          vec2 rnd = hash22(cell + vec2(seed, seed * 1.91));
          vec2 delta = local - (rnd - 0.5) * 0.26;
          float radialDistance = length(delta);
          float age = fract(now * rate + rnd.x * 0.67 + rnd.y);
          float ringRadius = mix(0.018, maxRadius, age);
          float width = mix(0.028, 0.016, age);
          float ringDelta = radialDistance - ringRadius;
          float band = 1.0 - smoothstep(0.0, width, abs(ringDelta));
          float lifetime = smoothstep(0.0, 0.04, age) * (1.0 - smoothstep(0.78, 1.0, age));
          float cellMask = smoothstep(1.0 - coverage - 0.06, 1.0 - coverage + 0.06, rnd.y);
          float slope = band * clamp(ringDelta / max(width, 0.001), -1.0, 1.0) * lifetime * cellMask;
          return vec3(delta / max(radialDistance, 0.002) * slope, band * lifetime * cellMask);
        }
        // sun shadow on the water surface (trees, tower, the boat itself)
        float sunShadow(vec3 wp) {
          if (shadowOn < 0.5) return 1.0;
          vec4 sc = shadowMatrix * vec4(wp, 1.0); sc.xyz /= sc.w; sc.z -= 0.0006;
          if (any(lessThan(sc.xy, vec2(0.0))) || any(greaterThan(sc.xy, vec2(1.0))) || sc.z > 1.0) return 1.0;
          float phi = ign(gl_FragCoord.xy) * 6.2831853; float r = shadowTexel * 1.8;
          float s = 0.0;
          for (int i = 0; i < 6; i++) {
            float a = phi + float(i) * 2.399963; float rr = r * sqrt((float(i) + 0.5) / 6.0);
            s += texture(tShadow, vec3(sc.xy + vec2(cos(a), sin(a)) * rr, sc.z));
          }
          return s / 6.0;
        }
        void main() {
          vec2 suv = gl_FragCoord.xy / resolution;
          vec3 V = cameraPosition - vWorld; float dist = length(V); V /= dist;
          vec2 w = vWorld.xz;
          float t = uTime;
          vec3 n1 = texture2D(tNormal, w * 0.022 + vec2(0.008, 0.012) * t).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(tNormal, w * 0.07 + vec2(-0.016, 0.009) * t).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(tNormal, w * 0.31 + vec2(0.028, -0.034) * t).xyz * 2.0 - 1.0;
          vec3 n4 = texture2D(tNormal, w * 0.9 + vec2(-0.05, 0.06) * t).xyz * 2.0 - 1.0;
          vec2 nt = n1.xy * 0.6 + n2.xy * 0.35 + n3.xy * 0.18 + n4.xy * 0.07;
          // water character: the channels run clear and green; the still water back in the trees is tannin-black,
          // glassy, and skinned with duckweed where the canopy shades it
          vec2 muv = (w - murkOrigin) / murkSize + 0.5;
          vec4 mk = texture2D(tMurk, clamp(muv, 0.0, 1.0));
          float mEdge = smoothstep(0.0, 0.04, muv.x) * smoothstep(1.0, 0.96, muv.x) * smoothstep(0.0, 0.04, muv.y) * smoothstep(1.0, 0.96, muv.y);
          float murk = mk.r * mEdge, duck = mk.g * mEdge, lake = mk.b * mEdge;
          // distance falloff of fine ripples so far water stays mirror-smooth
          float distFade = 1.0 / (1.0 + dist * 0.012);
          nt *= rippleStrength * distFade * (1.0 - murk * 0.6 + lake * 0.5);
          // Real precipitation changes the nearby surface, not just the air above it. The uniform quality gate is zero
          // on old-hardware tiers; a distance gate also keeps the procedural work off the far-water fragments.
          float impactFade = 1.0 - smoothstep(48.0, 118.0, dist);
          float precipitationCrown = 0.0;
          float rainSurface = precipitationRipples * smoothstep(0.08, 0.72, rainAmount);
          float hailSurface = precipitationRipples * smoothstep(0.22, 0.82, hailAmount);
          if (precipitationRipples > 0.001 && impactFade > 0.001) {
            if (rainSurface > 0.001) {
              vec3 rainRing = precipitationRing(w, t, 0.72, 1.55, 7.3, 0.15 + rainAmount * 0.38, 0.16);
              nt += rainRing.xy * rainSurface * impactFade * 0.052;
              precipitationCrown += rainRing.z * rainSurface * 0.008;
              if (precipitationRipples > 0.8) {
                vec3 fineRing = precipitationRing(w, t, 0.46, 2.15, 17.9, 0.10 + rainAmount * 0.25, 0.13);
                nt += fineRing.xy * rainSurface * impactFade * 0.026;
              }
            }
            if (hailSurface > 0.001) {
              vec3 hailRing = precipitationRing(w, t, 0.82, 0.92, 31.7, 0.16 + hailAmount * 0.12, 0.16);
              nt += hailRing.xy * hailSurface * impactFade * 0.11;
              precipitationCrown += hailRing.z * hailSurface * 0.12;
            }
          }
          // wake
          vec2 wuv = (w - wakeOrigin) / wakeSize + 0.5;
          float foam = 0.0; vec2 wg = vec2(0.0); float wh = 0.0;
          if (all(greaterThan(wuv, vec2(0.0))) && all(lessThan(wuv, vec2(1.0)))) {
            float e = wakeTexel;
            wh = texture2D(tWake, wuv).r;
            float hL = texture2D(tWake, wuv - vec2(e, 0.0)).r, hR = texture2D(tWake, wuv + vec2(e, 0.0)).r;
            float hD = texture2D(tWake, wuv - vec2(0.0, e)).r, hU = texture2D(tWake, wuv + vec2(0.0, e)).r;
            wg = vec2(hR - hL, hU - hD) * wakeStrength;
            foam = texture2D(tWake, wuv).b;
            vec2 ef = smoothstep(0.0, 0.08, wuv) * smoothstep(1.0, 0.92, wuv);
            float f = ef.x * ef.y; wg *= f; foam *= f;
          }
          vec3 N = normalize(vec3(nt.x - wg.x, 1.0, nt.y - wg.y));
          // depth / thickness
          float fragZ = linZ(gl_FragCoord.z);
          float sceneZ = linZ(texture2D(tDepth, suv).r);
          float thick = max(sceneZ - fragZ, 0.0);
          // refraction
          vec2 distort = N.xz * 0.9 * clamp(thick * 0.6, 0.0, 1.0) / max(dist * 0.06, 1.0);
          vec2 ruv = suv + distort;
          float sceneZ2 = linZ(texture2D(tDepth, ruv).r);
          if (sceneZ2 < fragZ) { ruv = suv; sceneZ2 = sceneZ; }
          vec3 refr = texture2D(tRefr, ruv).rgb;
          float th = max(sceneZ2 - fragZ, 0.0);
          // path length through water roughly grows at grazing angles
          float pathLen = th * (1.0 + (1.0 - abs(V.y)) * 0.6);
          vec3 ab = mix(absorb, vec3(1.5, 2.1, 2.7), murk);
          vec3 scCol = mix(scatterColor, vec3(0.045, 0.030, 0.012), murk); float scK = mix(scatterK, 1.4, murk);
          vec3 under = refr * exp(-ab * pathLen);
          vec3 scat = scCol * (1.0 - exp(-scK * pathLen));
          vec3 waterCol = under + scat;
          // reflection
          vec4 rp = vRefl; rp.xy += N.xz * vec2(0.9, 0.9) * rp.w * (0.5 + 0.5 * distFade);
          vec2 rUv = rp.xy / rp.w;
          rUv = clamp(rUv, vec2(0.002), vec2(0.998));
          vec3 refl = texture2D(tRefl, rUv, 1.6 + (1.0 - distFade) * 1.5).rgb;
          float shadow = sunShadow(vWorld);
          scat *= 0.3 + 0.7 * shadow;
          waterCol = under + scat;
          // duckweed: a matte green skin on the shaded still water, in patches, pushed aside by the wake
          float dn = texture2D(tFoam, w * 0.045 + vec2(0.003, -0.002) * t).r * 0.65 + texture2D(tFoam, w * 0.23 - vec2(0.004, 0.003) * t).r * 0.45;
          float dw = smoothstep(0.50, 0.70, dn * (0.45 + duck * 0.8)) * smoothstep(0.2, 0.6, duck);
          dw *= 1.0 - smoothstep(0.02, 0.25, abs(wh) * 6.0 + foam * 1.5);
          // fresnel
          float NdV = max(dot(N, V), 0.0);
          float F = 0.025 + 0.975 * pow(max(1.0 - NdV, 0.0), 5.0);
          F = clamp(F, 0.0, 1.0);
          // sun: GGX lobe whose roughness grows with distance (unresolved ripples) -> broad glint band toward the sun,
          // plus a tight sparkle term from the fine ripple normals up close
          vec3 H = normalize(sunDir + V);
          float NdH = max(dot(N, H), 0.0); float NdL = max(dot(N, sunDir), 0.0); float VdH = max(dot(V, H), 0.0);
          float rough = mix(0.045, 0.19, 1.0 - distFade);
          float a2 = rough * rough;
          float dd = NdH * NdH * (a2 - 1.0) + 1.0;
          float D = a2 / (3.14159 * dd * dd);
          float Fs = 0.02 + 0.98 * pow(max(1.0 - VdH, 0.0), 5.0);
          float k = rough * 0.5; float G = (NdV / (NdV * (1.0 - k) + k)) * (NdL / (NdL * (1.0 - k) + k));
          vec3 spec = sunColor * sunIntensity * D * Fs * G / max(4.0 * NdV * NdL, 0.08) * NdL;
          spec = min(spec, vec3(8.0));
          vec3 Nf = normalize(vec3(nt.x * 2.2 + (n3.x + n4.x) * 0.25 * rippleStrength * distFade, 1.0, nt.y * 2.2 + (n3.y + n4.y) * 0.25 * rippleStrength * distFade));
          float sparkle = pow(max(dot(Nf, H), 0.0), 1400.0) * 5.0 * distFade;
          spec += sunColor * sparkle;
          spec *= shadow * (1.0 - dw);
          vec3 col = mix(waterCol, refl, F) + spec;
          { float dn2 = texture2D(tFoam, w * 1.6).r * 0.6 + texture2D(tFoam, w * 4.1).r * 0.4; vec3 duckCol = mix(vec3(0.045, 0.085, 0.018), vec3(0.11, 0.16, 0.04), dn2) * (0.35 + 0.65 * shadow) * (0.7 + 0.3 * max(sunDir.y, 0.0)); col = mix(col, duckCol, dw * 0.92); }
          // foam
          float fn = texture2D(tFoam, w * 0.55 + vec2(t * 0.03, -t * 0.02)).r;
          float fn2 = texture2D(tFoam, w * 1.7 - vec2(t * 0.05, t * 0.04)).r;
          float shore = (1.0 - smoothstep(0.0, 0.55, th)) * smoothstep(0.35, 0.75, fn * 0.7 + fn2 * 0.5) * 0.6;
          float fmRaw = clamp(foam, 0.0, 1.0);
          float fm = smoothstep(0.08, 0.85, fmRaw * (0.35 + 1.1 * fn + 0.6 * fn2)) * (0.75 + 0.25 * fn2) + shore;
          // Wind-driven caps arrive before the largest storm state. Two advected scales keep them in streaks,
          // rather than turning the entire surface into static television noise.
          float capNoise = texture2D(tFoam, w * 0.045 - weatherWind * t * 0.035).r * 0.7 + texture2D(tFoam, w * 0.13 + weatherWind * t * 0.06).r * 0.3;
          float windCaps = smoothstep(0.74, 0.96, capNoise + length(nt) * 0.65) * smoothstep(0.45, 1.15, seaState) * clamp((seaState - 0.38) * 0.42, 0.0, 0.72);
          fm += windCaps * (0.35 + 0.65 * fn2);
          fm += precipitationCrown * impactFade * (1.0 - dw * 0.78);
          fm = clamp(fm, 0.0, 1.0);
          vec3 foamCol = vec3(0.92, 0.95, 0.93) * (0.75 + 0.25 * max(dot(vec3(0.0, 1.0, 0.0), sunDir), 0.0)) * (0.5 + 0.5 * shadow);
          float bioWake = smoothstep(0.012, 0.42, fmRaw * (0.7 + fn + fn2 * 0.45) + abs(wh) * 2.4);
          float bio = bioluminescence * clamp(bioWake + shore * 0.62, 0.0, 1.0);
          foamCol = mix(foamCol, vec3(0.11, 0.62, 0.86), bioluminescence * 0.68);
          col = mix(col, foamCol, fm);
          col += bioColor * bio * (0.42 + fn * 0.38 + fn2 * 0.56);
          if (dbg == 1) col = refl; else if (dbg == 2) col = vec3(F); else if (dbg == 3) col = vec3(th / 10.0); else if (dbg == 4) col = vec3(rUv, 0.0); else if (dbg == 5) col = N * 0.5 + 0.5; else if (dbg == 6) col = vec3(shadow); else if (dbg == 7) col = spec;
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.material = mat;
    const geo = new THREE.PlaneGeometry(16000, 16000, 1, 1); // follows the camera; must reach past the far plane
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water';
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);

    // helpers for reflection
    this._plane = new THREE.Plane();
    this._normal = new THREE.Vector3(0, 1, 0);
    this._view = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._q = new THREE.Vector4();
    this._clip = new THREE.Plane();
    this._lookAt = new THREE.Vector3();
    this._rot = new THREE.Matrix4();
    this._reflectionPoint = new THREE.Vector3();
    this._clipVector = new THREE.Vector4();
  }

  setQuality(quality = {}) {
    this.reflectionScale = quality.reflectionScale ?? 0.5;
    this.reflectionMipmaps = quality.reflectionMipmaps !== false;
    this.reflRT.texture.generateMipmaps = this.reflectionMipmaps;
    this.reflRT.texture.minFilter = this.reflectionMipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    this.reflRT.texture.needsUpdate = true;
    const wakeResolution = Math.max(128, Math.round(quality.wakeResolution ?? 512));
    this.wakeMaxStamps = Math.max(1, Math.min(MAX_WAKE_STAMPS, Math.round(quality.wakeMaxStamps ?? MAX_WAKE_STAMPS)));
    this.simMat.uniforms.stampCount.value = this.wakeMaxStamps;
    this.uniforms.precipitationRipples.value = Math.max(0, Math.min(1, quality.precipitationRipples ?? 1));
    if (wakeResolution !== this.wakeResolution) {
      this.wakeResolution = wakeResolution;
      this.wakeCell = WAKE_SIZE / wakeResolution;
      this.simMat.uniforms.texel.value = 1 / wakeResolution;
      this.uniforms.wakeTexel.value = 1 / wakeResolution;
      this.wakeA.setSize(wakeResolution, wakeResolution);
      this.wakeB.setSize(wakeResolution, wakeResolution);
      this.wakeNeedsClear = true;
    }
  }

  resize(w, h) {
    this.size.set(w, h);
    this.reflRT.setSize(Math.max(1, Math.floor(w * this.reflectionScale)), Math.max(1, Math.floor(h * this.reflectionScale)));
  }

  memoryStats() {
    const width = this.reflRT.width, height = this.reflRT.height, pixels = width * height;
    const colorBytes = pixels * 8 * (this.reflectionMipmaps ? 4 / 3 : 1), depthBytes = pixels * 4;
    const reflectionAttachmentBytes = Math.round(colorBytes + depthBytes);
    const wakeAttachmentBytes = this.wakeResolution * this.wakeResolution * 8 * 2;
    return {
      width, height, pixels, mipmaps: this.reflectionMipmaps, reflectionAttachmentBytes,
      wakeResolution: this.wakeResolution, wakeMaxStamps: this.wakeMaxStamps, wakeAttachmentBytes,
      precipitationRipples: this.uniforms.precipitationRipples.value,
      estimatedAttachmentBytes: reflectionAttachmentBytes + wakeAttachmentBytes,
    };
  }

  waveHeight(x, z, t) {
    // The same surface drives the render, every boat and every floating prop. Weather adds long wind swell beneath
    // the short chop; tide raises the actual support plane instead of faking a colour change at the shore.
    const ca = Math.cos(this.windAngle), sa = Math.sin(this.windAngle);
    const along = x * ca + z * sa, across = -x * sa + z * ca;
    const sea = this.seaState;
    const ambient = 0.04 * Math.sin(x * 0.18 + t * 0.9) * Math.cos(z * 0.15 + t * 0.7) + 0.025 * Math.sin(x * 0.4 - t * 1.3 + z * 0.3);
    const swell = sea * 0.105 * Math.sin(along * 0.042 - t * (0.62 + sea * 0.12)) * (0.72 + 0.28 * Math.cos(across * 0.018 + t * 0.21));
    const chop = sea * 0.038 * Math.sin(along * 0.24 - t * 1.8 + Math.sin(across * 0.11)) + this.rain * 0.012 * Math.sin(x * 1.7 + z * 1.3 + t * 5.2);
    return this.level + ambient + swell + chop;
  }

  setConditions({ level = this.level, seaState = this.seaState, windAngle = this.windAngle, rain = this.rain, hail = this.hail, wind = this.windSpeed } = {}) {
    this.level = level; this.seaState = seaState; this.windAngle = windAngle; this.rain = rain; this.hail = hail; this.windSpeed = wind;
    this.uniforms.seaState.value = seaState; this.uniforms.weatherWind.value.set(Math.cos(windAngle), Math.sin(windAngle));
    this.uniforms.rainAmount.value = rain; this.uniforms.hailAmount.value = hail;
  }

  // stamp list: [{x,z,radius,height,foam}]
  simulate(center, stampsIn, dt = 1 / 60, flow = null) {
    if (this.wakeNeedsClear) {
      const previousTarget = this.renderer.getRenderTarget();
      this.renderer.setRenderTarget(this.wakeA); this.renderer.clear(true, false, false);
      this.renderer.setRenderTarget(this.wakeB); this.renderer.clear(true, false, false);
      this.renderer.setRenderTarget(previousTarget);
      this.wakeNeedsClear = false;
    }
    const cell = this.wakeCell;
    const nx = Math.round(center.x / cell) * cell, nz = Math.round(center.y / cell) * cell;
    const shift = this.simMat.uniforms.shift.value;
    shift.set((nx - this.wakeOrigin.x) / WAKE_SIZE, (nz - this.wakeOrigin.y) / WAKE_SIZE);
    this.simMat.uniforms.advection.value.set(flow ? flow.x * dt / WAKE_SIZE : 0, flow ? flow.y * dt / WAKE_SIZE : 0);
    this.wakeOrigin.set(nx, nz);
    const stampItems = stampsIn?.items || stampsIn;
    const availableStamps = Number.isFinite(stampsIn?.count) ? stampsIn.count : stampItems.length;
    const stampCount = Math.min(availableStamps, this.wakeMaxStamps, MAX_WAKE_STAMPS);
    this.simMat.uniforms.stampCount.value = stampCount;
    for (let i = 0; i < stampCount; i++) {
      const s = stampItems[i];
      const u = (s.x - nx) / WAKE_SIZE + 0.5, v = (s.z - nz) / WAKE_SIZE + 0.5;
      this.stamps[i].set(u, v, s.radius / WAKE_SIZE, s.height * dt);
      this.foamStamps[i].set(u, v, (s.foamRadius || s.radius) / WAKE_SIZE, (s.foam || 0) * dt);
    }
    this.simMat.uniforms.tPrev.value = this.wakeA.texture;
    this.renderer.setRenderTarget(this.wakeB);
    this.renderer.render(this.simScene, this.simCam);
    const tmp = this.wakeA; this.wakeA = this.wakeB; this.wakeB = tmp;
    this.uniforms.tWake.value = this.wakeA.texture;
  }

  renderReflection(scene, camera) {
    const rc = this.reflCamera;
    const pos = this._reflectionPoint.set(0, this.level, 0);
    const normal = this._normal;
    this._view.subVectors(pos, camera.position);
    if (this._view.dot(normal) > 0) return;
    this._view.reflect(normal).negate().add(pos);
    this._rot.extractRotation(camera.matrixWorld);
    this._lookAt.set(0, 0, -1).applyMatrix4(this._rot).add(camera.position);
    this._target.subVectors(pos, this._lookAt);
    this._target.reflect(normal).negate().add(pos);
    rc.position.copy(this._view);
    rc.up.set(0, 1, 0).applyMatrix4(this._rot).reflect(normal);
    rc.lookAt(this._target);
    rc.far = camera.far; rc.near = camera.near;
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(camera.projectionMatrix);
    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);
    // oblique near plane
    this._clip.setFromNormalAndCoplanarPoint(normal, pos);
    this._clip.applyMatrix4(rc.matrixWorldInverse);
    const clip = this._clipVector.set(this._clip.normal.x, this._clip.normal.y, this._clip.normal.z, this._clip.constant);
    const proj = rc.projectionMatrix;
    const q = this._q;
    q.x = (Math.sign(clip.x) + proj.elements[8]) / proj.elements[0];
    q.y = (Math.sign(clip.y) + proj.elements[9]) / proj.elements[5];
    q.z = -1.0;
    q.w = (1.0 + proj.elements[10]) / proj.elements[14];
    clip.multiplyScalar(2.0 / clip.dot(q));
    proj.elements[2] = clip.x; proj.elements[6] = clip.y; proj.elements[10] = clip.z + 1.0 - 0.0001; proj.elements[14] = clip.w;

    const r = this.renderer;
    // shadow maps are rendered here (once per frame) — the reflection target uses a renderbuffer depth,
    // which avoids a three r185 issue where a shadow pass inside a depth-texture target breaks that depth texture.
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.reflRT);
    r.clear();
    r.render(scene, rc);
    r.shadowMap.needsUpdate = false;
  }

  // bind the sun's shadow map (rendered in renderReflection) so the surface receives tree/boat shadows
  setShadow(light) {
    const map = light.shadow.map;
    if (map && map.depthTexture) {
      this.uniforms.tShadow.value = map.depthTexture;
      this.uniforms.shadowMatrix.value = light.shadow.matrix;
      this.uniforms.shadowTexel.value = 1 / light.shadow.mapSize.x;
      this.uniforms.shadowOn.value = 1;
    }
  }

  update(t) { this.uniforms.uTime.value = t; }
  // keep the water-character map centred near the camera (re-rendered by a worker once it has moved ~500 m)
  updateMurk(terrain, cam) {
    if (this.murkBusy) return;
    if (Math.hypot(cam.x - this.murkCenter.x, cam.z - this.murkCenter.y) < 500) return;
    const cx = Math.round(cam.x / 10) * 10, cz = Math.round(cam.z / 10) * 10;
    this.murkBusy = true;
    terrain.tile(cx - MURK_SIZE / 2, cz - MURK_SIZE / 2, MURK_SIZE, MURK_PX, 'murk').then(rgba => {
      this.murkData.set(rgba); this.murkTex.needsUpdate = true;
      this.uniforms.murkOrigin.value.set(cx, cz); this.murkCenter.set(cx, cz); this.murkBusy = false;
    }).catch(() => { this.murkBusy = false; });
  }
  // water character under a point (0..1 still / duckweed / lake), read back from the map for gameplay (fish, logs)
  murkAt(x, z) {
    const u = (x - this.murkCenter.x) / MURK_SIZE + 0.5, v = (z - this.murkCenter.y) / MURK_SIZE + 0.5;
    if (u < 0 || v < 0 || u >= 1 || v >= 1) return 0;
    return this.murkData[(Math.floor(v * MURK_PX) * MURK_PX + Math.floor(u * MURK_PX)) * 4] / 255;
  }
}
