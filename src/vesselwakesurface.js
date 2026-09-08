import { playerWakeScale, trafficWakeScale } from './wakefield.js';

// Enough for every retained powered hull, including all recovery sites, without a texture or another draw pass.
export const MAX_SURFACE_WAKE_SOURCES = 48;
const GROUPS = 10;
export const SURFACE_WAKE_RANGE = 240;

export class VesselWakeSurface {
  constructor() {
    this.pose = new Float32Array(MAX_SURFACE_WAKE_SOURCES * 4);
    this.motion = new Float32Array(MAX_SURFACE_WAKE_SOURCES * 4);
    this.uniforms = { vesselWakePose: { value: this.pose }, vesselWakeMotion: { value: this.motion }, vesselWakeCount: { value: 0 } };
    this.sources = null; this.count = 0; this.overflow = 0; this.cameraX = 0; this.cameraZ = 0;
  }

  add(x, z, heading, speed, maxSpeed, scale, group, radialCutoff = true) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(heading) || !Number.isFinite(speed)
      || !Number.isFinite(maxSpeed) || !Number.isFinite(scale) || speed <= 2.2 || scale <= 0) return;
    const dx = x - this.cameraX, dz = z - this.cameraZ;
    if (dx * dx + dz * dz > SURFACE_WAKE_RANGE ** 2) return;
    if (this.count >= MAX_SURFACE_WAKE_SOURCES) { this.overflow++; return; }
    const i = this.count++ * 4;
    this.pose[i] = x; this.pose[i + 1] = z; this.pose[i + 2] = Math.sin(heading); this.pose[i + 3] = Math.cos(heading);
    this.motion[i] = Math.max(0, Math.min(1, (speed - 2.2) / Math.max(1, maxSpeed - 2.2)));
    this.motion[i + 1] = scale; this.motion[i + 2] = group; this.motion[i + 3] = radialCutoff ? 1 : 0;
  }

  agents(agents, group, defaultMaxSpeed, defaultScale) {
    if (!agents) return;
    for (const a of agents) {
      if (!a?.active || a.backing) continue;
      const max = Number.isFinite(a.wakeMaxSpeed) ? a.wakeMaxSpeed : Number.isFinite(a.maxSpeed) ? a.maxSpeed : Number.isFinite(a.max) ? a.max : defaultMaxSpeed;
      this.add(a.x, a.z, a.heading, a.speed, max, Number.isFinite(a.wakeScale) ? a.wakeScale : defaultScale, group);
    }
  }

  update(camera, enabled = true) {
    this.count = 0; this.overflow = 0; this.cameraX = camera.x; this.cameraZ = camera.z;
    const s = this.sources;
    if (enabled && s) {
      // These groups mirror wakeHeightAt's limits, including the story director's nested sub-fields. Do not flatten
      // them into one capped sum: that would change the crest which the player actually crosses in a pursuit.
      for (const b of s.traffic?.boats || []) if (b.active && b.kind !== 'canoe') this.add(b.x, b.z, b.heading, b.speed, b.max, trafficWakeScale(b.kind), 0, false);
      const skiff = s.skiff;
      if (skiff?.active) this.add(skiff.pos.x, skiff.pos.y, skiff.heading, skiff.speed, skiff.maxSpeed, 0.11, 1);
      this.agents(s.encounters?.agents, 2, 12.4, 0.11);
      this.agents(s.incidents?.agents, 3, 12.6, 0.11);
      const story = s.story, passage = story?.passage, a = passage?.agent;
      if (passage?.chaseActive && a?.active && !a.backing) this.add(a.x, a.z, a.heading, a.speed, 13.4, 0.11, 4, false);
      this.agents(story?.stormLine?.agents, 5, 12.7, 0.11);
      this.agents(story?.contracts?.agents, 6, 12.4, 0.105);
      if (story?.departT > 0) {
        const p = story.departPoint;
        this.add(p.x, p.z, p.heading, story.departSpeed, 6.6, 0.09, 7, false);
      }
      const recovery = s.aftermath;
      if (recovery) for (const site of recovery.sites) {
        if (!(site.type === 'blockage' && site.stage === 'marked') && !(site.type === 'survivor' && site.stage === 'reported')) continue;
        const a = recovery.rigs.get(site.id)?.agent;
        if (a?.active && !a.backing) this.add(a.x, a.z, a.heading, a.speed, 9, 0.095, 8);
      }
      // Resident craft already feel this player wake. Draw it as well, but keep it outside the player-received sum.
      const player = s.player;
      if (player) this.add(player.pos.x, player.pos.y, player.heading, player.speed, 18, playerWakeScale(player), 9, false);
    }
    this.uniforms.vesselWakeCount.value = this.count;
  }
}

