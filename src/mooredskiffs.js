import * as THREE from 'three';
import { buildSkiff } from './npc.js';
import { createDockShift, stepDockShift } from './skiffdockshift.js';
import { updateDockActors } from './skiffdockactors.js';
import { buildDockGear, createCreelFish, setDockCatch } from './skiffdockgear.js';
import { buildFishingCrew, updateFishingCrew } from './skifffishingcrew.js';
import { createFishingTrip, stepFishingTrip } from './skifffishingtrip.js';
import { sampleHullSurface } from './hullsurface.js';
import { registerWetMaterial } from './surfacewetness.js';
import { vesselWindHeel } from './vesselwind.js';
import { addBeam, addBox, tintGeometry, waterfrontMesh, waterfrontSurface } from './waterfrontgeometry.js';
import { COVE_MOORINGS, MOORING_TRAVEL } from './waterfrontlayout.js';

const { clamp } = THREE.MathUtils;
const fishingLights = {
  port: { x: -.73, y: .493, z: -.42 }, starboard: { x: .73, y: .493, z: -.42 },
  stern: { x: -.57, y: .91, z: 1.74 },
};
const badWeather = new Set(['squall', 'thunderstorm', 'hail', 'tropical', 'hurricane']);
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
  for (const lens of [fishingLights.port, fishingLights.starboard]) {
    addBox(hardware, 0x3f4140, .09, .055, .12, lens.x, lens.y - .034, lens.z);
  }
  const sternLamp = fishingLights.stern;
  addBox(hardware, 0x777c76, .023, .48, .023, sternLamp.x, sternLamp.y - .26, sternLamp.z);
  addBox(hardware, 0xc7c6ad, .062, .06, .062, sternLamp.x, sternLamp.y - .015, sternLamp.z);
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
  // The primer bulb and sagging fuel hose stay down by the transom, out
  // of the helmsman's footwell. The aft thwart carries a faded foam pad.
  const hose = new THREE.CatmullRomCurve3([
    [.51,.47,1.2], [.61,.34,1.34], [.57,.18,1.62], [.37,.22,1.81], [.12,.53,1.94],
  ].map(v => new THREE.Vector3(...v)));
  tintGeometry(rubber, new THREE.TubeGeometry(hose,16,.012,6,false), 0x2b2d27);
  tintGeometry(rubber, new THREE.CapsuleGeometry(.028,.074,3,7).rotateZ(.86).translate(.29,.30,1.85), 0x292924);
  addBox(rubber, index ? 0x666754 : 0x6f6752, 1.26,.037,.32,0,.551,-.95);
  const inside = -berth.side;
  for (const z of [-0.18, 0.98]) {
    const cylinder = new THREE.CapsuleGeometry(0.085, 0.28, 4, 9)
      .rotateX(z > 0 ? 0.09 : -0.14).translate(inside * 0.85, 0.265, z);
    tintGeometry(rubber, cylinder, index === 0 ? 0x9d988c : 0x30353a, (x, y) => y > 0.18 ? 1 : 0.75);
    addBox(hardware, 0x656253, 0.027, 0.23, 0.015, inside * 0.83, 0.455, z);
  }
  mesh.add(waterfrontMesh(hardware, dockMetal), waterfrontMesh(rubber, fenderRubber));
}

function pierCoil(post, side) {
  // The loose end lives beside its own cleat while the boat is out.
  const points = [];
  for (let n = 0; n <= 40; n++) {
    const u = n / 40, angle = u * Math.PI * 4.8;
    points.push(new THREE.Vector3(post.x + Math.sin(angle) * (.16 - .06*u),
      post.y - .041 + u * .015, post.z - side*(.22 - (.19 - .07*u)*Math.cos(angle))));
  }
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 42, ropeRadius, 5, false), ropeMaterial);
  mesh.receiveShadow = true; mesh.visible = false;
  return mesh;
}

function syncHull(boat) {
  const { mesh, trip, surface, motion } = boat;
  mesh.position.set(trip.x + motion.x, surface.waterHeight - 0.042, trip.z + motion.z);
  mesh.rotation.set(boat.pitch, trip.heading + motion.yaw, boat.roll, 'YXZ');
  mesh.updateMatrix();
  const x = mesh.position.x, z = mesh.position.z, yaw = mesh.rotation.y;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), o = boat.obstacle;
  o.ax = x + fx * 1.44; o.az = z + fz * 1.44;
  o.bx = x - fx * 1.51; o.bz = z - fz * 1.51;
}

