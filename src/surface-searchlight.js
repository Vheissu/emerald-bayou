import * as THREE from 'three';

const BEAM_GEOMETRY = new THREE.PlaneGeometry(1, 1);
const BEAM_MATERIALS = new Map();

function beamMaterial(color) {
  const key = Number(color) >>> 0; let material = BEAM_MATERIALS.get(key);
  if (material) return material;
  material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(key) } },
    vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: 'uniform vec3 color; varying vec2 vUv; void main(){float v=vUv.y;float width=mix(0.06,0.7,v);float side=1.0-smoothstep(width*0.54,width,abs(vUv.x-0.5)*2.0);float fade=smoothstep(0.0,0.09,v)*(1.0-smoothstep(0.68,1.0,v));gl_FragColor=vec4(color,side*fade*0.075);}',
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
  });
  BEAM_MATERIALS.set(key, material); return material;
}

export function makeSurfaceSearchBeam(color = 0xd9efff, name = 'surface searchlight beam') {
  const beam = new THREE.Mesh(BEAM_GEOMETRY, beamMaterial(color));
  beam.name = name; beam.rotation.x = -Math.PI / 2; beam.renderOrder = 34; beam.visible = false;
  return beam;
}

export function surfaceSearchlightResourceStats() {
  const attributes = BEAM_GEOMETRY.attributes;
  const geometryBytes = attributes.position.array.byteLength + attributes.normal.array.byteLength + attributes.uv.array.byteLength + (BEAM_GEOMETRY.index?.array.byteLength || 0);
  return { geometries: 1, materials: BEAM_MATERIALS.size, textures: 0, geometryBytes };
}
