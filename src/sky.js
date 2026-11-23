import * as THREE from 'three';
import { WEATHER_BAND_GLSL } from './weatherfronts.js';

export const SKY_FRAG_NOISE = `
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i), b = hash21(i + vec2(1, 0)), c = hash21(i + vec2(0, 1)), d = hash21(i + vec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float fbm6(vec2 p) {
  float s = 0.0, a = 0.5; mat2 m = mat2(0.8, 0.6, -0.6, 0.8) * 2.02;
  for (int i = 0; i < 6; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
  return s;
}
`;

export class Sky {
  constructor(sunDir, profile = {}) {
    this.sunDir = sunDir.clone().normalize();
    this.uniforms = {
      sunDir: { value: this.sunDir },
      moonDir: { value: this.sunDir.clone().multiplyScalar(-1) },
      lightDir: { value: this.sunDir.clone() },
      windDir: { value: new THREE.Vector2(1, 0.35).normalize() },
      windSpeed: { value: 3.5 },
      uTime: { value: 0 },
      cover: { value: 0.47 },
      tCloudBank: { value: null },
      hasCloudBank: { value: 0 },
      daylight: { value: 1 },
      storm: { value: 0 },
      flash: { value: 0 },
      flashDir: { value: this.sunDir.clone() },
      rain: { value: 0 },
      bandRain: { value: 0 },
      bandCenter: { value: new THREE.Vector2() },
      bandWind: { value: new THREE.Vector2(1, 0) },
      bandSize: { value: new THREE.Vector2(1, 1) },
      bandPhase: { value: 0 },
      rainbow: { value: 0 },
      weatherDetail: { value: Math.max(0, Math.min(1, Number(profile.skyWeatherDetail) || 0)) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vDir; uniform vec3 sunDir, moonDir, lightDir, flashDir; uniform vec2 windDir; uniform float windSpeed, uTime, cover, daylight, storm, flash, rain, rainbow, weatherDetail;
        uniform sampler2D tCloudBank; uniform float hasCloudBank;
        uniform vec2 bandCenter, bandWind, bandSize;
        uniform float bandRain, bandPhase;
        ${SKY_FRAG_NOISE}
        ${WEATHER_BAND_GLSL}
        // Find the nearest part of the elliptical shower along this sightline. Three samples
        // through its width preserve both the leading edge and the weaker trailing rain.
        float curtainDepth(vec3 ray) {
          vec2 side = vec2(-bandWind.y, bandWind.x);
          vec2 origin = cameraPosition.xz - bandCenter;
          vec2 uv = vec2(dot(origin, bandWind), dot(origin, side)) / bandSize;
          vec2 dir = vec2(dot(ray.xz, bandWind), dot(ray.xz, side)) / bandSize;
          float norm2 = max(dot(dir, dir), 0.0000001);
          float across = inversesqrt(norm2);
          float nearT = max(0.0, -dot(uv, dir) / norm2);
          float depth = 0.0;
          for (int i = 0; i < 3; i++) {
            float t = nearT + (float(i) - 0.75) * across * 0.74;
            if (t <= 0.0 || t > 6500.0) continue;
            vec2 p = cameraPosition.xz + t * ray.xz;
            float height = cameraPosition.y + t * ray.y;
            float strength = weatherBandStrength(p, bandCenter, bandWind, bandSize, bandPhase);
            float cloudBase = mix(195.0, 330.0, strength);
            depth += strength * (1.0 - smoothstep(cloudBase * 0.62, cloudBase, height))
              * smoothstep(0.0, 85.0, t) * (1.0 - smoothstep(2800.0, 6500.0, t));
          }
          return 1.0 - exp(-depth * min(across, 1200.0) * 0.0025);
        }
        vec3 rainbowSpectrum(float h) {
          vec3 p = abs(fract(h + vec3(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0);
          return clamp(p - 1.0, 0.0, 1.0);
        }

        float fbm4(vec2 p) {
          float s = 0.0, a = 0.5; mat2 m = mat2(0.8, 0.6, -0.6, 0.8) * 2.02;
          for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
          return s * 1.05;
        }
        float fbm5(vec2 p) {
          float s = 0.0, a = 0.5; mat2 m = mat2(0.8, 0.6, -0.6, 0.8) * 2.02;
          for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = m * p; a *= 0.5; }
          return s * 1.016;
        }
        // value noise whose x lattice wraps, so banks circle the horizon without an azimuth seam
        float pnoise(vec2 p, float period) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          float x0 = mod(i.x, period), x1 = mod(i.x + 1.0, period);
          float a = hash21(vec2(x0, i.y)), b = hash21(vec2(x1, i.y));
          float c = hash21(vec2(x0, i.y + 1.0)), e = hash21(vec2(x1, i.y + 1.0));
          return mix(mix(a, b, f.x), mix(c, e, f.x), f.y);
        }
        float pfbm(vec2 p, float period, int octaves) {
          float s = 0.0, a = 0.5, w = 0.0;
          for (int i = 0; i < 4; i++) {
            if (i >= octaves) break;
            s += a * pnoise(p, period); w += a;
            p = p * 2.0 + vec2(0.0, 17.31); period *= 2.0; a *= 0.5;
          }
          return s / w;
        }
        // x: coverage, y: height within the tower (0 base .. 1 crown), z: lobe bulge (0 rim .. 1 core)
        vec4 cumulusBank(float u01, float el, float period, float baseEl, float maxH, float seed, float drift, float t) {
          float u = u01 * period + drift;
          float unitEl = 6.2831853 / period;
          float tower = smoothstep(cover - 0.02, cover + 0.2, pfbm(vec2(u, seed), period, 3));
          float hTop = maxH * tower * (0.55 + 0.45 * tower);
          float above = el - baseEl - (pnoise(vec2(u * 2.0, seed + 5.0), period * 2.0) - 0.5) * 0.012;
          vec2 q = vec2(u, above / unitEl + seed) * 3.0 - vec2(0.0, t * 0.006);
          float puff = pfbm(q, period * 3.0, 4);
          float amp = maxH * 0.3 * smoothstep(0.0, 0.3, tower);
          float sdTop = hTop - above + (puff - 0.5) * 2.0 * amp;
          float aa = max(fwidth(el) * 1.5, 0.0025);
          float alpha = smoothstep(0.0, aa + 0.004, sdTop) * smoothstep(-0.006, 0.018, above) * smoothstep(0.004, 0.03, hTop);
          float hFrac = clamp(above / max(hTop + amp * 0.5, 1e-3), 0.0, 1.0);
          float bulge = smoothstep(0.0, 0.05 + maxH * 0.18, min(sdTop, above * 0.7 + 0.01)) * (0.48 + 0.52 * puff);
          return vec4(alpha * 0.98, hFrac, bulge, tower);
        }
        void main() {
          vec3 d = normalize(vDir);
          float y = d.y;
          float mu = dot(d, sunDir);
          float flashField = flash;
          if (flash > 0.001 && weatherDetail > 0.001) {
            float flashLobe = pow(max(dot(d, flashDir), 0.0), 5.0);
            flashField = flash * (0.18 + flashLobe * 1.35);
          }
          vec3 dayZenith = vec3(0.052, 0.18, 0.37);
          vec3 dayHorizon = vec3(0.49, 0.64, 0.71);
          vec3 nightZenith = vec3(0.0025, 0.008, 0.025);
          vec3 nightHorizon = vec3(0.018, 0.035, 0.060);
          vec3 zenith = mix(nightZenith, dayZenith, daylight);
          vec3 horizon = mix(nightHorizon, dayHorizon, daylight);
          float lowSun = (1.0 - smoothstep(0.03, 0.4, abs(sunDir.y))) * (1.0 - storm);
          float sunSide = 0.5 + 0.5 * dot(normalize(d.xz + 1e-5), normalize(sunDir.xz + 1e-5));
          horizon = mix(horizon, vec3(1.42, 0.66, 0.24), lowSun * daylight * (0.24 + 0.68 * sunSide * sunSide));
          vec3 sky = mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.59));
          // sun-side brightening + haze
          sky += vec3(0.9, 0.85, 0.75) * pow(max(mu, 0.0), 6.0) * 0.22 * daylight;
          vec3 solarTint = mix(vec3(1.0, 0.97, 0.88), vec3(1.0, 0.65, 0.27), lowSun);
          float discEdge = clamp(fwidth(mu), 0.000002, 0.00003);
          float disc = smoothstep(0.999978 - discEdge, 0.999978 + discEdge, mu);
          sky += solarTint * (14.0 * disc + 1.25 * pow(max(mu, 0.0), 220.0)) * daylight;
          sky += vec3(1.0, 0.95, 0.85) * pow(max(mu, 0.0), 40.0) * 0.4 * daylight;
          // the warm band is strongest while the sun is on the horizon, then falls away quickly
          float twilight = exp(-abs(sunDir.y) * 13.0) * (1.0 - storm);
          sky += vec3(0.95, 0.22, 0.055) * twilight * pow(sunSide, 5.0) * exp(-abs(y) * 7.0) * 0.75;
          if (y < 0.0) sky = mix(horizon * 0.9, mix(vec3(0.008, 0.015, 0.026), vec3(0.45, 0.55, 0.6), daylight), clamp(-y * 4.0, 0.0, 1.0));
          // Cumulus. Low banks are modelled as columns standing on the horizon: each has a flat, ragged base, a
          // dome-shaped crown and cauliflower puffs, so the chase camera sees real silhouettes instead of a textured
          // ceiling. Screen-space derivatives of the puff bulge give per-lobe normals for free, lit by the active
          // sun or moon. A plane-projected deck fills the zenith and closes over everything as cover drops.
          float yy = max(y, 0.0);
          float hf = smoothstep(0.0, 0.14, yy);
          float cloudOpacity = 0.0;
          if (y > -0.02) {
            vec2 drift = windDir * uTime * (0.0015 + windSpeed * 0.00018);
            float el = asin(clamp(y, -1.0, 1.0));
            float u01 = atan(d.z, d.x) * 0.15915494 + 0.5;
            vec3 right = normalize(vec3(-d.z, 0.0, d.x) + vec3(1e-5, 0.0, 0.0));
            vec3 upT = normalize(vec3(0.0, 1.0, 0.0) - d * y + vec3(0.0, 1e-5, 0.0));
            vec3 ddx = dFdx(d), ddy = dFdy(d);
            vec4 jac = vec4(dot(ddx, right), dot(ddx, upT), dot(ddy, right), dot(ddy, upT));
            vec3 lightLocal = vec3(dot(lightDir, right), dot(lightDir, upT), -dot(lightDir, d));
            float lightUp = smoothstep(-0.06, 0.1, lightDir.y);
            float bankDrift = uTime * (0.0006 + windSpeed * 0.00012);
            vec3 cLit = mix(vec3(0.085, 0.10, 0.135), vec3(1.22, 1.17, 1.08), daylight);
            vec3 cShade = mix(vec3(0.018, 0.025, 0.038), vec3(0.47, 0.53, 0.63), daylight);
            cLit *= mix(vec3(1.0), vec3(1.42, 0.88, 0.52), lowSun * daylight);
            cShade *= mix(vec3(1.0), vec3(0.98, 0.76, 0.76), lowSun * daylight);
            cLit = mix(cLit, vec3(0.19, 0.21, 0.22), storm * 0.6);
            cShade = mix(cShade, vec3(0.04, 0.05, 0.056), storm * 0.75);
            float sunGlow = pow(max(mu, 0.0), 7.0) * daylight * (1.0 - storm * 0.8);
            // thin high cirrus sits behind every cumulus layer
            vec2 p2 = d.xz / (yy + 0.12) * 0.7 + drift * 0.55;
            float ci = smoothstep(0.6, 0.88, fbm4(p2 * 1.7 + 30.0)) * 0.2 * hf;
            sky = mix(sky, mix(vec3(0.09, 0.11, 0.16), vec3(0.97, 0.98, 1.0), daylight) * mix(vec3(1.0), vec3(1.3, 0.8, 0.6), lowSun), ci);
            cloudOpacity = ci * 0.55;
            // far bank (small, low, hazed) then near bank (big towers). Tier 0 keeps only the near bank.
            for (int layer = 0; layer < 2; layer++) {
              if (layer == 0 && weatherDetail < 0.01) continue;
              float nearL = float(layer);
              float period = mix(20.0, 9.0, nearL);
              float baseEl = mix(0.03, 0.078, nearL);
              float maxH = mix(0.15, 0.42, nearL);
              float seed = mix(3.7, 11.3, nearL);
              if (hasCloudBank > 0.5) {
                // Vary the spacing, scale and orientation of the low banks around the horizon.
                // Their alpha and interior luminance describe cloud density; the active light
                // and storm field determine radiance, including in the planar reflection.
                float cells = mix(12.0, 6.0, nearL);
                float track = u01 * cells + seed + bankDrift * cells * 0.08;
                float id = mod(floor(track), cells);
                vec2 variation = vec2(hash21(vec2(id, seed)), hash21(vec2(seed, id + 0.7)));
                float localX = (fract(track) - 0.5) * mix(1.05, 1.64, variation.x) + 0.5;
                if (variation.y < 0.5) localX = 1.0 - localX;
                float height = maxH * mix(0.50, 1.06, variation.y);
                float localY = 0.20 + (el - baseEl * mix(0.45, 1.4, variation.x)) * 0.58 / height;
                vec2 cloudUv = vec2(localX, localY);
                float density = smoothstep(cover - 0.23, cover + 0.14, variation.y * 0.68 + 0.2);
                if (density > 0.001 && all(greaterThan(cloudUv, vec2(0.0))) && all(lessThan(cloudUv, vec2(1.0)))) {
                  vec4 bank = texture2D(tCloudBank, cloudUv);
                  float alpha = bank.a * density * smoothstep(0.0, 0.045, min(localX, 1.0 - localX));
                  float interior = smoothstep(0.43, 0.96, bank.r * 0.55 + bank.g * 0.45);
                  vec3 lit = mix(cShade * (0.69 + 0.18 * nearL), cLit, interior * (0.64 + 0.36 * lightUp));
                  lit += solarTint * sunGlow * smoothstep(0.65, 0.99, interior) * 0.24;
                  float haze = mix(0.55, 0.12, nearL) * (1.0 - smoothstep(0.05, 0.32, el));
                  sky = mix(sky, mix(lit, horizon, haze), alpha);
                  cloudOpacity = max(cloudOpacity, alpha);
                }
                continue;
              }
              vec4 cb = cumulusBank(u01, el, period, baseEl, maxH, seed, bankDrift * period / 9.0, uTime);
              float alpha = cb.x;
              float bulge = cb.z;
              float bx = dFdx(bulge), by = dFdy(bulge);
              float jd = jac.x * jac.w - jac.y * jac.z;
              vec2 g = abs(jd) > 1e-12 ? vec2(bx * jac.w - by * jac.y, jac.x * by - jac.z * bx) / jd : vec2(0.0);
              vec3 nrm = normalize(vec3(-g * mix(0.035, 0.06, nearL), 1.0));
              float diffuse = clamp(dot(nrm, lightLocal) * 0.6 + 0.42, 0.0, 1.0);
              float crown = smoothstep(0.08, 0.85, cb.y);
              float litAmt = clamp(diffuse * (0.42 + 0.72 * crown), 0.0, 1.0) * lightUp;
              vec3 col = mix(cShade, cLit, litAmt);
              col = mix(cShade * 0.8, col, smoothstep(0.0, 0.2, cb.y));
              // backlit lobes glow through their thin rims, front-lit ones keep a soft sun-side lift
              col += mix(vec3(1.0, 0.93, 0.8), vec3(1.0, 0.62, 0.3), lowSun) * sunGlow * (1.0 - bulge) * 0.75;
              col += cLit * sunGlow * 0.12;
              float haze = mix(0.42, 0.16, nearL) * (1.0 - smoothstep(0.0, 0.2, el));
              col = mix(col, horizon * 1.02, haze);
              sky = mix(sky, col, alpha);
              cloudOpacity = max(cloudOpacity, alpha);
            }
            // zenith deck: the same domain-warped field as before, with a much tighter edge and a light-ward tap
            vec2 p = d.xz / (yy + 0.09) + drift;
            vec2 warp = vec2(fbm4(p * 0.22 + 7.0), fbm4(p * 0.22 + 19.0)) - 0.5;
            float big = fbm5(p * 0.27 + warp * 1.6);
            float det = fbm4(p * 0.95 + warp * 0.8 + 3.0);
            float n = big * 0.68 + det * 0.32;
            float overcast = 1.0 - smoothstep(0.3, 0.46, cover);
            float deckMask = max(smoothstep(0.17, 0.46, yy), overcast) * hf;
            float dens = smoothstep(cover - 0.01, cover + 0.07, n) * deckMask;
            float thick = smoothstep(cover + 0.02, cover + 0.24, n);
            vec2 toLight = normalize(lightDir.xz + 1e-4) * 0.22;
            float nS = fbm5((p + toLight) * 0.27 + warp * 1.6) * 0.68 + det * 0.32;
            float lit = clamp((n - nS) * 7.0 + 0.5, 0.0, 1.0);
            if (dens > 0.002) {
              vec3 deck = mix(cShade, cLit, clamp(lit * (1.0 - thick * 0.55) * (0.55 + 0.45 * lightUp), 0.0, 1.0));
              deck = mix(deck, cShade * 0.82, thick * 0.45);
              deck += mix(vec3(1.0, 0.93, 0.8), vec3(1.0, 0.62, 0.3), lowSun) * sunGlow * (1.0 - thick) * 0.55;
              deck = mix(deck, horizon * 1.05, (1.0 - hf) * 0.6);
              sky = mix(sky, deck, dens * 0.985);
              cloudOpacity = max(cloudOpacity, dens * 0.985);
            }
            // A severe cell hangs a ragged shelf below the main deck. Reusing the cloud field keeps
            // this free of another noise octave stack and removes the clean horizontal storm ceiling.
            float shelfDens = smoothstep(cover - 0.035, cover + 0.105, n) * hf;
            float shelfBand = smoothstep(0.015, 0.12, yy) * (1.0 - smoothstep(0.24, 0.48, yy));
            vec3 scud = mix(vec3(0.018, 0.027, 0.032), vec3(0.12, 0.15, 0.16), lit * 0.45 + flashField * 0.8);
            sky = mix(sky, scud, shelfDens * shelfBand * storm * 0.74);
            // Patchy precipitation shafts make an approaching squall readable before drops reach the boat. They
            // reuse this cell's existing mass/detail fields, add no textures or objects, and disappear on fallback.
            if (weatherDetail > 0.001 && bandRain > 0.001 && yy < 0.80) {
              float depth = curtainDepth(d);
              float strands = vnoise(vec2(dot(d.xz, vec2(113.0, 71.0)) + yy * 8.0, yy * 16.0 - uTime * 0.09));
              float veil = depth * sqrt(bandRain) * (0.73 + 0.27 * strands) * weatherDetail
                * (1.0 - smoothstep(0.60, 0.80, yy));
              vec3 curtain = mix(vec3(0.028, 0.035, 0.048), vec3(0.27, 0.32, 0.36), daylight);
              curtain += solarTint * lowSun * sunSide * daylight * 0.14 + flashField * vec3(0.31, 0.38, 0.46);
              sky = mix(sky, curtain, veil * 0.84);
            } else if (weatherDetail > 0.001 && rain > 0.001) {
              float rainBand = smoothstep(0.012, 0.055, yy) * (1.0 - smoothstep(0.27, 0.43, yy));
              float rainCell = smoothstep(cover - 0.08, cover + 0.13, big * 0.78 + det * 0.22);
              float azimuth = atan(d.z, d.x);
              float strands = 0.78 + 0.22 * sin(azimuth * 83.0 + yy * 330.0 - uTime * (0.19 + windSpeed * 0.012));
              float rainVeil = rain * weatherDetail * rainBand * rainCell * strands;
              vec3 rainColour = mix(vec3(0.012, 0.022, 0.033), vec3(0.20, 0.27, 0.31), daylight);
              rainColour += vec3(0.34, 0.43, 0.53) * flashField * 0.65;
              sky = mix(sky, rainColour, clamp(rainVeil * (0.30 + storm * 0.34), 0.0, 0.58));
            }
          }
          // A real bow is a cone around the antisolar point: red lies outside the primary at about 42 degrees,
          // while the faint secondary sits near 51 degrees with its colour order reversed. A broken rain-curtain
          // modulation keeps both arcs atmospheric instead of drawing a clean HUD ring. This is part of the existing
          // sky draw, so it also reaches the planar water reflection without another mesh, texture or render pass.
          if (rainbow > 0.001 && y > 0.003) {
            float anti = dot(d, -sunDir);
            float primaryT = (anti - 0.7373) / (0.7660 - 0.7373);
            float secondaryT = (anti - 0.5948) / (0.6428 - 0.5948);
            float primaryBand = smoothstep(0.0, 0.09, primaryT) * (1.0 - smoothstep(0.91, 1.0, primaryT));
            float secondaryBand = smoothstep(0.0, 0.1, secondaryT) * (1.0 - smoothstep(0.9, 1.0, secondaryT));
            float curtain = mix(0.42, 1.08, vnoise(d.xz * 7.5 + windDir * uTime * 0.008));
            float horizonFade = smoothstep(0.003, 0.045, y);
            float bowLight = rainbow * horizonFade * curtain * mix(0.72, 1.08, cloudOpacity);
            float alexander = smoothstep(0.6428, 0.665, anti) * (1.0 - smoothstep(0.714, 0.7373, anti));
            sky *= 1.0 - alexander * bowLight * 0.035;
            vec3 primaryColor = mix(vec3(0.76), rainbowSpectrum(primaryT * 0.76), 0.76);
            vec3 secondaryColor = mix(vec3(0.72), rainbowSpectrum((1.0 - secondaryT) * 0.76), 0.7);
            sky += primaryColor * primaryBand * bowLight * 0.24;
            sky += secondaryColor * secondaryBand * bowLight * 0.055;
          }
          // stars are sparse enough to read as points, not procedural noise. Cloud cover erases them first.
          if (y > 0.03) {
            vec2 starUv = d.xz / (abs(y) + 0.22);
            vec2 starCell = floor(starUv * 185.0);
            float sh = hash21(starCell);
            float star = smoothstep(0.9977, 1.0, sh) * (0.72 + 0.28 * sin(uTime * (1.2 + sh * 1.6) + sh * 80.0));
            star *= (1.0 - daylight) * (1.0 - storm) * (1.0 - cloudOpacity) * smoothstep(0.03, 0.18, y);
            sky += vec3(0.72, 0.82, 1.0) * star * 1.8;
          }
          // The Moon is a shaded sphere rather than an always-full point. Its terminator follows the actual Sun/Moon
          // angle, so crescents, quarters and the full disc agree with moonrise timing and the spring-neap tide.
          float moonDot = max(dot(d, moonDir), 0.0);
          vec3 moonAxis = abs(moonDir.y) > 0.92 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
          vec3 moonRight = normalize(cross(moonAxis, moonDir));
          vec3 moonUp = normalize(cross(moonDir, moonRight));
          vec2 moonQ = vec2(dot(d, moonRight), dot(d, moonUp)) / 0.014;
          float moonR = length(moonQ), moonDisc = (1.0 - smoothstep(0.90, 1.04, moonR)) * step(0.5, moonDot);
          float moonZ = sqrt(max(0.0, 1.0 - moonR * moonR));
          vec3 moonNormal = normalize(moonRight * moonQ.x + moonUp * moonQ.y - moonDir * moonZ);
          float moonLit = smoothstep(0.005, 0.045, dot(moonNormal, sunDir));
          float phaseLight = clamp((1.0 - dot(sunDir, moonDir)) * 0.5, 0.0, 1.0);
          float moonClear = (1.0 - cloudOpacity) * (1.0 - storm * 0.82);
          float earthshine = 0.012 * (1.0 - phaseLight);
          sky += vec3(0.70, 0.79, 0.94) * moonDisc * (earthshine + moonLit * 2.6) * moonClear * mix(0.32, 1.0, 1.0 - daylight);
          float moonHalo = pow(moonDot, 80.0) * phaseLight * (1.0 - daylight);
          sky += vec3(0.48, 0.62, 0.92) * moonHalo * 0.13 * moonClear;
          // A severe cell removes skylight instead of washing the whole dome toward pale grey.
          // This keeps the horizon legible while giving lightning enough darkness to own the frame.
          sky = mix(sky, vec3(0.055, 0.075, 0.082), storm * 0.58);
          sky += vec3(0.72, 0.83, 0.92) * flashField;
          gl_FragColor = vec4(sky, 1.0);
        }`,
    });
    const geo = new THREE.SphereGeometry(3000, 48, 24);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
  }
  setQuality(profile = {}) {
    this.uniforms.weatherDetail.value = Math.max(0, Math.min(1, Number(profile.skyWeatherDetail) || 0));
    return this.uniforms.weatherDetail.value;
  }
  setCloudBank(image) {
    this.uniforms.tCloudBank.value?.dispose();
    this.uniforms.tCloudBank.value = image ? new THREE.CanvasTexture(image) : null;
    this.uniforms.hasCloudBank.value = image ? 1 : 0;
  }
  setRainField(band, mix, targetRain) {
    const u = this.uniforms;
    u.bandRain.value = band ? mix * mix * (3 - 2 * mix) * targetRain : 0;
    if (!band) return;
    const travel = band.age * band.shape.speed;
    u.bandCenter.value.set(band.x + band.alongX * travel, band.z + band.alongZ * travel);
    u.bandWind.value.set(band.alongX, band.alongZ);
    u.bandSize.value.set(band.shape.width, band.shape.length);
    u.bandPhase.value = band.phase;
  }
  resourceStats() {
    return {
      objects: 1, geometries: 1, materials: 1, textures: this.uniforms.hasCloudBank.value,
      rain: this.uniforms.rain.value, rainbow: this.uniforms.rainbow.value, weatherDetail: this.uniforms.weatherDetail.value,
    };
  }
  update(t, camPos) { this.uniforms.uTime.value = t; this.mesh.position.copy(camPos); }
}
