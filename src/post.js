import * as THREE from 'three';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

const QUAD_VS = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

function quadPass(material) {
  const scene = new THREE.Scene(); const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material); mesh.frustumCulled = false; scene.add(mesh);
  return { scene, cam, material };
}

export class Pipeline {
  constructor(renderer, camera) {
    this.renderer = renderer; this.camera = camera;
    const size = new THREE.Vector2(); renderer.getDrawingBufferSize(size);
    this.size = size;
    const w = size.x, h = size.y;
    const depthA = new THREE.DepthTexture(w, h); depthA.format = THREE.DepthFormat; depthA.type = THREE.UnsignedIntType;
    this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: depthA, depthBuffer: true, samples: 4 });
    const depthB = new THREE.DepthTexture(w, h); depthB.format = THREE.DepthFormat; depthB.type = THREE.UnsignedIntType;
    // The opaque scene has already been resolved from 4x MSAA before it reaches this target. Water and spray are
    // full-screen or alpha-soft, and the composite is followed by FXAA, so a second multisample colour + depth pair
    // only duplicates a very large set of GPU attachments (about 169 MiB at a 2560x1440 drawing buffer).
    this.compRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthTexture: depthB, depthBuffer: true });
    this.ldrRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.aaRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, depthBuffer: false });
    const bw = Math.floor(w / 4), bh = Math.floor(h / 4);
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
        tColor: { value: this.compRT.texture }, tDepth: { value: depthB }, tBloom: { value: this.bloomA.texture },
        near: { value: camera.near }, far: { value: camera.far }, exposure: { value: 1.0 },
        fogColor: { value: new THREE.Color(0.60, 0.69, 0.74) }, fogDensity: { value: 0.00032 }, bloomAmt: { value: 0.12 },
        invProj: { value: new THREE.Matrix4() }, camMat: { value: new THREE.Matrix4() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
      },
      vertexShader: QUAD_VS,
      fragmentShader: `
        uniform sampler2D tColor, tDepth, tBloom; uniform float near, far, exposure, fogDensity, bloomAmt; uniform vec3 fogColor, sunDir;
        uniform mat4 invProj, camMat; varying vec2 vUv;
        vec3 aces(vec3 x) { const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0); }
        float linZ(float d) { float z = d * 2.0 - 1.0; return 2.0 * near * far / (far + near - z * (far - near)); }
        void main() {
          vec3 c = texture2D(tColor, vUv).rgb;
          float d = texture2D(tDepth, vUv).r;
          // view ray for aerial perspective tint
          vec4 vp = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0); vec3 vdir = normalize((camMat * vec4(vp.xyz / vp.w, 0.0)).xyz);
          float sunAmt = pow(max(dot(vdir, sunDir), 0.0), 8.0);
          vec3 fc = mix(fogColor, vec3(0.95, 0.9, 0.8), sunAmt * 0.5);
          if (d < 0.99999) {
            float z = linZ(d);
            float dist = z;
            float f = 1.0 - exp(-dist * fogDensity);
            f = clamp(f, 0.0, 0.6);
            c = mix(c, fc * 1.05, f);
          }
          c += texture2D(tBloom, vUv).rgb * bloomAmt;
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
  }
  resize(w, h) {
    this.size.set(w, h);
    this.sceneRT.setSize(w, h); this.compRT.setSize(w, h); this.ldrRT.setSize(w, h); this.aaRT.setSize(w, h);
    this.final.material.uniforms.resolution.value.set(w, h); this.final.material.uniforms.maxCoc.value = h * 0.0022;
    this.bloomA.setSize(Math.floor(w / 4), Math.floor(h / 4)); this.bloomB.setSize(Math.floor(w / 4), Math.floor(h / 4));
    this.fxaa.material.uniforms.resolution.value.set(1 / w, 1 / h);
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
    // bloom
    r.setRenderTarget(this.bloomA); r.render(this.bright.scene, this.bright.cam);
    this.blur.material.uniforms.tColor.value = this.bloomA.texture; this.blur.material.uniforms.dir.value.set(1 / this.bloomA.width, 0);
    r.setRenderTarget(this.bloomB); r.render(this.blur.scene, this.blur.cam);
    this.blur.material.uniforms.tColor.value = this.bloomB.texture; this.blur.material.uniforms.dir.value.set(0, 1 / this.bloomA.height);
    r.setRenderTarget(this.bloomA); r.render(this.blur.scene, this.blur.cam);
    // grade
    const u = this.grade.material.uniforms;
    u.invProj.value.copy(camera.projectionMatrixInverse); u.camMat.value.copy(camera.matrixWorld);
    r.setRenderTarget(this.ldrRT); r.render(this.grade.scene, this.grade.cam);
    r.setRenderTarget(this.aaRT); r.render(this.fxaa.scene, this.fxaa.cam);
    r.setRenderTarget(null); r.render(this.final.scene, this.final.cam);
  }
}
