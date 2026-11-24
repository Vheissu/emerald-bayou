import * as THREE from 'three';
import { buildSkiff } from './npc.js';
import { sampleHullSurface } from './hullsurface.js';
import { registerWetMaterial } from './surfacewetness.js';
import { vesselWindHeel } from './vesselwind.js';
import { addBeam, addBox, tintGeometry, waterfrontMesh, waterfrontSurface } from './waterfrontgeometry.js';
import { COVE_MOORINGS, MOORING_TRAVEL } from './waterfrontlayout.js';

const { clamp } = THREE.MathUtils;
const heading = -Math.PI / 2;
const ropeSegments = 12, radialSegments = 5, ropeRadius = 0.013;
const ropeRing = Array.from({ length: radialSegments }, (_, i) => {
  const angle = i * Math.PI * 2 / radialSegments;
  return [Math.cos(angle), Math.sin(angle)];
});
const dockMetal = waterfrontSurface(0xffffff, { metalness: 0.52, roughness: 0.72 });
const fenderRubber = waterfrontSurface(0xffffff, { roughness: 0.93 });
const ropeMaterial = registerWetMaterial(new THREE.MeshStandardMaterial({ color: 0xcbbb9a, roughness: 0.98 }));
let hullGeometry;
let floorGeometry;

export function mooringSag(span, paidOut) {
  // Arc length of a gently sagging parabola, solved for its centre drop.
  return Math.min(0.22, Math.sqrt(Math.max(0, 0.375 * span * (paidOut - span))));
}

export function stepMooringMotion(boat, dt, driveX, driveZ, torque) {
  const travel = MOORING_TRAVEL;
  // Spring/damper for the short spring lines and rubber fenders.
  const drag = Math.exp(-2.7 * dt);
  boat.vx = (boat.vx + (driveX - boat.x * 3.7) * dt) * drag;
  boat.vz = (boat.vz + (driveZ - boat.z * 4.4) * dt) * drag;
  boat.yawRate = (boat.yawRate + (torque - boat.yaw * 6.4) * dt) * drag;
  const x = boat.x + boat.vx * dt, z = boat.z + boat.vz * dt, yaw = boat.yaw + boat.yawRate * dt;
  boat.x = clamp(x, -travel.end, travel.end);
  boat.z = boat.side * clamp(z * boat.side, -travel.inward, travel.outward);
  boat.yaw = clamp(yaw, -travel.yaw, travel.yaw);
  if (boat.x !== x) boat.vx = 0;
  if (boat.z !== z) boat.vz = 0;
  if (boat.yaw !== yaw) boat.yawRate = 0;
}