export const VESSEL_WAKE_GLSL = `
uniform vec4 vesselWakePose[${MAX_SURFACE_WAKE_SOURCES}], vesselWakeMotion[${MAX_SURFACE_WAKE_SOURCES}];
uniform int vesselWakeCount;
vec3 limitVesselWave(vec3 wave, float bound) {
  return abs(wave.x) > bound ? vec3(clamp(wave.x, -bound, bound), 0.0, 0.0) : wave;
}
// Height and analytic world-space derivatives of wakefield.js's existing two stern arms and centre trough.
vec3 vesselWaveSample(vec2 p, float t, vec4 pose, vec4 motion) {
  vec2 delta = p - pose.xy;
  if (motion.w > 0.5 && dot(delta, delta) > 10609.0) return vec3(0.0);
  vec2 aftDirection = pose.zw, sideDirection = vec2(-pose.w, pose.z);
  float aft = dot(delta, aftDirection);
  if (aft < 1.5 || aft > 95.0) return vec3(0.0);
  float side = dot(delta, sideDirection), lateral = abs(side);
  float arm = 1.1 + aft * 0.34, width = 0.7 + aft * 0.025, edge = lateral - arm;
  float centreWidth = 1.4 + aft * 0.055;
  float ridge = exp(-edge * edge / (width * width));
  float trough = exp(-lateral * lateral / (centreWidth * centreWidth));
  if (ridge < 0.002 && trough < 0.002) return vec3(0.0);
  float strength = motion.x, frequency = 0.46 + strength * 0.08;
  float phase = t * (4.2 + strength * 0.8) - aft * frequency + (pose.x + pose.y) * 0.013;
  float secondary = phase * 0.73 + 1.2;
  float wave = ridge * sin(phase) - trough * 0.27 * sin(secondary);
  float ridgeAft = ridge * (2.0 * edge * 0.34 / (width * width) + 2.0 * edge * edge * 0.025 / (width * width * width));
  float ridgeSide = -2.0 * edge * ridge / (width * width);
  float troughAft = 2.0 * lateral * lateral * 0.055 * trough / (centreWidth * centreWidth * centreWidth);
  float troughSide = -2.0 * lateral * trough / (centreWidth * centreWidth);
  float waveAft = ridgeAft * sin(phase) - ridge * cos(phase) * frequency
    - 0.27 * (troughAft * sin(secondary) - trough * cos(secondary) * frequency * 0.73);
  float waveSide = ridgeSide * sin(phase) - 0.27 * troughSide * sin(secondary);
  float amplitude = motion.y * strength * strength * exp(-aft / 85.0);
  vec2 gradient = amplitude * ((waveAft - wave / 85.0) * aftDirection + waveSide * sign(side) * sideDirection);
  return vec3(amplitude * wave, gradient);
}
vec3 vesselWakeSample(vec2 p, float t, float spacing) {
  // Wake arms are metre-scale. Keep unresolved coarse rings quiet instead of aliasing them into distant spikes.
  float wakeResolutionFade = 1.0 - smoothstep(1.0, 3.0, spacing);
  if (vesselWakeCount == 0 || wakeResolutionFade <= 0.0) return vec3(0.0);
  vec3 groups[${GROUPS}];
  for (int i = 0; i < ${GROUPS}; i++) groups[i] = vec3(0.0);
  for (int i = 0; i < ${MAX_SURFACE_WAKE_SOURCES}; i++) {
    if (i >= vesselWakeCount) break;
    vec4 motion = vesselWakeMotion[i];
    groups[int(motion.z)] += vesselWaveSample(p, t, vesselWakePose[i], motion);
  }
  vec3 story = limitVesselWave(groups[4] + limitVesselWave(groups[5], 0.24) + limitVesselWave(groups[6], 0.24) + groups[7], 0.28);
  vec3 received = limitVesselWave(limitVesselWave(groups[0], 0.24) + groups[1] + limitVesselWave(groups[2], 0.24)
    + limitVesselWave(groups[3], 0.24) + story + limitVesselWave(groups[8], 0.2), 0.34);
  return (received + groups[9]) * wakeResolutionFade;
}`;
