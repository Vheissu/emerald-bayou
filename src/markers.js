import * as THREE from 'three';
import { cachedResource } from './cache.js';

// Objective markers: a soft light column rising from a ring on the water (waypoint / checkpoint gate),
// crab-trap floats to collect, and a stranded kayaker for the rescue mission.

const COL_VS = `
  varying vec2 vUv; varying vec3 vWp;
  void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWp = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`;
const COL_FS = `
  uniform vec3 color; uniform float uTime, alpha; varying vec2 vUv; varying vec3 vWp;
  void main() {
    float h = clamp(vUv.y, 0.0, 1.0); // MSAA edge samples can extrapolate uv past 1 -> pow(negative) = NaN, which the blur passes smear into a black block
    float fade = pow(max(1.0 - h, 0.0), 2.2) * 0.55;
    float bands = 0.75 + 0.25 * sin(h * 40.0 - uTime * 2.5);
    float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
    gl_FragColor = vec4(color, fade * bands * alpha);
  }`;
const RING_FS = `
  uniform vec3 color; uniform float uTime, alpha; varying vec2 vUv; varying vec3 vWp;
  void main() {
    vec2 c = vUv - 0.5; float r = length(c) * 2.0;
    float ring = smoothstep(0.78, 0.86, r) * smoothstep(1.0, 0.94, r);
    float pulse = smoothstep(0.02, 0.0, abs(r - fract(uTime * 0.6) * 0.9)) * 0.7;
    float fill = smoothstep(0.9, 0.0, r) * 0.12;
    gl_FragColor = vec4(color, (ring + pulse + fill) * alpha);
  }`;

const geometryCache = new Map(), materialCache = new Map();
const geometry = (kind, args, create) => cachedResource(geometryCache, `${kind}:${args.join(':')}`, create);
const boxGeometry = (w, h, d) => geometry('box', [w, h, d], () => new THREE.BoxGeometry(w, h, d));
const cylinderGeometry = (r0, r1, h, seg = 8, open = false) => geometry('cylinder', [r0, r1, h, seg, open], () => new THREE.CylinderGeometry(r0, r1, h, seg, 1, open));
const sphereGeometry = (r, w, h) => geometry('sphere', [r, w, h], () => new THREE.SphereGeometry(r, w, h));
const capsuleGeometry = (r, l, caps, radial) => geometry('capsule', [r, l, caps, radial], () => new THREE.CapsuleGeometry(r, l, caps, radial));
const planeGeometry = (w, h) => geometry('plane', [w, h], () => new THREE.PlaneGeometry(w, h));
const torusGeometry = (r, tube, radial, tubular) => geometry('torus', [r, tube, radial, tubular], () => new THREE.TorusGeometry(r, tube, radial, tubular));
const material = (key, params) => cachedResource(materialCache, key, () => new THREE.MeshStandardMaterial(params));

export class Beacon {
  constructor(color = 0xf07a2e, radius = 5, height = 34) {
    this.group = new THREE.Group();
    this.color = new THREE.Color(color);
    this.uniforms = { color: { value: this.color }, uTime: { value: 0 }, alpha: { value: 1 } };
    const colMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: COL_VS, fragmentShader: COL_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const ringMat = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: COL_VS, fragmentShader: RING_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const col = new THREE.Mesh(cylinderGeometry(radius * 0.55, radius * 0.7, height, 24, true), colMat);
    col.position.y = height / 2; this.group.add(col); this.col = col;
    const ring = new THREE.Mesh(planeGeometry(radius * 2.2, radius * 2.2), ringMat);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25; this.group.add(ring);
    this.group.visible = false; this.radius = radius;
    this.group.traverse(o => { o.frustumCulled = false; o.renderOrder = 5; });
  }
  set(x, y, z, color, column = true) { this.group.position.set(x, y, z); if (color !== undefined) this.color.set(color); this.group.visible = true; this.col.visible = column; }
  hide() { this.group.visible = false; }
  update(t) { this.uniforms.uTime.value = t; }
}

