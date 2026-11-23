import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = 2 * Math.PI;

function tint(geometry, shade) {
  const positions = geometry.getAttribute('position');
  const colours = new Float32Array(positions.count * 3);
  const values = Array.isArray(shade) ? shade : null;
  const colour = new THREE.Color(typeof shade === 'number' ? shade : 0xffffff);
  for (let i = 0; i < positions.count; i++) {
    if (values) colour.setScalar(values[i]);
    colour.toArray(colours, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  geometry.deleteAttribute('uv');
  return geometry;
}

function join(...parts) {
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return geometry;
}

// Cross sections are [height, half-width, half-depth, depth offset, cloth tone].
// Rounded rings preserve the real joint positions, and overlapping cuffs/boots keep articulation closed.
function loft(rings, sides, shape) {
  const positions = [], shades = [], indices = [];
  for (let j = 0; j < rings.length; j++) {
    const [y, width, depth, centre = 0, tone = 1] = rings[j];
    for (let i = 0; i < sides; i++) {
      const angle = i / sides * TAU;
      const sin = Math.sin(angle), cos = Math.cos(angle);
      if (shape) {
        const { x, z, shade } = shape(y, width * sin, centre + depth * cos, angle, sin, cos, tone);
        positions.push(x, y, z); shades.push(shade);
      } else {
        positions.push(width * sin, y, centre + depth * cos);
        shades.push(tone);
      }
      if (j < rings.length - 1) {
        const a = j * sides + i, b = j * sides + (i + 1) % sides;
        indices.push(a, b, a + sides, b, b + sides, a + sides);
      }
    }
  }
  for (let i = 1; i < sides - 1; i++) {
    const upper = (rings.length - 1) * sides;
    indices.push(0, i + 1, i, upper, upper + i, upper + i + 1);
  }
  const shapeGeometry = new THREE.BufferGeometry();
  shapeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  shapeGeometry.setIndex(indices);
  shapeGeometry.computeVertexNormals();
  return tint(shapeGeometry, shades);
}

function cloth(y, x, z, angle, sin, cos, tone) {
  const fold = Math.cos(5 * angle + y * 17) * 0.52 + Math.cos(8 * angle - y * 25) * 0.48;
  const dust = 0.029 * Math.cos(angle - 1.2) * Math.sin(y * 40);
  return { x: x * (1 + fold * 0.055), z: z + cos * fold * 0.003, shade: tone - fold * 0.052 + dust };
}

function ellipsoid(x, y, z, rx, ry, rz, color, angle = 0, slices = 8, rings = 5) {
  return tint(new THREE.SphereGeometry(1, slices, rings).scale(rx, ry, rz).rotateZ(angle).translate(x, y, z), color);
}

function patch(points, shade) {
  const vertices = [], index = [];
  for (let i = 0; i < points.length; i++) {
    vertices.push(...points[i]);
    if (i > 1) index.push(0, i - 1, i);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return tint(geometry, shade);
}

function box(width, height, depth, x, y, z, shade) {
  return tint(new THREE.BoxGeometry(width, height, depth).translate(x, y, z), shade);
}

export function jacketGeometry() {
  const body = loft([
    [-0.035, .151, .105, 0, .63], [.005, .163, .116, 0, .78], [.052, .162, .117, .003, .86],
    [.12, .158, .111, .004, .92], [.20, .163, .118, .005, .85], [.28, .173, .131, .003, .92],
    [.37, .188, .138, -.004, .96], [.435, .203, .125, -.008, .88], [.48, .218, .101, -.012, .89],
    [.532, .184, .091, -.012, .90], [.56, .107, .072, -.006, .94], [.578, .07, .055, 0, .76],
  ], 16, cloth);
  // Folded lapels, button placket and two chest pockets are part of the torso draw.
  const detail = [patch([[-.012, .072, .117], [.014, .072, .117], [.010, .47, .109], [-.012, .443, .127]], 0xa4a4a4)];
  const yoke = [[-.154,.450,-.095],[-.085,.418,-.126],[0,.407,-.139],[.085,.418,-.126],[.154,.450,-.095]];
  for (let i = 1; i < yoke.length; i++) {
    const a = yoke[i - 1], b = yoke[i];
    detail.push(patch([a, [a[0],a[1]+.006,a[2]+.001], [b[0],b[1]+.006,b[2]+.001], b], 0xa1a1a1));
  }
  for (const side of [-1, 1]) {
    const s = side;
    // Write both lapels facing forward.
    let lapel = [[s * .032, .55, .079], [s * .073, .568, .063], [s * .116, .47, .096], [s * .061, .432, .121]];
    if (s > 0) lapel = lapel.reverse();
    detail.push(patch(lapel, 0xcbcbcb));
    const x = s * .095;
    detail.push(
      patch([[x - .042, .244, .115], [x + .039, .244, .111], [x + .048, .35, .118], [x - .043, .352, .124]], 0xd1d1d1),
      patch([[x - .046, .33, .124], [x - .002, .321, .128], [x + .045, .334, .119], [x + .047, .36, .119], [x - .046, .362, .13]], 0xb0b0b0),
    );
  }
  for (const [y, z] of [[.17,.122], [.267,.136], [.36,.137], [.44,.117]]) detail.push(ellipsoid(.003, y, z, .006, .006, .003, 0x696969, 0, 6, 3));
  return join(body, ...detail);
}

export function beltlineGeometry() {
  return loft([
    [-.084, .133, .086, 0, .66], [-.052, .163, .103, -.006, .79], [.006, .176, .109, -.009, .91],
    [.053, .17, .106, -.007, .92], [.088, .154, .1, .003, .78], [.11, .152, .1, .003, .62], [.124,.15,.099,.003,.80],
  ], 13, cloth);
}

export function sleeveGeometry(forearm) {
  return loft(forearm ? [
    [-.287,.034,.032,.006,.64],[-.268,.044,.036,.005,.79],[-.243,.044,.037,.004,.66],
    [-.154,.046,.039,.001,.95],[-.052,.061,.050,-.003,.84],[.024,.047,.045,.001,.86],[.047,.019,.025,0,.74],
  ] : [
    [-.331,.027,.024,0,.69],[-.299,.051,.042,.003,.89],[-.246,.06,.048,-.002,.75],
    [-.146,.070,.060,-.002,.95],[-.02,.078,.063,0,.9],[.025,.064,.051,0,.86],[.055,.029,.036,0,.75],
  ], 8, cloth);
}

export function pantsGeometry(shin, bare = false) {
  return loft(shin ? [
    [-.43,.042,.042,.006,.66],[-.385,.052,.048,0,.75],[-.251,.057,.05,-.012,.85],
    [-.145,.066,.059,-.017,.92],[-.02,.077,.07,.004,.82],[.027,.061,.053,.008,.91],[.048,.029,.037,0,.78],
  ] : [
    [-.459,.023,.031,0,.67],[-.43,.067,.061,.009,.78],[-.367,.074,.068,.003,.83],
    [-.225,.079,.076,-.005,.93],[-.118,.093,.084,-.002,.88],[-.045,.095,.087,0,.86],[.031,.078,.078,0,.78],
  ], 8, bare ? undefined : cloth);
}

export function bootGeometry() {
  return loft([
    [-.046,.041,.114,.016,.18],[-.033,.053,.123,.016,.27],[-.009,.055,.127,.016,.47],
    [.018,.054,.121,.016,.56],[.062,.049,.089,.003,.76],[.099,.048,.052,-.017,.66],[.133,.043,.044,-.020,.55],
  ], 9, cloth);
}

export function handGeometry(side) {
  const skin = loft([
    [-.059,.017,.014,.023,.76],[-.049,.026,.019,.018,.87],[-.031,.031,.022,.008,.94],
    [-.008,.034,.022,0,.97],[.018,.027,.023,-.004,.92],[.038,.022,.019,-.004,.83],
  ], 7);
  return join(skin, ellipsoid(-side * .028, -.019, .024, .014, .028, .015, 0xe7e7e7, side * -.52, 6, 3));
}

function faceShape(y, x, z, angle, sin, cos, tone) {
  const front = Math.max(0, cos);
  const socket = Math.exp(-(((y - .143) / .015) ** 2 + ((Math.abs(x) - .043) / .025) ** 2)) * front;
  const cheek = Math.exp(-(((y - .107) / .039) ** 2 + ((Math.abs(x) - .062) / .022) ** 2)) * front;
  return { x, z: z - socket * .01 + cheek * .009, shade: tone - socket * .16 + cheek * .03 };
}

export function headGeometry() {
  const face = loft([
    [-.025,.031,.031,-.015,.84], [.015,.042,.041,-.004,.82],
    [.043,.056,.06,.003,.92], [.064,.068,.065,.0,.91], [.082,.075,.073,-.003,.91], [.104,.08,.082,-.006,.98],
    [.131,.083,.092,-.008,.93], [.153,.081,.094,-.011,.91], [.177,.082,.093,-.013,.96],
    [.215,.074,.085,-.016,1], [.244,.048,.054,-.018,.96], [.253,.007,.008,-.021,.95],
  ], 16, faceShape);
  const nose = loft([
    [.086,.016,.012,.079,.66],[.095,.019,.018,.089,.86],[.104,.015,.021,.094,.99],
    [.124,.011,.016,.088,1],[.143,.009,.012,.08,.97],[.158,.009,.005,.076,.87],
  ], 7);
  const ears = [-1, 1].map(side => ellipsoid(side * .08, .114, -.016, .015, .033, .018, 0xdddddd, -side * .19, 6, 4));
  return join(face, nose, ...ears);
}

export function featuresGeometry(shades) {
  const features = [
    ellipsoid(0, .066, .069, .021, .004, .007, 0x624537, 0, 6, 3),
    ellipsoid(0, .060, .069, .015, .004, .005, 0x8e6555, 0, 5, 3),
  ];
  for (const side of [-1, 1]) {
    features.push(ellipsoid(side * .009, .091, .101, .007, .004, .004, 0x634839, 0, 5, 3));
    features.push(ellipsoid(side * .087, .119, -.002, .006, .012, .004, 0x725044, 0, 5, 3));
    if (shades) {
      features.push(ellipsoid(side * .037, .142, .077, .035, .016, .012, 0x25262a, side * .045, 6, 3));
      features.push(box(.036, .004, .041, side * .069, .149, .047, 0x382a24));
    } else {
      features.push(ellipsoid(side * .035, .160, .070, .023, .004, .005, 0x574136, side * -.12, 6, 3));
      const x = side * .035;
      features.push(
        patch([[x-.017,.141,.077],[x,.136,.084],[x+.015,.141,.073],[x,.147,.083]], 0x765746),
        patch([[x-.013,.141,.078],[x,.138,.0845],[x+.012,.141,.075],[x,.145,.0835]], 0xb3a392),
        patch([[x-.004,.141,.085],[x,.137,.085],[x+.004,.141,.085],[x,.145,.085]], 0x454139),
      );
    }
  }
  if (shades) features.push(box(.028, .004, .008, 0, .150, .088, 0x48453e));
  return join(...features);
}

export function hairGeometry(beard) {
  const hair = loft([
    [.103,.078,.080,-.012,.67], [.128,.087,.095,-.015,.78], [.159,.087,.098,-.016,.91],
    [.193,.085,.095,-.014,.86], [.217,.077,.087,-.015,.94], [.233,.062,.071,-.014,.88],
    [.252,.032,.043,-.014,.84], [.262,.006,.005,-.012,.9],
  ], 12, (y, x, z, angle, sin, cos, tone) => {
    // Recede at the forehead while keeping sideburns and the nape behind the ears.
    const cut = cos > .23 && y < .19;
    const wave = Math.sin(angle * 13 + y * 88);
    return { x: cut ? x * .70 : x * (1 + wave * .016), z: cut ? z - cos * .099 : z, shade: tone + wave * .06 };
  });
  return beard ? join(hair,
    ellipsoid(0, .046, .043, .048, .022, .036, 0xcbcbcb, 0, 8, 4),
    ellipsoid(-.03,.083,.067,.021,.005,.009,0xcdcdcd,.15,6,3),
    ellipsoid(.03,.083,.067,.021,.005,.009,0xcdcdcd,-.15,6,3),
  ) : hair;
}

export function neckGeometry() {
  return loft([
    [.527,.063,.052,-.01,.76],[.556,.058,.051,-.005,.90],[.6,.046,.043,-.007,1],
    [.644,.038,.039,-.007,.89],[.663,.025,.025,-.008,.82],
  ], 10);
}

export function hatGeometry(brimmed) {
  const crown = loft([
    [.173,.097,.106,-.01,.63],[.186,.099,.098,-.010,.92],[.205,.094,.099,-.01,.91],[.233,.085,.085,-.013,.87],
    [.257,.066,.070,-.012,.94],[.270,.042,.043,-.012,.89],[.275,.007,.007,-.012,.90],
  ], 12, (y, x, z, angle, sin, cos, shade) => ({ x, z, shade: shade - .07 * Math.cos(angle * 5) ** 6 }));
  const bill = loft(brimmed ? [
    [.157,.15,.15,.007,.51],[.164,.152,.152,.007,.80],[.174,.146,.148,.007,.82],[.181,.095,.102,-.01,.68],
  ] : [
    [.159,.081,.060,.122,.56],[.169,.084,.062,.120,.80],[.178,.074,.055,.117,.83],[.181,.059,.042,.121,.75],
  ], 12);
  const p = bill.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, p.getY(i) - x * x * (brimmed ? .85 : 1.4) - Math.max(0, z - .07) * .15);
  }
  bill.computeVertexNormals();
  return join(crown, bill);
}