export function buildMooredSkiffs(group) {
  return COVE_MOORINGS.map((berth, index) => {
    const { side, pier } = berth, mesh = buildSkiff({ crew: false });
    mesh.name = index === 0 ? 'Painted fishing skiff' : 'Alloy fishing skiff';
    dressSkiff(mesh, berth, index);
    const motion = { x: 0, z: 0, yaw: 0, vx: 0, vz: 0, yawRate: 0, side };
    const trip = createFishingTrip(berth, index);
    const controls = { player: {}, otherBoats: [] };
    const boat = { berth, mesh, motion, trip, controls, surface: { waterHeight: 0 }, pitch: 0, roll: 0, impactRoll: 0, contactHold: 0, lastWake: 0 };
    trip.mesh = mesh; trip.navigationLights = true; trip.navigationLightLayout = fishingLights; trip.wakeMaxSpeed = 5.5; trip.wakeScale = 0.095;
    boat.crew = buildFishingCrew(boat, index);
    boat.dockShift = createDockShift(berth, index);
    boat.dockGear = buildDockGear(boat, index, group);
    boat.dockGear.sortFish = createCreelFish();
    boat.dockGear.sortFish.visible = false;
    group.add(boat.dockGear.sortFish);
    boat.obstacle = { ax: berth.x, az: berth.z, bx: berth.x, bz: berth.z, r: 0.86, tag: 'boat',
      onHit: (speed, nx, nz, player) => {
        const kick = Math.min(1.4, speed * 0.27);
        motion.vx -= nx * kick; motion.vz -= nz * kick;
        motion.yawRate -= nz * kick * clamp((player.pos.x - mesh.position.x) * 0.2, -0.47, 0.47);
        if (speed > 1) boat.contactHold = Math.min(2.6, speed * .33);
        boat.impactRoll = clamp(boat.impactRoll - nz * kick * 0.11, -0.17, 0.17);
      } };
    syncHull(boat);
    boat.lines = [-1.38, 1.34].map((z, i) => {
      const post = new THREE.Vector3(berth.x - z + (i ? -0.14 : 0.36), pier.deck + 0.059, pier.z + berth.side * 1.40);
      const eye = new THREE.Vector3(-side * 0.69, 0.546, z);
      const end = eye.clone().applyMatrix4(mesh.matrix), line = {
        mesh: lineMesh(), coil: pierCoil(post, side), post, eye, end, length: post.distanceTo(end) + (i ? 0.10 : 0.14), extension: 0,
      };
      dockCleat(group, post.x, post.y - 0.027, post.z);
      bendLine(line);
      group.add(line.mesh, line.coil);
      return line;
    });
    const anchorMesh = lineMesh();
    anchorMesh.name = 'Fishing skiff anchor rode'; anchorMesh.visible = false;
    boat.anchor = { mesh: anchorMesh, eye: new THREE.Vector3(side * .58, .46, -1.59),
      post: new THREE.Vector3(), end: new THREE.Vector3(), bottom: new THREE.Vector3(), paid: 0, length: 0 };
    const workRope = lineMesh();
    workRope.name = 'Unloading line'; workRope.visible = false;
    boat.workLine = { mesh: workRope, post: new THREE.Vector3(), end: new THREE.Vector3(),
      eye: new THREE.Vector3(), probe: new THREE.Vector3(), inUse: false, length: 0 };
    group.add(mesh, anchorMesh, workRope);
    return boat;
  });
}

function stepTiedHull(boat, dt, wind, windDir, wake, ctx) {
  const { motion, mesh } = boat;
  const { x, z } = mesh.position;
  let pullX = 0, pullZ = 0, torque = 0;
  for (const line of boat.lines) {
    const span = line.post.distanceTo(line.end), extension = Math.max(0, span - line.length);
    const tension = Math.min(5, 5.2 * extension) / Math.max(span, 0.05);
    const dx = (line.post.x - line.end.x) * tension, dz = (line.post.z - line.end.z) * tension;
    pullX += dx; pullZ += dz;
    torque += (line.end.z - z) * dx - (line.end.x - x) * dz;
  }
  if (boat.workLine.inUse) {
    const {post, end, length} = boat.workLine, span = post.distanceTo(end);
    const tension = clamp((span - length) * 2.7, 0, 1.8) / Math.max(.1, span);
    pullX += (end.x - post.x) * tension;
    pullZ += (end.z - post.z) * tension;
  }
  const kick = clamp((wake - boat.lastWake) / Math.max(0.01, dt), -2, 2);
  const wakeReach = clamp((z - ctx.bz) * 0.08, -1, 1);
  const windForce = Math.min(3, wind * wind * 0.0038);
  stepMooringMotion(motion, dt, (windDir?.x ?? 0) * windForce + pullX,
    (windDir?.z ?? 0) * windForce + pullZ + kick * 0.64 * wakeReach,
    0.68 * torque + kick * 0.13 + (windDir?.z ?? 0) * windForce * 0.17);
}

