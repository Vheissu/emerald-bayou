import * as THREE from 'three';

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const tau = Math.PI * 2;
const stride = 1.12, stance = 0.57;
const ankle = new THREE.Vector3(), knee = new THREE.Vector3(), toward = new THREE.Vector3(), lowerAxis = new THREE.Vector3();
const down = new THREE.Vector3(0, -1, 0), footAxis = new THREE.Vector3(1, 0, 0);
const upperQ = new THREE.Quaternion(), lowerQ = new THREE.Quaternion(), inverse = new THREE.Quaternion(), soleQ = new THREE.Quaternion();

export function dockBodyPose(u, pose, standing, bearing) {
  const r = u.dockReaction, state = r.state;
  if (state === 'idle') return;
  const age = r.age, gait = r.gait, gettingUp = 1 - r.rest;
  const travel = state === 'evacuate' || state === 'return' || state === 'sheltered';
  if (!travel && r.rest < 1) {
    for (const key in standing) pose[key] = lerp(pose[key], standing[key], gettingUp);
    pose.sx += Math.sin(Math.PI * gettingUp) * 0.34;
  }
  if (travel) {
    // A seated angler comes off the edge before taking a step. Keep the rod clear of the knees.
    for (const key in standing) pose[key] = lerp(pose[key], standing[key], gettingUp);
    const phase = r.distanceWalked * tau / stride, swing = Math.sin(phase) * gait;
    pose.hy -= (0.035 + 0.021 * Math.cos(phase * 2)) * gait;
    pose.hx += Math.sin(phase + 0.6) * 0.026 * gait;
    pose.hRy += swing * 0.085; pose.sy -= swing * 0.12;
    pose.sx += (state === 'evacuate' ? 0.20 : 0.065) * gait;
    pose.lf -= swing * 0.35; pose.le += Math.max(0, -swing) * 0.26;
    pose.rf = u.rodProp ? 0.66 : pose.rf + swing * 0.33;
    if (u.rodProp) { pose.re = 1.34; pose.rod = state === 'sheltered' ? -0.61 : -0.41; }
    if (state === 'evacuate') {
      pose.hdx += 0.13; pose.sz += 0.045;
      const cover = gettingUp * (0.72 + Math.sin(phase) * 0.04);
      pose.lf = lerp(pose.lf, 1.32, cover); pose.le = lerp(pose.le, 1.76, cover);
      pose.lo = lerp(pose.lo, -0.20, cover);
    }
    if (state === 'sheltered') {
      // Wipe the brow once after getting under the roof, then settle and check the water.
      const since = age - u.seed * 0.8;
      const wipe = u.rodProp ? 0 : smoothstep(since, 0.35, 0.95) * (1 - smoothstep(since, 1.32, 2.03));
      pose.lf = 0.42 + 1.00 * wipe; pose.le = 0.73 + 1.38 * wipe;
      pose.lo = 0.10 - 0.45 * wipe; pose.sx += 0.075;
      if (u.rodProp) {
        const check = Math.sin(Math.PI * smoothstep(age, 0.15, 3.2));
        pose.lf += 0.35 * check; pose.le += (0.92 + 0.12 * Math.sin(age * 8)) * check;
        pose.lo -= 0.57 * check; pose.hdx += 0.24 * check;
      }
      pose.sy += 0.16 * Math.sin(age * 0.55 + u.ph);
      pose.hdy += 0.34 * Math.sin(age * 0.75 + u.ph);
      pose.hdx += 0.06 + 0.12 * wipe;
    }
    if (gettingUp > 0 && gettingUp < 1) pose.sx += Math.sin(Math.PI * gettingUp) * 0.34;
    return;
  }
  const side = clamp(bearing, -1.55, 1.55);
  if (state === 'notice' || state === 'greet') {
    const turn = state === 'notice' ? smoothstep(age, 0.12, 0.85) : 1;
    pose.sy += side * 0.29 * turn; pose.hRy += side * 0.10 * turn;
    pose.hdx -= 0.06 * turn;
    if (state === 'greet') {
      const lift = smoothstep(age, 0.10, 0.63) * (1 - smoothstep(age, 1.42, 2.04));
      const beat = Math.sin((age - 0.6) * 9.6) * smoothstep(age, 0.50, 0.75);
      // A resident with a drink keeps hold of it and answers with a nod.
      if (!u.can) {
        pose.lf = lerp(pose.lf, 2.04, lift); pose.lo = lerp(pose.lo, 0.68 + beat * 0.12, lift);
        pose.le = lerp(pose.le, 0.91 + beat * 0.11, lift);
      }
      pose.hdx += Math.sin(Math.PI * smoothstep(age, 0.17, 0.85)) * (u.can ? 0.25 : 0.13);
      pose.sz -= 0.05 * lift;
    }
  } else if (state === 'brace' || state === 'secure') {
    const recoil = state === 'brace' ? smoothstep(age, 0.0, 0.22) * (1 - smoothstep(age, 0.6, 1.8)) : 0;
    pose.sx += 0.22 + recoil * 0.15; pose.hdx += 0.15; pose.sy -= side * 0.10;
    pose.hy -= (u.pose === 'stand' ? 0.10 : 0.025) * (0.55 + 0.45 * recoil);
    pose.lf = lerp(pose.lf, 1.10 + 0.35 * recoil, 0.84); pose.le = lerp(pose.le, 1.74, 0.80);
    pose.lo = lerp(pose.lo, -0.23, 0.8);
    pose.rf = lerp(pose.rf, u.rodProp ? 0.76 : 0.48, 0.7);
    pose.ro += 0.28; pose.re += 0.27;
    if (u.rodProp && state === 'secure') {
      const gather = smoothstep(age, 0.04, 0.65);
      pose.rod = lerp(pose.rod, 0.42, gather);
      pose.lf = lerp(pose.lf, 0.80, gather); pose.lo = lerp(pose.lo, -0.26, gather);
      pose.le = lerp(pose.le, 1.44 + Math.sin(age * 12) * 0.21, gather);
    }
  }
}