export function crabFloat() {
  const g = new THREE.Group();
  const buoy = new THREE.Mesh(sphereGeometry(0.26, 12, 10), material('crab-buoy', { color: 0xf2f0e6, roughness: 0.6 }));
  buoy.scale.set(1, 1.35, 1); g.add(buoy);
  const band = new THREE.Mesh(cylinderGeometry(0.265, 0.265, 0.14, 12), material('crab-orange', { color: 0xe2552a, roughness: 0.6 }));
  band.position.y = 0.05; g.add(band);
  const stick = new THREE.Mesh(cylinderGeometry(0.02, 0.02, 0.9, 6), material('crab-stick', { color: 0x3a2f24, roughness: 0.9 }));
  stick.position.y = 0.6; g.add(stick);
  const flag = new THREE.Mesh(planeGeometry(0.34, 0.22), material('crab-flag', { color: 0xe2552a, roughness: 0.8, side: THREE.DoubleSide }));
  flag.position.set(0.17, 0.95, 0); g.add(flag);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function kayak() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(sphereGeometry(0.5, 14, 10), material('kayak-hull', { color: 0xd8c24a, roughness: 0.5 }));
  hull.scale.set(0.62, 0.3, 3.2); hull.position.y = 0.05; g.add(hull);
  const cockpit = new THREE.Mesh(cylinderGeometry(0.28, 0.28, 0.12, 12), material('kayak-cockpit', { color: 0x1e1f1c, roughness: 0.9 })); cockpit.position.y = 0.16; g.add(cockpit);
  const skin = material('kayak-skin', { color: 0xc89a78, roughness: 0.8 });
  const torso = new THREE.Mesh(capsuleGeometry(0.16, 0.36, 4, 8), material('kayak-vest', { color: 0xd94b2e, roughness: 0.8 })); torso.position.y = 0.5; g.add(torso);
  const head = new THREE.Mesh(sphereGeometry(0.11, 10, 8), skin); head.position.y = 0.88; g.add(head);
  const hat = new THREE.Mesh(cylinderGeometry(0.19, 0.19, 0.03, 12), material('kayak-hat', { color: 0xe8dcb0, roughness: 0.9 })); hat.position.y = 0.94; g.add(hat);
  const arm = new THREE.Mesh(capsuleGeometry(0.05, 0.4, 4, 6), skin); arm.position.set(0.24, 0.72, 0); arm.rotation.z = -0.9; g.add(arm);
  const paddle = new THREE.Mesh(cylinderGeometry(0.02, 0.02, 2.0, 6), material('kayak-paddle', { color: 0x2a2c2a })); paddle.rotation.z = Math.PI / 2 - 0.35; paddle.position.set(0.3, 0.9, 0); g.add(paddle);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  g.userData.arm = arm;
  return g;
}

// red fuel drum (cargo for the supply run; three of them ride on the foredeck)
export function fuelDrum() {
  const g = new THREE.Group();
  const drum = new THREE.Mesh(cylinderGeometry(0.29, 0.29, 0.86, 16), material('fuel-drum', { color: 0xb8352a, roughness: 0.55, metalness: 0.35 }));
  drum.position.y = 0.43; g.add(drum);
  for (const y of [0.22, 0.64]) { const rib = new THREE.Mesh(torusGeometry(0.3, 0.018, 6, 24), material('fuel-rib', { color: 0x8c2a22, roughness: 0.5, metalness: 0.4 })); rib.rotation.x = Math.PI / 2; rib.position.y = y; g.add(rib); }
  const cap = new THREE.Mesh(cylinderGeometry(0.05, 0.05, 0.04, 10), material('fuel-cap', { color: 0x2a2a2a })); cap.position.set(0.15, 0.88, 0); g.add(cap);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// the sunken skiff: an old johnboat on its side in the shallows, one gunwale just breaking the surface
export function wreck() {
  const g = new THREE.Group();
  const alu = material('wreck-aluminium', { color: 0x55605a, roughness: 0.9, metalness: 0.3 });
  const hull = new THREE.Mesh(boxGeometry(1.5, 0.45, 4.2), alu); hull.rotation.z = 1.25; hull.rotation.y = 0.4; hull.position.y = -0.55; g.add(hull);
  const weed = new THREE.Mesh(sphereGeometry(0.5, 8, 6), material('wreck-weed', { color: 0x3b5a34, roughness: 1 })); weed.scale.set(2.2, 0.25, 1.4); weed.position.set(0.4, -0.35, 0.6); g.add(weed);
  const post = new THREE.Mesh(cylinderGeometry(0.05, 0.06, 1.6, 6), material('wreck-post', { color: 0x3a2f24, roughness: 0.95 })); post.position.set(-1.1, 0.3, -0.8); post.rotation.z = 0.18; g.add(post);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// the fish camp at the top of the creek: a tin-roof shack on stilts with a lantern post
export function shack() {
  const g = new THREE.Group();
  const wood = material('shack-wood', { color: 0x6b5641, roughness: 0.95 });
  const tin = material('shack-tin', { color: 0x8d9391, roughness: 0.5, metalness: 0.6 });
  for (const sx of [-1.6, 1.6]) for (const sz of [-1.6, 1.6]) { const p = new THREE.Mesh(cylinderGeometry(0.1, 0.12, 2.6, 8), wood); p.position.set(sx, 0.9, sz); g.add(p); }
  const floor = new THREE.Mesh(boxGeometry(3.8, 0.12, 3.8), wood); floor.position.y = 2.1; g.add(floor);
  const walls = new THREE.Mesh(boxGeometry(3.3, 2.1, 3.3), material('shack-wall', { color: 0x8a7a63, roughness: 0.95 })); walls.position.y = 3.2; g.add(walls);
  const door = new THREE.Mesh(boxGeometry(0.8, 1.6, 0.06), material('shack-door', { color: 0x3f3229, roughness: 1 })); door.position.set(0, 2.95, 1.68); g.add(door);
  const roof = new THREE.Mesh(boxGeometry(4.2, 0.08, 4.4), tin); roof.position.set(0, 4.35, 0); roof.rotation.x = 0.12; g.add(roof);
  const lamp = new THREE.Mesh(cylinderGeometry(0.04, 0.05, 3.2, 6), wood); lamp.position.set(2.4, 1.6, 2.4); g.add(lamp);
  const bulb = new THREE.Mesh(sphereGeometry(0.12, 8, 6), material('shack-bulb', { color: 0xffe2a0, emissive: 0xffc060, emissiveIntensity: 1.2 })); bulb.position.set(2.4, 3.25, 2.4); g.add(bulb);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
