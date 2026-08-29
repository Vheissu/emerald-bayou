import * as THREE from 'three';
import { person } from './folk.js';

const DOWN = new THREE.Vector3(0, -1, 0);

function addMesh(parent, geometry, material, { position = null, rotation = null, scale = null, shadow = false, name = '' } = {}) {
  const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
  if (position) mesh.position.set(...position);
  if (rotation) mesh.rotation.set(...rotation);
  if (scale) mesh.scale.set(...scale);
  mesh.castShadow = shadow; mesh.receiveShadow = shadow; parent.add(mesh);
  return mesh;
}

function rescueBasket(material) {
  const basket = new THREE.Group(); basket.name = 'rescue basket'; basket.visible = false;
  const ringGeometry = new THREE.TorusGeometry(0.46, 0.035, 6, 18), barGeometry = new THREE.CylinderGeometry(0.018, 0.018, 0.7, 5);
  const top = addMesh(basket, ringGeometry, material, { rotation: [Math.PI / 2, 0, 0], position: [0, 0.22, 0] });
  const bottom = addMesh(basket, ringGeometry, material, { rotation: [Math.PI / 2, 0, 0], position: [0, -0.45, 0] });
  top.castShadow = bottom.castShadow = true;
  const bars = new THREE.InstancedMesh(barGeometry, material, 8), matrix = new THREE.Matrix4();
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4; matrix.makeTranslation(Math.cos(a) * 0.43, -0.115, Math.sin(a) * 0.43); bars.setMatrixAt(i, matrix);
  }
  bars.instanceMatrix.needsUpdate = true; bars.castShadow = true; basket.add(bars);
  addMesh(basket, new THREE.CylinderGeometry(0.4, 0.4, 0.035, 18), material, { position: [0, -0.46, 0], shadow: true });
  return basket;
}

function dynamicLine(points, color, opacity = 0.92) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  line.frustumCulled = false; line.visible = false;
  return line;
}

export function setAirRescueRole(rig, role = 'rescue') {
  const enforcement = role === 'enforcement';
  rig.role = enforcement ? 'enforcement' : 'rescue';
  rig.root.name = enforcement ? 'FWC aviation helicopter' : 'Coast Guard rescue helicopter';
  rig.livery.primary.color.setHex(enforcement ? 0x2d5c4b : 0xe94d20);
  rig.livery.stripe.color.setHex(enforcement ? 0xdde7df : 0xe7ecea);
  rig.livery.strobe.color.setHex(enforcement ? 0x267cff : 0xffffff);
  return rig;
}

