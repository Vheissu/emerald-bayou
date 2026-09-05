import * as THREE from 'three';

// Spray and mist share these records. Changing a light writes uniforms, never material defines or particle buffers.
export function createParticleLighting() {
  return {
    sunView: { value: new THREE.Vector3(0, 1, 0) },
    sunCol: { value: new THREE.Color(0, 0, 0) },
    skyCol: { value: new THREE.Color(0, 0, 0) },
    particleSpotPosition: { value: new THREE.Vector3() },
    particleSpotDirection: { value: new THREE.Vector3(0, 0, -1) },
    particleSpotColor: { value: new THREE.Color(0, 0, 0) },
    particleSpotShape: { value: new THREE.Vector4(1, 1, 110, 0) },
    particleExtinction: { value: 0 },
  };
}

export function updateParticleLighting(uniforms, environment, camera) {
  const { sun, hemi, spotlight } = environment;
  uniforms.sunView.value.copy(environment.lightDir).transformDirection(camera.matrixWorldInverse);
  // The scene light already includes cloud cover, lunar phase and lightning. Do not apply those envelopes twice.
  uniforms.sunCol.value.copy(sun.color).multiplyScalar(sun.visible === false ? 0 : Math.max(0, sun.intensity) * 0.38);
  uniforms.skyCol.value.copy(hemi.color).multiplyScalar(hemi.visible === false ? 0 : Math.max(0, hemi.intensity) * 1.1);
  const shape = uniforms.particleSpotShape.value;
  shape.w = spotlight?.visible !== false ? Math.max(0, spotlight?.intensity || 0) * 0.18 : 0;
  if (shape.w > 0) {
    spotlight.getWorldPosition(uniforms.particleSpotPosition.value);
    spotlight.target.getWorldPosition(uniforms.particleSpotDirection.value);
    uniforms.particleSpotDirection.value.sub(uniforms.particleSpotPosition.value).normalize();
    uniforms.particleSpotColor.value.copy(spotlight.color);
    shape.x = Math.cos(spotlight.angle);
    shape.y = Math.cos(spotlight.angle * (1 - spotlight.penumbra));
    shape.z = spotlight.distance > 0 ? spotlight.distance : 10000;
  }
  uniforms.particleExtinction.value = Math.max(0, environment.values?.fog || 0) * 1.6;
  return uniforms;
}

// Evaluate the existing lamp once per particle vertex, not per translucent fragment. Its real world transform keeps
// the cone on the bow when the hull pitches or rolls; range, penumbra and fog leave nearby unlit spray in the dark.
export const PARTICLE_SPOT_VERTEX = `
  uniform vec3 particleSpotPosition, particleSpotDirection;
  uniform vec4 particleSpotShape;
  uniform float particleExtinction;
  varying float vParticleSpot;
  float particleSpotIrradiance(vec3 worldPosition) {
    if (particleSpotShape.w <= 0.0) return 0.0;
    vec3 offset = worldPosition - particleSpotPosition;
    float distanceSq = max(dot(offset, offset), 0.01);
    float distanceToLight = sqrt(distanceSq);
    float angleCos = dot(offset / distanceToLight, particleSpotDirection);
    float cone = smoothstep(particleSpotShape.x, max(particleSpotShape.x + 0.00001, particleSpotShape.y), angleCos);
    float rangeRatio = distanceToLight / particleSpotShape.z;
    float rangeFade = max(0.0, 1.0 - pow(rangeRatio, 4.0));
    return cone * rangeFade * rangeFade * min(4.0, particleSpotShape.w / max(distanceSq, 1.0))
      * exp(-distanceToLight * particleExtinction);
  }
`;
