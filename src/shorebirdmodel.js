import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const plumage = new URL('../assets/wildlife/willet-plumage.webp', import.meta.url);
const point = (x, y, z) => new THREE.Vector3(x, y, z);
const up = point(0, 1, 0);
const shoulder = point(0, 0.177, 0.038);
const poses = ['Probe', 'Flight', 'Upstroke', 'Downstroke', 'LeftStep', 'RightStep'];

function shape(pose) {
  const parts = [],
    color = new THREE.Color();
  const air = ['Flight', 'Upstroke', 'Downstroke'].includes(pose);
  const tipAngle = pose === 'Upstroke' ? 0.99 : pose === 'Downstroke' ? -0.79 : 0.08;
  const neckAngle = pose === 'Probe' ? 1.68 : air ? 0.6 : 0;
  const neckPoint = (p) =>
    p
      .sub(shoulder)
      .applyAxisAngle(point(1, 0, 0), neckAngle)
      .add(shoulder);
  function add(geo, shade, region = 'solid') {
    const vertex = geo.attributes.position,
      uv = geo.attributes.uv,
      colors = [];
    for (let i = 0; i < vertex.count; i++) {
      color.setHex(typeof shade === 'function' ? shade(vertex.getY(i), vertex.getZ(i)) : shade);
      colors.push(color.r, color.g, color.b);
      // The upper half of the atlas carries coarse back feathers. Bills and feet
      // sample a single pale texel so their colours retain a clean silhouette.
      if (region === 'solid') uv.setXY(i, 0.46, 0.21);
      else if (region === 'pale') uv.setXY(i, 0.06 + uv.getX(i) * 0.87, 0.03 + uv.getY(i) * 0.43);
      else uv.setXY(i, 0.05 + uv.getX(i) * 0.9, 0.54 + uv.getY(i) * 0.43);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    parts.push(geo);
  }
  function ellipsoid(center, rx, ry, rz, tint, region, tilt = 0, head = false) {
    const geo = new THREE.SphereGeometry(1, 16, 10)
      .scale(rx, ry, rz)
      .rotateX(tilt)
      .translate(...center.toArray());
    if (head)
      geo
        .translate(...shoulder.clone().negate().toArray())
        .rotateX(neckAngle)
        .translate(...shoulder.toArray());
    add(geo, tint, region);
  }
  function bone(a, b, base, tip, tint) {
    const axis = b.clone().sub(a),
      mid = a.clone().lerp(b, 0.5);
    const geo = new THREE.CylinderGeometry(tip, base, axis.length(), 7);
    geo.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, axis.normalize()));
    add(geo.translate(mid.x, mid.y, mid.z), tint);
  }
  // Tapered rear, pale belly and grey mantle, with a stocky shoulder.
  ellipsoid(point(0, 0.162, -0.006), 0.051, 0.061, 0.116, 0xebeadb, 'pale', -0.13);
  ellipsoid(point(0, 0.189, -0.019), 0.048, 0.041, 0.109, 0xdcdbcd, 'back', -0.15);
  // Loft the breast, throat and crown together, so a probing bird bends
  // from its shoulders without a visible joint behind the bill.
  const rings = [
    [0.148, 0.042, 0.043, 0.051],
    [0.171, 0.053, 0.043, 0.05],
    [0.196, 0.065, 0.038, 0.045],
    [0.216, 0.076, 0.032, 0.039],
    [0.231, 0.086, 0.033, 0.039],
    [0.247, 0.094, 0.036, 0.044],
    [0.258, 0.095, 0.035, 0.043],
    [0.27, 0.094, 0.03, 0.037],
    [0.279, 0.091, 0.02, 0.026],
    [0.285, 0.09, 0.001, 0.002],
  ];
  const neck = new THREE.BufferGeometry(),
    pos = [],
    uv = [],
    ix = [];
  for (let j = 0; j < rings.length; j++) {
    const [y, z, rx, rz] = rings[j];
    for (let i = 0; i <= 20; i++) {
      const a = (i * Math.PI) / 10;
      const v = point(rx * Math.cos(a), y, z + rz * Math.sin(a));
      const flex = THREE.MathUtils.smoothstep(y, 0.15, 0.225);
      v.sub(shoulder)
        .applyAxisAngle(point(1, 0, 0), neckAngle * flex)
        .add(shoulder);
      pos.push(v.x, v.y, v.z);
      uv.push(i / 20, 0.08 + (0.82 * j) / (rings.length - 1));
      if (j && i) {
        const k = j * 21 + i;
        ix.push(k - 22, k - 1, k - 21, k - 21, k - 1, k);
      }
    }
  }
  neck.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  neck.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  neck.setIndex(ix);
  neck.computeVertexNormals();
  add(neck, 0xc5c1b5, 'pale');
  const mid = neckPoint(point(0, 0.249, 0.155));
  bone(neckPoint(point(0, 0.251, 0.124)), mid, 0.01, 0.0065, 0x7e817c);
  bone(mid, neckPoint(point(0, 0.244, 0.193)), 0.0065, 0.0011, 0x383938);
  for (const side of [-1, 1]) {
    const eye = point(side * 0.032, 0.26, 0.11);
    ellipsoid(eye, 0.0044, 0.005, 0.0049, 0x222323, 'solid', 0, true);
    ellipsoid(point(side * 0.012, 0.182, -0.117), 0.02, 0.007, 0.059, 0x898379, 'back', -0.08);
    const step = (side < 0 && pose === 'LeftStep') || (side > 0 && pose === 'RightStep');
    const hip = point(side * 0.021, 0.136, 0.002),
      hock = point(side * 0.024, air ? 0.093 : 0.071, air ? -0.065 : -0.013);
    const foot = point(side * 0.026, air ? 0.113 : step ? 0.027 : 0.004, air ? -0.158 : step ? 0.036 : 0.007);
    bone(hip, hock, 0.0054, 0.0041, 0x737e78);
    bone(hock, foot, 0.0041, 0.003, 0x666f68);
    for (const dx of [-0.012, 0, 0.012]) {
      const toe = foot.clone().add(point(dx, air ? 0.003 : -0.002, air ? -0.023 : dx === 0 ? 0.027 : 0.022));
      bone(foot, toe, 0.0024, 0.0008, 0x646b62);
    }
    // Each strip spans from the leading edge to an individually scalloped trailing
    // primary. A banking bird exposes the white bar between two dark flight surfaces.
    const pos = [],
      uvs = [],
      idx = [],
      wingColors = [];
    const slices = 14,
      chords = [0, 0.3, 0.39, 0.62, 0.74, 1];
    for (let k = 0; k <= slices; k++) {
      const span = k / slices,
        taper = Math.sin(Math.PI * (0.12 + 0.88 * span)) ** 0.64;
      for (const chord of chords) {
        const out = span * 0.302,
          sweep = 0.03 * span + 0.067 * span * span;
        const feather = ((k % 2 === 0 ? 0.012 : 0) * Math.max(0, chord - 0.65)) / 0.35;
        const openY =
          0.191 + Math.sin(tipAngle) * out + 0.018 * Math.sin(Math.PI * span) + 0.011 * Math.sin(Math.PI * chord);
        const foldedX = 0.031 + 0.018 * Math.sin(Math.PI * span) + 0.005 * Math.sin(Math.PI * chord);
        const foldedZ = 0.067 - 0.21 * span - 0.06 * taper * chord;
        const x = air ? 0.025 + Math.cos(tipAngle) * out : foldedX;
        const y = air ? openY : 0.186 + 0.028 * Math.sin(Math.PI * span) - 0.031 * chord;
        const z = air ? 0.055 - sweep - (0.139 * taper + 0.003) * chord - feather : foldedZ;
        pos.push(side * x, y, z);
        uvs.push(0.08 + 0.85 * span, 0.54 + 0.4 * (1 - chord));
        let tint = 0xccc5b9;
        if (chord >= 0.39 && chord <= 0.62) tint = 0xfffaed;
        else if (span > 0.69 || chord > 0.62) tint = 0x514e4a;
        color.setHex(tint);
        wingColors.push(color.r, color.g, color.b);
      }
    }
    for (let k = 0; k < slices; k++)
      for (let c = 0; c < chords.length - 1; c++) {
        const a = k * chords.length + c,
          b = a + chords.length;
        if (side > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    wing.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    wing.setAttribute('color', new THREE.Float32BufferAttribute(wingColors, 3));
    wing.setIndex(idx);
    wing.computeVertexNormals();
    parts.push(wing);
  }
  const result = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  return result;
}

export function willetMesh(count) {
  const geo = shape('Rest');
  geo.morphAttributes.position = [];
  geo.morphAttributes.normal = [];
  for (const name of poses) {
    const g = shape(name);
    for (const key of ['position', 'normal']) {
      const attr = g.attributes[key];
      attr.name = name;
      geo.morphAttributes[key].push(attr);
    }
    g.dispose();
  }
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.91,
    side: THREE.DoubleSide,
  });
  if (globalThis.document?.createElementNS)
    new THREE.TextureLoader().load(plumage.href, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 4;
      mat.map = texture;
      mat.needsUpdate = true;
    });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = 'Willets on the flats';
  mesh.receiveShadow = mesh.castShadow = true;
  mesh.frustumCulled = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return mesh;
}
