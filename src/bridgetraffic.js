import * as THREE from 'three';
import { GULF_CUT, bridgeDeckAt, bridgeZAt } from './waterfrontlayout.js';
import { addBeam, addBox, tintGeometry, waterfrontMesh, waterfrontSurface } from './waterfrontgeometry.js';

const paint = waterfrontSurface(0xffffff, { metalness: 0.36, roughness: 0.36 });
const trim = waterfrontSurface(0xffffff, { metalness: 0.16, roughness: 0.57 });
const lenses = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.29, emissive: 0xffffff, emissiveIntensity: 0,
});
lenses.onBeforeCompile = shader => {
  // Each lens keeps its own color in the water reflection and through the fog.
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;');
};

const FLEET = [
  { kind: 'van', color: 0xd1c8a5, direction: 1, phase: 63, length: 5.28, width: 2.0, tire: 0.345, axles: [-1.67, 1.53] },
  { kind: 'sedan', color: 0x455c56, direction: 1, phase: 171, length: 4.60, width: 1.83, tire: 0.314, axles: [-1.46, 1.43] },
  { kind: 'pickup', color: 0x92513a, direction: -1, phase: 29, length: 5.37, width: 2.04, tire: 0.385, axles: [-1.66, 1.55] },
  { kind: 'sedan', color: 0x658193, direction: -1, phase: 95, length: 4.70, width: 1.86, tire: 0.322, axles: [-1.51, 1.44] },
];

function putQuad(batch, color, a, b, c, d) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...d], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]); geometry.computeVertexNormals();
  tintGeometry(batch, geometry, color);
}