// Two-bone solve in hip space. During stance the boot moves back by exactly the
// distance the root travels; during swing it clears the deck and rolls through the toes.
function plantBoot(u, leg, side, weight) {
  const r = u.dockReaction, boot = leg.boot;
  if (!boot) return;
  boot.quaternion.identity();
  if (weight < 0.001) return;
  const phase = ((r.distanceWalked / stride + (side < 0 ? 0 : 0.5)) % 1 + 1) % 1;
  const swing = clamp((phase - stance) / (1 - stance), 0, 1);
  const reach = stride * stance;
  const z = phase <= stance ? reach * 0.5 - phase * stride : (smoothstep(swing, 0, 1) - 0.5) * reach;
  const toe = phase < stance ? smoothstep(phase, 0.42, stance) * 0.32 : (1 - swing) * 0.32 - Math.sin(Math.PI * swing) * 0.29;
  const lift = (Math.sin(Math.PI * swing) * 0.105 + Math.max(0, toe) * 0.09) * r.gait;
  const { hips } = u;
  ankle.set(side * 0.13, 0.046 + lift, 0.052 + z * r.gait);
  ankle.sub(hips.position).applyQuaternion(inverse.copy(hips.quaternion).invert()).sub(leg.thigh.position);
  const a = -leg.shin.position.y, b = boot.position.length();
  const dist = clamp(ankle.length(), Math.abs(a - b) + 0.001, a + b - 0.001);
  toward.copy(ankle).normalize(); ankle.copy(toward).multiplyScalar(dist);
  const along = (a * a - b * b + dist * dist) / (2 * dist);
  knee.set(side * 0.08, 0, 1).addScaledVector(toward, -(side * 0.08 * toward.x + toward.z));
  knee.normalize().multiplyScalar(Math.sqrt(Math.max(0, a * a - along * along))).addScaledVector(toward, along);
  upperQ.setFromUnitVectors(down, toward.copy(knee).normalize());
  ankle.sub(knee).applyQuaternion(inverse.copy(upperQ).invert()).normalize();
  lowerQ.setFromUnitVectors(lowerAxis.copy(boot.position).normalize(), ankle);
  leg.thigh.quaternion.slerp(upperQ, weight); leg.shin.quaternion.slerp(lowerQ, weight);
  soleQ.setFromAxisAngle(footAxis, toe * r.gait);
  inverse.copy(hips.quaternion).multiply(leg.thigh.quaternion).multiply(leg.shin.quaternion).invert();
  boot.quaternion.slerp(inverse.multiply(soleQ), weight);
}

export function finishDockPose(u, time) {
  const r = u.dockReaction;
  const plant = u.pose === 'stand' ? 1 : 1 - r.rest;
  plantBoot(u, u.legs[0], -1, plant); plantBoot(u, u.legs[1], 1, plant);
  const left = u.arms[0].hand, right = u.arms[1].hand;
  const wave = r.state === 'greet' && !u.can ? smoothstep(r.age, 0.25, 0.62) * (1 - smoothstep(r.age, 1.48, 1.92)) : 0;
  const wristBeat = Math.sin((r.age - 0.48) * 9.6);
  left.rotation.set(-0.13 - wave * 0.38, wave * 0.6, wave * (0.32 + wristBeat * 0.35));
  right.rotation.set(-0.08 - (u.rodProp ? 0.22 : 0), 0, 0);
  if (left.morphTargetInfluences) left.morphTargetInfluences[0] = (u.can ? 0.9 : 0.28) * (1 - wave);
  if (right.morphTargetInfluences) right.morphTargetInfluences[0] = u.rodProp ? 0.86 : 0.30 + 0.67 * (u.hoistGrip || 0);
  if (u.eyelids) {
    const period = 3.5 + u.seed * 2.7;
    const since = (time + u.ph) % period;
    const blink = smoothstep(since, 0, 0.065) * (1 - smoothstep(since, 0.065, 0.21));
    const squint = r.state === 'brace' || r.state === 'evacuate' || r.state === 'secure' ? 0.25 : 0;
    u.eyelids.morphTargetInfluences[0] = squint + (1 - squint) * blink;
  }
}
