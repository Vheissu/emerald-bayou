import { ShaderChunk } from 'three';

const MARKER = '// emerald zero-contribution light culling';
const DIRECT = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';

// Three's fixed light loops evaluate the BRDF even for black lights and pixels outside their range. Keep identical
// light counts/programs, but bypass work whose radiance is exactly zero. No threshold discards dim or fading lamps.
export function cullZeroContributionLights(source) {
  if (source.includes(MARKER)) return source;
  const pointStart = source.indexOf('#if ( NUM_POINT_LIGHTS > 0 )');
  const spotStart = source.indexOf('#if ( NUM_SPOT_LIGHTS > 0 )');
  const directionStart = source.indexOf('#if ( NUM_DIR_LIGHTS > 0 )');
  if (pointStart < 0 || spotStart <= pointStart || directionStart <= spotStart) return source;
  const guard = (block, assignment, light) => {
    if (!block.includes(assignment) || !block.includes(DIRECT)) return null;
    return block.replace(assignment, `${assignment}\n\t\tif ( any( notEqual( ${light}.color, vec3( 0.0 ) ) ) ) {`)
      .replace(DIRECT, `if ( any( notEqual( directLight.color, vec3( 0.0 ) ) ) ) { ${DIRECT} }\n\t\t}`);
  };
  const point = guard(source.slice(pointStart, spotStart), 'pointLight = pointLights[ i ];', 'pointLight');
  const spot = guard(source.slice(spotStart, directionStart), 'spotLight = spotLights[ i ];', 'spotLight');
  if (!point || !spot) return source;
  return `${MARKER}\n${source.slice(0, pointStart)}${point}${spot}${source.slice(directionStart)}`;
}

// Install before scene materials compile. Chunk expansion then also covers authored models and existing wind/wetness
// material hooks, without another onBeforeCompile wrapper or a new shader variant whenever a lamp switches state.
export function installZeroContributionLightCulling() {
  ShaderChunk.lights_fragment_begin = cullZeroContributionLights(ShaderChunk.lights_fragment_begin);
  return ShaderChunk.lights_fragment_begin.includes(MARKER);
}