function updateTrip(boat, boats, dt, wind, wake, ctx, environment) {
  const { trip, controls } = boat;
  const player = controls.player;
  player.x = ctx.bx; player.z = ctx.bz; player.vx = ctx.vx ?? 0; player.vz = ctx.vz ?? 0;
  player.speed = ctx.speed ?? 0; player.heading = ctx.heading ?? 0;
  controls.heightAt = ctx.heightAt;
  boat.contactHold = Math.max(0, boat.contactHold - dt);
  controls.contactHold = boat.contactHold;
  controls.wind = wind; controls.wake = wake;
  controls.daylight = environment?.daylight ?? 1;
  controls.waterLevel = environment?.waterLevel ?? 0;
  controls.storm = environment?.sampleStormAt?.(trip.x, trip.z) ?? environment?.values?.storm ?? 0;
  controls.stormApproaching = (badWeather.has(environment?.nextKey) && environment.remaining < 45)
    || (badWeather.has(environment?.key) && (environment.mix < 1 || environment.key === 'hurricane'));
  const nearby = controls.otherBoats;
  nearby.length = 0;
  for (const neighbor of boats) if (neighbor !== boat) nearby.push(neighbor.trip);
  if (environment?.traffic?.boats) for (const b of environment.traffic.boats) if (b.active) nearby.push(b);
  const unloadingHelp = ctx.catchHelp?.at.index === trip.index;
  if (unloadingHelp && trip.secured) trip.timer = Math.max(trip.timer, 8);
  controls.crewReady = boat.dockShift.ready && !unloadingHelp;
  stepFishingTrip(trip, dt, controls);
  // A second boat tending the landing lets the crew work through its catch faster.
  // Keep boarding and weather routines on their usual clock.
  const assisting = unloadingHelp && boat.dockShift.sorting;
  stepDockShift(boat.dockShift, trip, assisting ? dt * 1.35 : dt, controls.daylight);
  trip.active = !trip.secured;
}

// Lower the anchor off the bow at the fishing hole. Its bottom stays put
// while the hull sheers in the wind and the fishing float rides separately.
function updateFishingAnchor(boat, dt, ctx) {
  const { anchor, mesh, trip } = boat;
  const payingOut = trip.phase === 'fishing';
  if (!payingOut && anchor.paid <= 0) return;
  anchor.post.copy(anchor.eye).applyMatrix4(mesh.matrix);
  if (payingOut && anchor.paid === 0) {
    const x = anchor.post.x - Math.sin(mesh.rotation.y) * 2.5;
    const z = anchor.post.z - Math.cos(mesh.rotation.y) * 2.5;
    anchor.bottom.set(x, ctx.heightAt?.(x, z) ?? mesh.position.y - 2, z);
  }
  anchor.paid = clamp(anchor.paid + (payingOut ? .45 : -.85) * dt, 0, 1);
  anchor.mesh.visible = anchor.paid > .005;
  if (!anchor.mesh.visible) return;
  anchor.end.lerpVectors(anchor.post, anchor.bottom, anchor.paid);
  anchor.length = anchor.post.distanceTo(anchor.end) + .09 * anchor.paid;
  bendLine(anchor);
}

// An extra line from the skiff's outer bow cleat to the nearest cleat on
// the helper's boat steadies the skiff while the crew works the landing.
function updateUnloadingLine(boat, ctx) {
  const line = boat.workLine, player = ctx.playerHull;
  const helping = ctx.catchHelp?.at.index === boat.trip.index && boat.trip.secured && !!player;
  line.mesh.visible = helping;
  if (!helping) { line.inUse = false; return; }
  boat.mesh.localToWorld(line.post.set(boat.berth.side*.69,.546,-1.38));
  if (!line.inUse) {
    let nearest = Infinity;
    for (const x of [-1.05, 1.05]) for (const z of [-2, 2.2]) {
      player.localToWorld(line.probe.set(x,.685,z));
      const gap = line.post.distanceToSquared(line.probe);
      if (gap < nearest) { nearest = gap; line.eye.set(x,.685,z); }
    }
    line.length = Math.sqrt(nearest) + .075;
    line.inUse = true;
  }
  player.localToWorld(line.end.copy(line.eye));
  bendLine(line);
}