export function makeAirRescueRig(rr, scene) {
  const root = new THREE.Group(); root.name = 'Coast Guard rescue helicopter'; root.visible = false;
  const rescueOrange = new THREE.MeshStandardMaterial({ color: 0xe94d20, roughness: 0.58, metalness: 0.24 });
  const white = new THREE.MeshStandardMaterial({ color: 0xe7ecea, roughness: 0.48, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151b1d, roughness: 0.52, metalness: 0.44 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x18333c, roughness: 0.18, metalness: 0.24, transparent: true, opacity: 0.88 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x59636a, roughness: 0.42, metalness: 0.72 });
  const bodyGeometry = new THREE.SphereGeometry(1, 18, 12), boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  addMesh(root, bodyGeometry, rescueOrange, { scale: [1.35, 0.82, 2.85], position: [0, 0, -0.35], shadow: true, name: 'rescue helicopter fuselage' });
  addMesh(root, bodyGeometry, glass, { scale: [1.2, 0.59, 1.13], position: [0, 0.18, -2.28], shadow: true, name: 'cockpit canopy' });
  addMesh(root, boxGeometry, white, { scale: [2.53, 0.29, 2.25], position: [0, 0.02, 0.05], shadow: true, name: 'Coast Guard cabin stripe' });
  addMesh(root, boxGeometry, dark, { scale: [0.025, 0.72, 1.05], position: [-1.31, 0.02, -0.05], name: 'port cabin door' });
  addMesh(root, boxGeometry, dark, { scale: [0.025, 0.72, 1.05], position: [1.31, 0.02, -0.05], name: 'starboard cabin door' });

  const boomGeometry = new THREE.CylinderGeometry(0.16, 0.56, 4.5, 10);
  addMesh(root, boomGeometry, rescueOrange, { rotation: [Math.PI / 2, 0, 0], position: [0, 0.18, 3.42], shadow: true, name: 'tail boom' });
  addMesh(root, boxGeometry, rescueOrange, { scale: [0.14, 1.55, 1.15], position: [0, 0.85, 5.55], shadow: true, name: 'vertical stabilizer' });
  addMesh(root, boxGeometry, white, { scale: [2.35, 0.09, 0.58], position: [0, 0.4, 4.85], shadow: true, name: 'tailplane' });

  addMesh(root, new THREE.CylinderGeometry(0.1, 0.13, 0.72, 8), metal, { position: [0, 1.1, -0.1], shadow: true, name: 'main rotor mast' });
  const rotor = new THREE.Group(); rotor.name = 'main rotor'; rotor.position.set(0, 1.5, -0.1); root.add(rotor);
  const mainBladeGeometry = new THREE.BoxGeometry(0.24, 0.035, 6.2);
  addMesh(rotor, mainBladeGeometry, dark, { shadow: true });
  addMesh(rotor, mainBladeGeometry, dark, { rotation: [0, Math.PI / 2, 0], shadow: true });
  const rotorDisc = addMesh(rotor, new THREE.CircleGeometry(4.2, 40), new THREE.MeshBasicMaterial({ color: 0x394244, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }), { rotation: [-Math.PI / 2, 0, 0], name: 'main rotor blur' });
  rotorDisc.renderOrder = 12;

  const tailRotor = new THREE.Group(); tailRotor.name = 'tail rotor'; tailRotor.position.set(0.2, 0.72, 5.82); root.add(tailRotor);
  const tailBladeGeometry = new THREE.BoxGeometry(0.08, 1.55, 0.035);
  addMesh(tailRotor, tailBladeGeometry, dark);
  addMesh(tailRotor, tailBladeGeometry, dark, { rotation: [0, 0, Math.PI / 2] });
  addMesh(tailRotor, new THREE.CircleGeometry(0.9, 24), new THREE.MeshBasicMaterial({ color: 0x4d5556, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }), { position: [0, 0, -0.03], name: 'tail rotor blur' });

  const strutGeometry = new THREE.CylinderGeometry(0.035, 0.045, 0.78, 6), wheelGeometry = new THREE.CylinderGeometry(0.18, 0.18, 0.11, 12);
  for (const x of [-0.82, 0.82]) {
    addMesh(root, strutGeometry, metal, { position: [x, -0.82, -0.7], rotation: [0, 0, x < 0 ? -0.25 : 0.25], shadow: true });
    addMesh(root, wheelGeometry, dark, { position: [x * 1.08, -1.18, -0.7], rotation: [0, 0, Math.PI / 2], shadow: true });
  }
  addMesh(root, strutGeometry, metal, { position: [0, -0.72, 2.2], rotation: [0.22, 0, 0], shadow: true });
  addMesh(root, wheelGeometry, dark, { position: [0, -1.08, 2.32], rotation: [0, 0, Math.PI / 2], shadow: true });
  const lampGeometry = new THREE.SphereGeometry(0.07, 8, 6);
  const portLamp = addMesh(root, lampGeometry, new THREE.MeshBasicMaterial({ color: 0xff382b, toneMapped: false }), { position: [-1.48, 0.05, 0.2], name: 'port navigation light' });
  const starboardLamp = addMesh(root, lampGeometry, new THREE.MeshBasicMaterial({ color: 0x39ff78, toneMapped: false }), { position: [1.48, 0.05, 0.2], name: 'starboard navigation light' });
  const strobe = addMesh(root, lampGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), { position: [0, 1.02, 1.2], name: 'aircraft anti-collision strobe' });

  const target = new THREE.Object3D(); target.name = 'air rescue searchlight target';
  const searchlight = new THREE.SpotLight(0xeaf4ff, 0, 190, 0.24, 0.72, 1.25); searchlight.name = 'air rescue searchlight'; searchlight.position.set(0.52, -0.55, -1.35); searchlight.target = target; root.add(searchlight);
  const beamGeometry = new THREE.ConeGeometry(1, 1, 28, 1, true); beamGeometry.translate(0, -0.5, 0);
  const beamMaterial = new THREE.MeshBasicMaterial({ color: 0xd9edff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false });
  const beam = new THREE.Mesh(beamGeometry, beamMaterial); beam.name = 'air rescue volumetric beam'; beam.visible = false; beam.renderOrder = 42;
  const poolGeometry = new THREE.CircleGeometry(1, 30); poolGeometry.rotateX(-Math.PI / 2);
  const poolUniforms = { uOpacity: { value: 0 } };
  const poolMaterial = new THREE.ShaderMaterial({
    uniforms: poolUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'precision highp float; uniform float uOpacity; varying vec2 vUv; void main(){ float r=length((vUv-.5)*2.); float a=(1.-smoothstep(.15,1.,r))*(.74+.26*cos(r*10.)); if(a<.01) discard; gl_FragColor=vec4(.72,.88,1.,a*uOpacity); }',
  });
  const pool = new THREE.Mesh(poolGeometry, poolMaterial); pool.name = 'air rescue searchlight pool'; pool.visible = false; pool.renderOrder = 43;

  const survivor = person(rr, { pose: 'sitEdge', vest: true, hat: false }); survivor.name = 'air search survivor'; survivor.visible = false;
  const swimmer = person(rr, { pose: 'stand', vest: true, hat: false }); swimmer.name = 'Coast Guard rescue swimmer'; swimmer.visible = false;
  const basket = rescueBasket(metal);
  const hoistLine = dynamicLine(24, 0xb9c1c2, 0.94); hoistLine.name = 'helicopter hoist cable';
  const trailLine = dynamicLine(18, 0xf19a35, 0.9); trailLine.name = 'helicopter trail line';

  const survivorStrobe = new THREE.Group(); survivorStrobe.name = 'survivor strobe'; survivorStrobe.visible = false;
  const survivorBulb = addMesh(survivorStrobe, lampGeometry, new THREE.MeshBasicMaterial({ color: 0xeaf7ff, toneMapped: false }), { name: 'survivor strobe bulb' });
  const survivorLight = new THREE.PointLight(0xd8f2ff, 0, 34, 2); survivorStrobe.add(survivorLight);

  scene.add(root, target, beam, pool, survivor, swimmer, basket, hoistLine, trailLine, survivorStrobe);
  return {
    root, rotor, tailRotor, rotorDisc, portLamp, starboardLamp, strobe, target, searchlight, beam, beamMaterial, pool, poolUniforms,
    survivor, swimmer, basket, hoistLine, trailLine, survivorStrobe, survivorBulb, survivorLight,
    role: 'rescue', livery: { primary: rescueOrange, stripe: white, strobe: strobe.material },
    beamDirection: new THREE.Vector3(), beamQuaternion: new THREE.Quaternion(),
  };
}