function addBody(batch, { color, kind, length, width, tire }) {
  const nose = length / 2, tail = -nose, half = width / 2;
  const top = kind === 'sedan' ? 0.91 : kind === 'pickup' ? 1.12 : 0.99;
  const sill = tire * 1.63;
  const sections = [
    [tail, half * 0.86, sill + 0.035, top - 0.124],
    [tail + 0.19, half * 0.96, sill - 0.017, top - 0.012],
    [tail + 0.48, half, sill, top],
    [nose - 0.54, half, sill, top],
    [nose - 0.19, half * 0.96, sill - 0.02, top - 0.085],
    [nose, half * 0.86, sill + 0.005, top - 0.12],
  ];
  const positions = [], indices = [];
  for (const [x, w, low, high] of sections) {
    const ring = [[low + 0.06, w], [high - 0.12, w], [high, w * 0.81], [high, -w * 0.81],
      [high - 0.12, -w], [low + 0.06, -w], [low, -w * 0.84], [low, w * 0.84]];
    for (const [y,z] of ring) positions.push(x, y, z);
  }
  for (let s = 0; s < sections.length - 1; s++) {
    for (let i = 0; i < 8; i++) {
      const a = s * 8 + i, b = s * 8 + (i + 1) % 8;
      indices.push(a, a + 8, b, b, a + 8, b + 8);
    }
  }
  for (let i = 1; i < 7; i++) {
    const last = (sections.length - 1) * 8;
    indices.push(0, i, i + 1, last, last + i + 1, last + i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(positions.length * 2 / 3), 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  tintGeometry(batch, geometry, color, (_, y) => 0.74 + 0.24 * Math.min(1, y / top));
  return top;
}

function greenhouse(panels, windows, kind, color, half, belt) {
  const dimensions = {
    van: [-0.85, -0.8, 0.97, 1.77, 2.15],
    pickup: [-0.99, -0.86, 0.57, 1.4, 1.85],
    sedan: [-1.41, -0.75, 0.49, 1.20, 1.43],
  };
  const [rear, rearRoof, frontRoof, front, roof] = dimensions[kind];
  const bottom = half * 0.90, top = half * 0.74;
  // Interpolate across the sloping cabin faces. The windows sit inside actual
  // painted roof and pillar frames instead of wrapping the whole greenhouse.
  const along = (rearEdge, frontEdge, side, u, v, lift = 0) => {
    return [THREE.MathUtils.lerp(THREE.MathUtils.lerp(rearEdge, rearRoof, v), THREE.MathUtils.lerp(frontEdge, frontRoof, v), u),
      THREE.MathUtils.lerp(belt, roof, v), side * (THREE.MathUtils.lerp(bottom, top, v) + lift)];
  };
  const [tl, tr, bl, br] = [[rearRoof, roof, -top], [frontRoof, roof, -top], [rearRoof, roof, top], [frontRoof, roof, top]];
  putQuad(panels, color, tl, bl, br, tr);
  for (const side of [1, -1]) {
    const sideFace = (batch, paintColor, u0, u1, v0, v1, lift = 0) => {
      const points = [along(rear, front, side, u0, v0, lift), along(rear, front, side, u0, v1, lift),
        along(rear, front, side, u1, v1, lift), along(rear, front, side, u1, v0, lift)];
      putQuad(batch, paintColor, ...(side > 0 ? points.reverse() : points));
    };
    sideFace(panels, color, 0, 1, 0, 1);
    const dividers = kind === 'van' ? [[0.56, 0.94]] : [[0.09, 0.48], [0.53, 0.94]];
    for (const [from,to] of dividers) sideFace(windows, 0x233237, from, to, 0.07, 0.87, 0.007);
    if (kind !== 'van') {
      for (const x of [-0.55, 0.57]) addBox(windows, 0x464c4a, 0.14, 0.035, 0.025, x, belt - 0.075, side * (half + 0.004));
    }
    const mirrorX = front - 0.47, mirrorY = belt + 0.18;
    const vector = (x,y,z) => new THREE.Vector3(x,y,z);
    addBeam(windows, 0x343a38, vector(mirrorX, mirrorY - 0.05, side * (half - 0.13)),
      vector(mirrorX, mirrorY, side * (half + 0.07)), 0.054, 0.05);
    addBox(panels, color, 0.13, 0.114, 0.19, mirrorX, mirrorY + 0.035, side * (half + 0.10));
  }
  for (const isFront of [true, false]) {
    const foot = isFront ? front : rear, upper = isFront ? frontRoof : rearRoof;
    const face = (batch, tint, margin, lift) => {
      const corners = [];
      for (const [v, sign] of [[margin, -1], [1 - margin, -1], [1 - margin, 1], [margin, 1]]) {
        corners.push([THREE.MathUtils.lerp(foot, upper, v) + (isFront ? lift : -lift), THREE.MathUtils.lerp(belt, roof, v),
          sign * THREE.MathUtils.lerp(bottom, top, v) * (1 - margin * 2)]);
      }
      putQuad(batch, tint, ...(isFront ? corners : corners.reverse()));
    };
    face(panels, color, 0, 0);
    face(windows, isFront ? 0x384951 : 0x293438, kind === 'van' && !isFront ? 0.22 : 0.12, 0.006);
  }
}

function buildRoadVehicle(spec) {
  const body = [], details = [], lamps = [];
  const { kind, color, length, width, tire, axles } = spec;
  const model = new THREE.Group();
  model.name = 'Gulf Cut ' + spec.kind;
  const belt = addBody(body, spec), half = width / 2;
  greenhouse(body, details, kind, color, half, belt);
  if (kind === 'van') {
    // Softly rounded corners on the cargo body sit well inside the wheel track.
    const cargo = new THREE.BoxGeometry(2.32, 1.10, width * 0.87).translate(-1.16, belt + 0.54, 0);
    tintGeometry(body, cargo, color, (_, y) => 0.85 + 0.12 * (y - belt));
    for (const side of [-1, 1]) {
      addBox(details, 0x555b53, 0.017, 0.82, 0.012, -1.63, belt + 0.49, side * (half * 0.87 + 0.005));
      addBox(details, 0x434944, 1.95, 0.058, 0.027, -1.13, belt + 0.18, side * half * 0.88);
      addBox(lamps, 0xffad4f, 0.1, 0.061, 0.035, -2.02, belt + 0.16, side * half * 0.87);
    }
  } else if (kind === 'pickup') {
    const bedLength = 1.49;
    for (const side of [-1, 1]) {
      addBox(body, color, bedLength, 0.30, 0.14, -1.81, belt + 0.12, side * half * 0.88);
      addBox(details, 0x454647, bedLength + 0.02, 0.04, 0.16, -1.81, belt + 0.25, side * half * 0.88);
    }
    // Below the two rails the bed has a shadowed liner, opening up its silhouette.
    addBox(details, 0x373b39, 1.52, 0.038, width * 0.78, -1.77, belt + 0.018, 0);
    addBox(body, color, 0.12, 0.29, width * 0.83, -2.53, belt + 0.14, 0);
  }
  for (const x of axles) for (const side of [-1, 1]) {
    const z = side * (half - 0.086), wheelWidth = 0.254;
    const cylinder = (radius, breadth, center, tint, segments) => {
      const geometry = new THREE.CylinderGeometry(radius, radius, breadth, segments).rotateX(Math.PI / 2).translate(x, tire + 0.008, center);
      tintGeometry(details, geometry, tint);
    };
    cylinder(tire, wheelWidth, z, 0x1e2222, 12);
    cylinder(tire * 0.63, 0.015, z + side * (wheelWidth / 2 + 0.005), 0x9ca19c, 12);
    cylinder(tire * 0.24, 0.019, z + side * (wheelWidth / 2 + 0.015), 0x434d4c, 8);
  }
  const nose = length / 2, frontY = belt - 0.18, rearY = (kind === 'pickup' ? belt + 0.105 : belt - 0.15);
  addBox(details, kind === 'pickup' ? 0x828987 : 0x454a49, 0.13, 0.14, width * 0.86, nose - 0.02, frontY - 0.16, 0);
  addBox(details, 0x454947, 0.07, 0.17, width * 0.51, nose + 0.021, frontY + 0.025, 0);
  for (const lower of [0, -0.055]) addBox(details, 0x808783, 0.014, 0.019, width * 0.49, nose + 0.063, frontY + lower, 0);
  addBox(details, 0x3a4242, 0.12, 0.135, width * 0.87, -nose + 0.022, belt - 0.29, 0);
  addBox(details, 0x9b9d84, 0.015, 0.103, 0.25, -nose - 0.042, belt - 0.16, 0);
  for (const side of [-1, 1]) {
    addBox(lamps, 0xffeac7, 0.076, 0.134, 0.25, nose - 0.012, frontY + 0.03, side * half * 0.68);
    addBox(lamps, 0xe76e34, 0.15, 0.07, 0.03, nose - 0.18, frontY + 0.019, side * half * 0.951);
    const tailX = -nose + (kind === 'pickup' ? 0.069 : -0.018);
    addBox(lamps, 0xd82216, 0.072, kind === 'pickup' ? 0.22 : 0.12, kind === 'pickup' ? 0.17 : 0.29, tailX, rearY, side * half * 0.71);
    addBox(lamps, 0x981b13, 0.18, 0.085, 0.022, -nose + 0.17, belt - 0.15, side * half * 0.947);
  }
  model.add(waterfrontMesh(body, paint), waterfrontMesh(details, trim), waterfrontMesh(lamps, lenses, false));
  return model;
}

const { west, east } = GULF_CUT;
const trafficStart = west - 12;
const trafficEnd = east + 21;
const laneLength = trafficEnd - trafficStart;

export function bridgeTrafficConditions(night, rain, visibility) {
  const limitedVisibility = THREE.MathUtils.smoothstep(visibility, 0.12, 0.8);
  const wet = THREE.MathUtils.smoothstep(rain, 0.05, 0.65);
  return {
    speed: 1 - Math.max(limitedVisibility * 0.29, wet * 0.25),
    lights: 0.05 + Math.max(night, wet * 0.74, limitedVisibility * 0.89) * 3.8,
  };
}

export function bridgeTrafficPose(car, clock) {
  const { direction, phase } = car;
  let dist = THREE.MathUtils.euclideanModulo(clock * (direction > 0 ? 12.8 : 11.6) + phase, laneLength);
  // Nonuniform flow shared by the lane, so followers retain a minimum headway.
  dist += 6.2 * Math.sin(dist / laneLength * Math.PI * 2);
  const x = direction > 0 ? trafficStart + dist : trafficEnd - dist;
  const slope = (bridgeDeckAt(x + 0.36) - bridgeDeckAt(x - 0.36)) / 0.72;
  const bend = (bridgeZAt(x + 0.36) - bridgeZAt(x - 0.36)) / 0.72;
  return {
    x, y: bridgeDeckAt(x) + 0.035, z: bridgeZAt(x) + direction * 1.88,
    yaw: -Math.atan(bend) + (direction < 0 ? Math.PI : 0), pitch: direction * Math.atan(slope),
  };
}

export function buildBridgeTraffic(group) {
  return FLEET.map(spec => {
    const model = buildRoadVehicle(spec);
    group.add(model);
    return { model, direction: spec.direction, phase: spec.phase };
  });
}

export function moveBridgeTraffic(bridge, time, night, environment) {
  // Sample weather once for the crossing. A rain band can reach its far shore
  // before it reaches the player on the main channel.
  const rain = environment.sampleRainAt?.(GULF_CUT.x, GULF_CUT.z) ?? environment.values?.rain ?? 0;
  const conditions = bridgeTrafficConditions(night, rain, environment.restrictedVisibility ?? 0);
  lenses.emissiveIntensity = conditions.lights;
  const lastTime = bridge.trafficTime ?? 0;
  bridge.trafficClock = (bridge.trafficClock ?? 0) + Math.max(0, time - lastTime) * conditions.speed;
  bridge.trafficTime = time;
  for (const car of bridge.vehicles) {
    const { x, y, z, yaw, pitch } = bridgeTrafficPose(car, bridge.trafficClock);
    car.model.visible = x > west - 6 && x < east + 14;
    car.model.position.set(x, y, z);
    car.model.rotation.set(0, yaw, pitch, 'YXZ');
  }
}