function updateOutboard(boat, dt, ctx) {
  const { trip, mesh } = boat, motor = mesh.userData.motor;
  const moving = !trip.secured && trip.phase !== 'fishing';
  const speed = Math.abs(trip.speed);
  const running = moving ? clamp(speed / trip.wakeMaxSpeed, 0, 1) : 0;
  motor.rotation.x = THREE.MathUtils.damp(motor.rotation.x, moving ? 0.05 : 0.44, 2.7, dt);
  motor.userData.prop.rotation.z += dt * (moving ? 8 + running * 55 : 0);
  if (!moving || dt <= 0) return;
  const distance = Math.hypot(trip.x - ctx.bx, trip.z - ctx.bz);
  const level = clamp(1 - distance / 130, 0, 1) ** 1.6 * (.11 + running * .58);
  if (level > ctx.ob) { ctx.ob = level; ctx.obPitch = .79 + running*.35; ctx.obX = trip.x; ctx.obZ = trip.z; }
  if (distance > 105 || speed < .26) return;
  const sh = Math.sin(trip.heading), ch = Math.cos(trip.heading);
  ctx.emitStamp?.(trip.x + sh * 2.05, trip.z + ch * 2.05, .64 + .32 * running,
    .09 + .25 * running, .13 + .92 * running, .59 + .46 * running);
}

export function updateMooredSkiffs(boats, time, waveAt, ctx, environment) {
  for (const boat of boats) {
    const dt = Math.min(ctx.residentDt || 0, 0.05);
    const { trip, motion, mesh } = boat;
    const wind = (environment?.sampleWindAt?.(trip.x, trip.z) ?? 0) * (environment?.gust ?? 1);
    const windDir = environment?.windDir;
    const playerWake = ctx.playerWakeAt?.(trip.x, trip.z, time) ?? 0;
    const trafficWake = environment?.traffic?.wakeHeightAt?.(trip.x, trip.z, time) ?? 0;
    const wake = clamp(playerWake + trafficWake, -0.37, 0.37);
    if (dt > 0) updateTrip(boat, boats, dt, wind, playerWake, ctx, environment);
    const response = -Math.expm1(-dt * 4.4);
    if (trip.secured) stepTiedHull(boat, dt, wind, windDir, wake, ctx);
    else {
      const settle = Math.exp(-dt * 3);
      const anchored = trip.phase === 'fishing';
      const drift = anchored ? clamp(wind * .012, 0, .18) : 0;
      motion.x += ((windDir?.x ?? 0) * drift - motion.x) * (1 - settle);
      motion.z += ((windDir?.z ?? 0) * drift - motion.z) * (1 - settle);
      const sheer = anchored ? ((windDir?.x ?? 0) * Math.cos(trip.heading) - (windDir?.z ?? 0) * Math.sin(trip.heading)) * drift + wake * .25 : 0;
      motion.yaw += (sheer - motion.yaw) * (1 - settle);
      motion.vx *= settle; motion.vz *= settle; motion.yawRate *= settle;
    }
    const field = ctx.boatWaveAt || ((wx, wz, t) => waveAt(wx, wz, t) + clamp(
      (ctx.playerWakeAt?.(wx, wz, t) ?? 0) + (environment?.traffic?.wakeHeightAt?.(wx, wz, t) ?? 0), -.37, .37));
    sampleHullSurface(boat.surface, field, trip.x + motion.x, trip.z + motion.z, trip.heading + motion.yaw, time, trip);
    const heel = vesselWindHeel(windDir, wind, trip.heading, 0.55);
    const turn = trip.turn;
    mesh.userData.motor.rotation.y = THREE.MathUtils.damp(mesh.userData.motor.rotation.y, clamp(-turn * .5, -.56, .56), 4, dt);
    boat.impactRoll *= Math.exp(-dt * 2.2);
    boat.pitch += (boat.surface.waterPitch * .86 + .005 * Math.abs(trip.speed) - boat.pitch) * response;
    boat.roll += (boat.surface.waterRoll * .85 + heel + boat.impactRoll + clamp(turn * trip.speed * .025, -.12, .12) - boat.roll) * response;
    if (dt > 0) boat.lastWake = wake;
    syncHull(boat);
    updateUnloadingLine(boat, ctx);
    updateFishingAnchor(boat, dt, ctx);
    updateOutboard(boat, dt, ctx);
    if (!updateDockActors(boat, boat.dockShift, dt, time, ctx)) {
      updateFishingCrew(boat.crew, boat, trip, dt, time, ctx, field);
    }
    const creel = boat.dockShift.gear.cooler;
    setDockCatch(boat.dockGear, creel.count, creel.open ?? 0, boat.dockShift.landedCount);
    for (const line of boat.lines) {
      line.mesh.visible = trip.secured; line.coil.visible = !trip.secured;
      line.end.copy(line.eye).applyMatrix4(mesh.matrix);
      if (trip.secured) bendLine(line);
    }
  }
}