export function updateAirRescueAircraft(rig, state, t) {
  const bob = Math.sin(t * 1.37 + state.phase) * (state.mode === 'hoist' ? 0.16 : 0.28);
  rig.root.position.set(state.hx, state.hy + bob, state.hz);
  rig.root.rotation.set(state.pitch || 0, state.heading, state.bank || 0, 'YXZ');
  rig.rotor.rotation.y += state.dt * 18.5; rig.tailRotor.rotation.z += state.dt * 27;
  const nav = Math.floor(t * 1.8) % 2 === 0, flash = Math.sin(t * 9.7) > 0.86;
  rig.portLamp.visible = rig.starboardLamp.visible = nav; rig.strobe.visible = flash;
}

export function updateAirRescueBeam(rig, fromX, fromY, fromZ, targetX, targetY, targetZ, strength) {
  const direction = rig.beamDirection.set(targetX - fromX, targetY - fromY, targetZ - fromZ), length = Math.max(1, direction.length());
  direction.multiplyScalar(1 / length); rig.target.position.set(targetX, targetY, targetZ);
  rig.searchlight.intensity = 920 * strength; rig.beam.visible = strength > 0.015; rig.pool.visible = strength > 0.015;
  if (!rig.beam.visible) { rig.beamMaterial.opacity = 0; rig.poolUniforms.uOpacity.value = 0; return; }
  rig.beam.position.set(fromX, fromY, fromZ); rig.beamQuaternion.setFromUnitVectors(DOWN, direction); rig.beam.quaternion.copy(rig.beamQuaternion);
  rig.beam.scale.set(length * 0.14, length, length * 0.14); rig.beamMaterial.opacity = 0.012 + strength * 0.022;
  rig.pool.position.set(targetX, targetY + 0.045, targetZ); rig.pool.scale.setScalar(Math.max(3.2, length * 0.16)); rig.poolUniforms.uOpacity.value = 0.14 + strength * 0.32;
}