function lineMesh() {
  const geometry = new THREE.BufferGeometry(), indices = [];
  const position = new THREE.BufferAttribute(new Float32Array((ropeSegments + 1) * radialSegments * 3), 3);
  const normal = position.clone();
  for (let row = 0; row < ropeSegments; row++) for (let j = 0; j < radialSegments; j++) {
    const a = row * radialSegments + j, b = row * radialSegments + (j + 1) % radialSegments;
    indices.push(a, a + radialSegments, b, b, a + radialSegments, b + radialSegments);
  }
  geometry.setAttribute('position', position.setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal', normal.setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, ropeMaterial);
  mesh.name = 'Mooring line';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}

function bendLine(line) {
  const { position, normal } = line.mesh.geometry.attributes;
  const a = line.post, b = line.end;
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const span = a.distanceTo(b), horizontal = Math.max(0.002, Math.hypot(dx, dz));
  const sideX = -dz / horizontal, sideZ = dx / horizontal;
  const sag = mooringSag(span, line.length);
  line.extension = span - line.length;
  for (let i = 0; i <= ropeSegments; i++) {
    const u = i / ropeSegments, drop = 4 * sag * u * (1 - u), tangentY = dy - 4 * sag * (1 - 2 * u);
    const slopeNorm = Math.hypot(horizontal, tangentY);
    const upX = -dx * tangentY / horizontal / slopeNorm, upY = horizontal / slopeNorm;
    const upZ = -dz * tangentY / horizontal / slopeNorm;
    for (let j = 0; j < radialSegments; j++) {
      const [cos, sin] = ropeRing[j];
      const nx = sideX * cos + upX * sin, ny = upY * sin, nz = sideZ * cos + upZ * sin;
      const index = i * radialSegments + j;
      position.setXYZ(index, a.x + dx * u + nx * ropeRadius, a.y + dy * u - drop + ny * ropeRadius, a.z + dz * u + nz * ropeRadius);
      normal.setXYZ(index, nx, ny, nz);
    }
  }
  position.needsUpdate = normal.needsUpdate = true;
}

function dockCleat(group, x, y, z) {
  const parts = [];
  addBox(parts, 0x85847c, 0.25, 0.029, 0.094, x, y - 0.047, z);
  for (const offset of [-0.068, 0.068]) {
    addBox(parts, 0x676861, 0.046, 0.051, 0.052, x + offset, y - 0.024, z);
    tintGeometry(parts, new THREE.CylinderGeometry(0.012, 0.012, 0.009, 6)
      .translate(x + offset * 1.47, y - 0.03, z), 0xc1bfb1);
  }
  addBox(parts, 0x989b91, 0.24, 0.033, 0.047, x, y + 0.011, z);
  group.add(waterfrontMesh(parts, dockMetal));
  const tie = new THREE.Mesh(new THREE.TorusGeometry(0.044, 0.012, 5, 9), ropeMaterial);
  tie.position.set(x, y + 0.027, z); tie.rotation.x = Math.PI / 2;
  group.add(tie);
}

function dressSkiff(mesh, berth, index) {
  const [hull, floor, portRail, starboardRail] = mesh.children;
  const material = hull.material.clone();
  material.color.setHex(berth.tint);
  material.metalness = index === 0 ? 0.27 : 0.58;
  material.roughness = 0.68;
  material.vertexColors = true;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 hullPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nhullPosition = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 hullPosition;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float wash = 0.5 + 0.5 * sin(hullPosition.z * 44.0 + sin(hullPosition.z * 17.1) * 2.0);
        float tideMark = 1.0 - smoothstep(0.0, 0.17, abs(hullPosition.y + 0.04 + wash * 0.031));
        float grain = sin(hullPosition.y * 570.0 + hullPosition.z * 3.0 + 2.2 * sin(hullPosition.z * 30.0));
        float scuffs = smoothstep(-0.32, 0.78, sin(hullPosition.z * 23.0 + hullPosition.y * 81.0) * sin(hullPosition.y * 541.0));
        diffuseColor.rgb *= 0.97 + 0.035 * grain - tideMark * (0.04 + wash * 0.13);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.67, 0.66, 0.59), scuffs * tideMark * 0.11);
      `);
  };
  material.customProgramCacheKey = () => 'moored-skiff-aluminium';
  hullGeometry ??= (() => {
    const geometry = hull.geometry.clone(), vertices = geometry.attributes.position;
    const tone = new Float32Array(vertices.count * 3);
    for (let i = 0; i < vertices.count; i++) {
      const stain = 0.58 + 0.42 * THREE.MathUtils.smoothstep(vertices.getY(i), -0.23, 0.41);
      tone.set([stain * 0.98, stain, stain * 0.97], i * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(tone, 3));
    return geometry;
  })();
  hull.geometry = hullGeometry;
  hull.material = registerWetMaterial(material, { darken: 0.14 });
  // The floor narrows at the entry rather than cutting through the flared bow.
  floorGeometry ??= new THREE.ShapeGeometry(new THREE.Shape([
    [-0.37, 1.58], [-0.51, 0.65], [-0.57, -1.69], [0.57, -1.69], [0.51, 0.65], [0.37, 1.58],
  ].map(([x, z]) => new THREE.Vector2(x, z)))).rotateX(-Math.PI / 2);
  floor.geometry = floorGeometry; floor.position.z = 0;
  portRail.removeFromParent(); starboardRail.removeFromParent();
  // Tilt the stored outboard up so the skeg stays clear of the bank and fouling.
  mesh.userData.motor.rotation.x = 0.44;
  const hardware = [], rubber = [];
  for (const side of [-1, 1]) {
    const gunwale = [[-2.35, 0.17, 0.053], [-1.72, 0.38, 0.55], [-0.55, 0.45, 0.783], [0.75, 0.45, 0.862], [1.92, 0.41, 0.868]]
      .map(([z, y, x]) => new THREE.Vector3(side * x, y, z));
    for (let i = 1; i < gunwale.length; i++) {
      addBeam(hardware, 0xa3a59a, gunwale[i - 1], gunwale[i], 0.038, 0.046);
      const a = gunwale[i - 1].clone(), b = gunwale[i].clone();
      a.y -= 0.055; b.y -= 0.055; a.x -= side * 0.008; b.x -= side * 0.008;
      addBeam(hardware, index ? 0x758678 : 0xa09a74, a, b, 0.024, 0.018);
    }
  }
  const inside = -berth.side;
  for (const z of [-0.18, 0.98]) {
    const cylinder = new THREE.CapsuleGeometry(0.085, 0.28, 4, 9)
      .rotateX(z > 0 ? 0.09 : -0.14).translate(inside * 0.85, 0.265, z);
    tintGeometry(rubber, cylinder, index === 0 ? 0x9d988c : 0x30353a, (x, y) => y > 0.18 ? 1 : 0.75);
    addBox(hardware, 0x656253, 0.027, 0.23, 0.015, inside * 0.83, 0.455, z);
  }
  // The painted boat keeps a canvas engine cover and the other carries a small bait box.
  const box = index === 0 ? [0x7f6c52, 0.83, 0.2, 0.49, 0, 0.55, 0.43] : [0x9aaf9e, 0.56, 0.31, 0.38, 0.14, 0.27, -0.31];
  addBox(hardware, ...box);
  for (const x of [-0.15, 0.18]) addBox(hardware, 0xc5bc9f, 0.029, 0.024, box[3] + 0.005, box[4] + x, box[5] + box[2] * 0.5, box[6]);
  mesh.add(waterfrontMesh(hardware, dockMetal), waterfrontMesh(rubber, fenderRubber));
}

function syncHull(boat) {
  const { mesh, berth, surface, motion } = boat;
  mesh.position.set(berth.x + motion.x, surface.waterHeight - 0.042, berth.z + motion.z);
  mesh.rotation.set(boat.pitch, heading + motion.yaw, boat.roll, 'YXZ');
  mesh.updateMatrix();
  const x = mesh.position.x, z = mesh.position.z, yaw = mesh.rotation.y;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), o = boat.obstacle;
  o.ax = x + fx * 1.44; o.az = z + fz * 1.44;
  o.bx = x - fx * 1.51; o.bz = z - fz * 1.51;
}

export function buildMooredSkiffs(group) {
  return COVE_MOORINGS.map((berth, index) => {
    const { side, pier } = berth, mesh = buildSkiff({ crew: false });
    mesh.name = index === 0 ? 'Painted moored skiff' : 'Alloy moored skiff';
    dressSkiff(mesh, berth, index);
    const motion = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, side };
    const boat = { berth, mesh, motion, surface: { waterHeight: 0 }, pitch: 0, roll: 0, impactRoll: 0, lastWake: 0 };
    boat.obstacle = { ax: berth.x, az: berth.z, bx: berth.x, bz: berth.z, r: 0.86, tag: 'boat',
      onHit: (speed, nx, nz, player) => {
        const kick = Math.min(1.4, speed * 0.27);
        motion.vx -= nx * kick; motion.vz -= nz * kick;
        motion.yawRate -= nz * kick * clamp((player.pos.x - (berth.x + motion.x)) * 0.2, -0.47, 0.47);
        boat.impactRoll = clamp(boat.impactRoll - nz * kick * 0.11, -0.17, 0.17);
      } };
    syncHull(boat);
    boat.lines = [-1.38, 1.34].map((z, i) => {
      const post = new THREE.Vector3(berth.x - z + (i ? -0.14 : 0.36), pier.deck + 0.059, pier.z + berth.side * 1.40);
      const eye = new THREE.Vector3(-side * 0.69, 0.546, z);
      const end = eye.clone().applyMatrix4(mesh.matrix), line = {
        mesh: lineMesh(), post, eye, end, length: post.distanceTo(end) + (i ? 0.10 : 0.14), extension: 0,
      };
      dockCleat(group, post.x, post.y - 0.027, post.z);
      bendLine(line);
      group.add(line.mesh);
      return line;
    });
    group.add(mesh);
    return boat;
  });
}

export function updateMooredSkiffs(boats, time, waveAt, ctx, environment) {
  for (const boat of boats) {
    const dt = Math.min(ctx.residentDt || 0, 0.05);
    const { berth, motion, mesh } = boat;
    const x = berth.x + motion.x, z = berth.z + motion.z;
    const wind = (environment?.sampleWindAt?.(x, z) ?? 0) * (environment?.gust ?? 1);
    const windDir = environment?.windDir;
    const playerWake = ctx.playerWakeAt?.(x, z, time) ?? 0;
    const trafficWake = environment?.traffic?.wakeHeightAt?.(x, z, time) ?? 0;
    const wake = clamp(playerWake + trafficWake, -0.37, 0.37);
    const response = -Math.expm1(-dt * 4.4);
    sampleHullSurface(boat.surface, (wx, wz, t) => waveAt(wx, wz, t) + clamp(
      (ctx.playerWakeAt?.(wx, wz, t) ?? 0) + (environment?.traffic?.wakeHeightAt?.(wx, wz, t) ?? 0), -0.37, 0.37),
    x, z, mesh.rotation.y, time);
    const heel = vesselWindHeel(windDir, wind, mesh.rotation.y, 0.55);
    boat.impactRoll *= Math.exp(-dt * 2.2);
    boat.pitch += (boat.surface.waterPitch * 0.86 - boat.pitch) * response;
    boat.roll += (boat.surface.waterRoll * 0.85 + heel + boat.impactRoll - boat.roll) * response;
    let pullX = 0, pullZ = 0, torque = 0;
    for (const line of boat.lines) {
      const span = line.post.distanceTo(line.end), extension = Math.max(0, span - line.length);
      const tension = Math.min(5, 5.2 * extension) / Math.max(span, 0.05);
      const dx = (line.post.x - line.end.x) * tension, dz = (line.post.z - line.end.z) * tension;
      pullX += dx; pullZ += dz;
      torque += (line.end.z - z) * dx - (line.end.x - x) * dz;
    }
    const kick = clamp((wake - boat.lastWake) / Math.max(0.01, dt), -2, 2);
    const wakeReach = clamp((z - ctx.bz) * 0.08, -1, 1);
    const windForce = Math.min(3, wind * wind * 0.0038);
    stepMooringMotion(motion, dt, (windDir?.x ?? 0) * windForce + pullX,
      (windDir?.z ?? 0) * windForce + pullZ + kick * 0.64 * wakeReach,
      0.68 * torque + kick * 0.13 + (windDir?.z ?? 0) * windForce * 0.17);
    if (dt > 0) boat.lastWake = wake;
    syncHull(boat);
    for (const line of boat.lines) {
      line.end.copy(line.eye).applyMatrix4(mesh.matrix);
      bendLine(line);
    }
  }
}
