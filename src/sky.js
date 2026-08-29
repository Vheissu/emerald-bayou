import * as THREE from 'three';

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
  constructor(sunDir) {
    this.sunDir = sunDir.clone().normalize();
    this.uniforms = {
      sunDir: { value: this.sunDir },
      moonDir: { value: this.sunDir.clone().multiplyScalar(-1) },
      lightDir: { value: this.sunDir.clone() },
      windDir: { value: new THREE.Vector2(1, 0.35).normalize() },
      windSpeed: { value: 3.5 },
      uTime: { value: 0 },
      cover: { value: 0.47 },
      daylight: { value: 1 },
      storm: { value: 0 },
      flash: { value: 0 },
      rainbow: { value: 0 },
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
        varying vec3 vDir; uniform vec3 sunDir, moonDir, lightDir; uniform vec2 windDir; uniform float windSpeed, uTime, cover, daylight, storm, flash, rainbow;
        ${SKY_FRAG_NOISE}
        vec3 rainbowSpectrum(float h) {
          vec3 p = abs(fract(h + vec3(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0);
          return clamp(p - 1.0, 0.0, 1.0);
        }
        void main() {
          vec3 d = normalize(vDir);
          float y = d.y;
          float mu = dot(d, sunDir);
          vec3 dayZenith = vec3(0.025, 0.13, 0.43);
          vec3 dayHorizon = vec3(0.43, 0.55, 0.68);
          vec3 nightZenith = vec3(0.0025, 0.008, 0.025);
          vec3 nightHorizon = vec3(0.018, 0.035, 0.060);
          vec3 zenith = mix(nightZenith, dayZenith, daylight);
          vec3 horizon = mix(nightHorizon, dayHorizon, daylight);
          vec3 sky = mix(horizon, zenith, pow(clamp(y, 0.0, 1.0), 0.43));
          // sun-side brightening + haze
          sky += vec3(0.9, 0.85, 0.75) * pow(max(mu, 0.0), 6.0) * 0.22 * daylight;
          sky += vec3(1.0, 0.97, 0.9) * pow(max(mu, 0.0), 420.0) * 30.0 * daylight;
          sky += vec3(1.0, 0.95, 0.85) * pow(max(mu, 0.0), 40.0) * 0.4 * daylight;
          // the warm band is strongest while the sun is on the horizon, then falls away quickly
          float twilight = exp(-abs(sunDir.y) * 13.0) * (1.0 - storm);
          float sunSide = pow(max(dot(normalize(d.xz + 1e-5), normalize(sunDir.xz + 1e-5)), 0.0), 5.0);
          sky += vec3(0.95, 0.22, 0.055) * twilight * sunSide * exp(-abs(y) * 7.0) * 0.75;
          if (y < 0.0) sky = mix(horizon * 0.9, mix(vec3(0.008, 0.015, 0.026), vec3(0.45, 0.55, 0.6), daylight), clamp(-y * 4.0, 0.0, 1.0));
          // cumulus: big towering cells (low-frequency mass, warped), cauliflower detail on top, lit from the sun side
          float yy = max(y, 0.0);
          float hf = smoothstep(0.0, 0.14, yy);
          float cloudOpacity = 0.0;
          if (hf > 0.001) {
            vec2 drift = windDir * uTime * (0.0015 + windSpeed * 0.00018);
            vec2 p = d.xz / (yy + 0.09) + drift;
            vec2 warp = vec2(fbm6(p * 0.22 + 7.0), fbm6(p * 0.22 + 19.0)) - 0.5;
            float big = fbm6(p * 0.27 + warp * 1.6);            // tower mass
            float det = fbm6(p * 0.95 + warp * 0.8 + 3.0);      // cauliflower edge
            float n = big * 0.68 + det * 0.32;
            float dens = smoothstep(cover, cover + 0.17, n);
            float thick = smoothstep(cover, cover + 0.45, n);
            cloudOpacity = max(cloudOpacity, dens * hf * 0.985);
            // self-shadowing: sample toward the active sun or moon and compare
            vec2 toLight = normalize(lightDir.xz + 1e-4) * 0.09;
            float nS = fbm6((p + toLight) * 0.27 + warp * 1.6) * 0.68 + fbm6((p + toLight) * 0.95 + warp * 0.8 + 3.0) * 0.32;
            float lit = clamp((n - nS) * 7.0 + 0.5, 0.0, 1.0);
            // towers: the thicker the cell, the darker its flat base and the brighter its lit crown
            vec3 shade = mix(vec3(0.015, 0.021, 0.032), vec3(0.40, 0.45, 0.56), daylight);
            vec3 base = mix(vec3(0.025, 0.034, 0.050), vec3(0.55, 0.58, 0.66), daylight);
            vec3 bright = mix(vec3(0.08, 0.10, 0.14), vec3(1.12, 1.09, 1.03), daylight);
            shade = mix(shade, vec3(0.035, 0.045, 0.052), storm * 0.78);
            base = mix(base, vec3(0.075, 0.085, 0.092), storm * 0.72);
            bright = mix(bright, vec3(0.20, 0.22, 0.23), storm * 0.58);
            vec3 cloud = mix(mix(base, shade, thick), bright, lit * (0.55 + 0.45 * thick));
            cloud = mix(cloud, bright * 1.05, pow(lit, 3.0) * thick * 0.5);
            // silver lining toward the sun, warm scatter through thin edges
            float edge = dens * (1.0 - thick);
            cloud += vec3(1.0, 0.92, 0.8) * pow(max(mu, 0.0), 10.0) * (0.35 * edge + 0.12) * daylight;
            // lower cloud bases catch the haze near the horizon
            cloud = mix(cloud, horizon * 1.05, (1.0 - hf) * 0.6);
            sky = mix(sky, cloud, dens * hf * 0.985);
            // A severe cell hangs a ragged shelf below the main deck. Reusing the cloud field keeps
            // this free of another noise octave stack and removes the clean horizontal storm ceiling.
            float shelfBand = smoothstep(0.015, 0.12, yy) * (1.0 - smoothstep(0.24, 0.48, yy));
            vec3 scud = mix(vec3(0.018, 0.027, 0.032), vec3(0.12, 0.15, 0.16), lit * 0.45 + flash * 0.8);
            sky = mix(sky, scud, dens * shelfBand * storm * 0.74);
            // thin high cirrus
            vec2 p2 = d.xz / (yy + 0.12) * 0.7 + drift * 0.55;
            float ci = smoothstep(0.62, 0.9, fbm6(p2 * 1.7 + 30.0)) * 0.18;
            sky = mix(sky, mix(vec3(0.09, 0.11, 0.16), vec3(0.95, 0.97, 1.0), daylight), ci * hf * (1.0 - dens));
            cloudOpacity = max(cloudOpacity, ci * hf * 0.55);
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
          float moonR = length(moonQ), moonDisc = 1.0 - smoothstep(0.90, 1.04, moonR);
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
          sky += vec3(0.72, 0.83, 0.92) * flash;
          gl_FragColor = vec4(sky, 1.0);
        }`,
    });
    const geo = new THREE.SphereGeometry(3000, 48, 24);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
  }
  resourceStats() {
    return { objects: 1, geometries: 1, materials: 1, textures: 0, rainbow: this.uniforms.rainbow.value };
  }
  update(t, camPos) { this.uniforms.uTime.value = t; this.mesh.position.copy(camPos); }
}
