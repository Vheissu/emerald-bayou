import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const MARK_COUNT = 4;
const colors = [0xec622c, 0xeadaab, 0x4ea58a];
let geometry;
let material;

function buoyGeometry() {
  const pieces = [];
  const add = (part, y, tint) => {
    part.translate(0, y, 0);
    const color = new THREE.Color(tint), value = new Float32Array(part.attributes.position.count * 3);
    for (let i = 0; i < value.length; i += 3) color.toArray(value, i);
    part.setAttribute('color', new THREE.BufferAttribute(value, 3));
    pieces.push(part);
  };
  add(new THREE.CylinderGeometry(0.46, 0.40, 0.32, 18), 0.06, 0x3b3c31);
  add(new THREE.CylinderGeometry(0.25, 0.45, 0.98, 18), 0.66, 0xffffff);
  add(new THREE.CylinderGeometry(0.30, 0.32, 0.12, 18), 0.85, 0xfaf6ea);
  add(new THREE.CylinderGeometry(0.16, 0.248, 0.24, 18), 1.26, 0xffffff);
  add(new THREE.CylinderGeometry(0.026, 0.032, 0.67, 9), 1.65, 0x54564a);
  const pennant = new THREE.BufferGeometry();
  pennant.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0, 0.46,-0.13,0, 0,-0.30,0], 3));
  pennant.setAttribute('uv', new THREE.Float32BufferAttribute([0,1, 1,0.57, 0,0], 2));
  pennant.setIndex([0, 1, 2]); pennant.computeVertexNormals();
  add(pennant, 1.98, 0xffffff);
  const result = mergeGeometries(pieces);
  for (const piece of pieces) piece.dispose();
  return result;
}

export class RegattaMarks {
  constructor(scene) {
    material ||= colors.map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.72, vertexColors: true, side: THREE.DoubleSide }));
    geometry ||= buoyGeometry();
    this.group = new THREE.Group();
    this.group.name = 'Regatta race marks';
    this.marks = Array.from({ length: MARK_COUNT }, () => new THREE.Mesh(geometry, material[0]));
    this.group.add(...this.marks);
    scene.add(this.group);
  }

  place(index, start, gates, terrain, level) {
    for (let pair = 0; pair < 2; pair++) {
      const gate = gates[index + pair];
      const prior = gates[index + pair - 1] || start;
      for (let side = 0; side < 2; side++) {
        const mark = this.marks[pair * 2 + side];
        mark.visible = false;
        if (!gate) continue;
        const dx = gate.x - prior.x, dz = gate.z - prior.z, length = Math.hypot(dx, dz) || 1;
        const sign = side === 0 ? -1 : 1;
        // Narrow cuts have room for fewer metres of gate, but the mark must still float.
        for (let gap = gate.r; gap >= 3; gap -= 1) {
          const x = gate.x + sign * dz / length * gap, z = gate.z - sign * dx / length * gap;
          if (terrain.heightAt(x, z) > level - 0.30) continue;
          mark.position.set(x, level, z);
          mark.material = material[index + pair === gates.length - 1 ? 2 : pair];
          mark.visible = true;
          break;
        }
      }
    }
  }

  update(level, time, wave) {
    for (const [i, mark] of this.marks.entries()) {
      if (!mark.visible) continue;
      const phase = time * 1.6 + i * 1.27;
      mark.position.y = (wave ? wave(mark.position.x, mark.position.z, time) : level) + Math.sin(phase) * 0.03;
      mark.rotation.set(Math.sin(phase) * 0.028, i * 1.3, Math.cos(phase * 0.93) * 0.037);
    }
  }
}
