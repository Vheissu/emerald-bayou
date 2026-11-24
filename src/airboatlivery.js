import * as THREE from 'three';

// Paint directly onto the side panels. Hull normals and the local shape keep the stripes
// off the deck and transom, with the baked wear maps and live scratches still showing through.
export function installAirboatLivery(material) {
  const paint = {
    enabled: { value: 0 }, base: { value: new THREE.Color() }, stripe: { value: new THREE.Color() },
  };
  const compile = material.onBeforeCompile.bind(material);
  const cacheKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compile(shader, renderer);
    shader.uniforms.uLiveryEnabled = paint.enabled;
    shader.uniforms.uLiveryBase = paint.base;
    shader.uniforms.uLiveryStripe = paint.stripe;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLiveryPosition;\nvarying float vLiverySide;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLiveryPosition = transformed;\nvLiverySide = abs(normal.x);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uLiveryEnabled;
uniform vec3 uLiveryBase, uLiveryStripe;
varying vec3 vLiveryPosition;
varying float vLiverySide;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float paintCover = 0.0;
if (uLiveryEnabled > 0.5) {
  // Let the band sweep up slightly where the skiff narrows into the bow.
  vec3 p = vLiveryPosition;
  float swept = p.y - (1.0 - smoothstep(-2.45, -0.95, p.z)) * 0.13;
  float side = smoothstep(0.50, 0.75, vLiverySide);
  float run = smoothstep(-2.48, -2.40, p.z) * (1.0 - smoothstep(2.25, 2.36, p.z));
  float band = smoothstep(0.19, 0.198, swept) * (1.0 - smoothstep(0.36, 0.368, swept));
  float pin = smoothstep(0.391, 0.397, swept) * (1.0 - smoothstep(0.420, 0.426, swept));
  float wear = clamp(dot(diffuseColor.rgb, vec3(0.30, 0.54, 0.16)) * 0.80 + 0.29, 0.26, 1.08);
  float detail = 0.84 + 0.16 * smoothstep(0.48, 0.70, sin(p.z * 287.1 + p.y * 553.2));
  paintCover = max(band, pin) * side * run * detail;
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(uLiveryBase, uLiveryStripe, pin) * wear, paintCover);
}`)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.24, paintCover);');
  };
  material.customProgramCacheKey = () => `${cacheKey}-livery-v1`;
  material.userData.livery = paint;
  material.needsUpdate = true;
  return paint;
}

export function setAirboatLivery(boat, colors) {
  const paint = boat?.getObjectByName('airboat hull')?.material.userData.livery;
  if (!paint) return;
  paint.enabled.value = colors ? 1 : 0;
  if (!colors) return;
  paint.base.value.setHex(colors[0]);
  paint.stripe.value.setHex(colors[1]);
}
