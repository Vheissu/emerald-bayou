import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const TAU = 2 * Math.PI;

function tint(geometry, shade) {
  const positions = geometry.getAttribute('position');
  const colours = new Float32Array(positions.count * 3);
  const values = Array.isArray(shade) ? shade : null;
  const colour = new THREE.Color(typeof shade === 'number' ? shade : 0xffffff);
  for (let i = 0; i < positions.count; i++) {
    if (values) {
      const shade = values[i];
      if (Array.isArray(shade)) colour.setRGB(...shade);
      else colour.setScalar(shade);
    }
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
        const { x, y: height = y, z, shade } = shape(y, width * sin, centre + depth * cos, angle, sin, cos, tone);
        positions.push(x, height, z); shades.push(shade);
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

function seam(points, radius, shade) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return tint(new THREE.TubeGeometry(curve, points.length * 2, radius, 4), shade);
}

export function jacketGeometry() {
  const body = loft([
    [-0.035, .151, .105, 0, .63], [.005, .163, .116, 0, .78], [.052, .162, .117, .003, .86],
    [.12, .158, .111, .004, .92], [.20, .163, .118, .005, .85], [.28, .173, .131, .003, .92],
    [.37, .188, .138, -.004, .96], [.435, .203, .125, -.008, .88], [.483, .223, .111, -.012, .89],
    [.532, .194, .096, -.012, .90], [.563, .130, .074, -.01, .94], [.585, .074, .054, -.004, .76],
  ], 24, cloth);
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
    let lapel = [[s * .027, .555, .076], [s * .078, .572, .061], [s * .092, .509, .087], [s * .043, .489, .108]];
    if (s > 0) lapel = lapel.reverse();
    detail.push(patch(lapel, 0xcbcbcb));
    const x = s * .095;
    detail.push(
      patch([[x - .042, .244, .115], [x + .039, .244, .111], [x + .048, .35, .118], [x - .043, .352, .124]], 0xd1d1d1),
      patch([[x - .046, .33, .124], [x - .002, .321, .128], [x + .045, .334, .119], [x + .047, .36, .119], [x - .046, .362, .13]], 0xb0b0b0),
      seam([[x-.036,.33,.126], [x-.036,.251,.119], [x-.029,.244,.123], [x+.029,.243,.121], [x+.038,.25,.116]], .0016, 0xa0a095),
      seam([[x-.04,.348,.131], [x-.001,.337,.137], [x+.041,.35,.127]], .0018, 0xb6b5a9),
    );
    detail.push(seam([[s*.070,.563,.066],[s*.084,.527,.085],[s*.047,.502,.108]], .0016, 0xb0ada4));
    detail.push(seam([[s*.113,.517,-.048], [s*.181,.478,-.040], [s*.194,.444,.043], [s*.150,.393,.090]], .0016, 0xc2bdb1));
  }
  detail.push(seam([[-.009,.063,.122], [-.008,.118,.117], [-.011,.246,.133], [-.009,.37,.137], [-.009,.444,.127]], .002, 0xb5b2aa));
  for (const [y, z] of [[.09,.125],[.172,.124],[.254,.138],[.336,.137],[.417,.124]]) {
    detail.push(ellipsoid(.002, y, z, .0057, .0057, .0027, 0x80786a, 0, 8, 4));
  }
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
    [-.351,.025,.026,0,.74],[-.320,.040,.038,.003,.84],[-.286,.053,.048,.003,.88],[-.246,.061,.049,-.002,.79],
    [-.146,.071,.060,-.002,.95],[-.033,.078,.064,0,.90],[.022,.075,.060,0,.89],[.063,.051,.047,0,.81],
    [.087,.023,.026,0,.78],
  ], 12, (y, x, z, angle, sin, cos, tone) => {
    const surface = cloth(y, x, z, angle, sin, cos, tone);
    surface.shade -= .09 * Math.abs(sin) ** 28;
    return surface;
  });
}

export function rolledSleeveGeometry() {
  // The doubled underside forms a lip and a diagonal crease above the elbow.
  return loft([
    [-.318,.048,.046,.002,.63], [-.311,.056,.052,.003,.78], [-.304,.061,.054,.003,1.0],
    [-.293,.060,.055,.002,.84], [-.279,.062,.056,.002,.97], [-.268,.053,.049,.002,.64],
    [-.245,.061,.050,-.002,.80], [-.146,.071,.060,-.002,.94], [-.033,.078,.064,0,.90],
    [.022,.075,.060,0,.89], [.063,.051,.047,0,.81], [.087,.023,.026,0,.78],
  ], 12, (y,x,z,a,s,c,tone) => ({
    x: x * (1 + .045 * Math.sin(a * 3)),
    y: y + (y < -.25 ? .009 * s : 0),
    z: z + .003 * c * Math.sin(a * 3),
    shade: tone + .04 * s,
  }));
}

export function forearmGeometry(side) {
  return loft([
    [-.277,.025,.020,-.003,.85], [-.259,.031,.023,0,.91], [-.233,.031,.024,0,.93],
    [-.199,.036,.029,.002,.94], [-.151,.045,.034,.004,.96], [-.100,.050,.040,.005,.96],
    [-.066,.053,.043,.004,.92], [-.033,.051,.040,0,.90], [.003,.045,.038,-.004,.84],
    [.027,.036,.034,-.004,.77],
  ], 14, (y,x,z,a,s,c,tone) => ({
    x: x - side * .005 * Math.sin((y + .27) * 11), z: z + c * .0025 * Math.cos(a * 4 + y * 12),
    shade: tone - .04 * Math.cos(a * 3 + y * 9),
  }));
}

export function pantsGeometry(shin, bare = false) {
  return loft(shin ? [
    [-.43,.042,.042,.006,.66],[-.385,.052,.048,0,.75],[-.251,.057,.05,-.012,.85],
    [-.145,.066,.059,-.017,.92],[-.02,.077,.07,.004,.82],[.027,.061,.053,.008,.91],[.048,.029,.037,0,.78],
  ] : [
    [-.459,.023,.031,0,.67],[-.43,.067,.061,.009,.78],[-.367,.074,.068,.003,.83],
    [-.225,.079,.076,-.005,.93],[-.118,.093,.084,-.002,.88],[-.045,.095,.087,0,.86],[.031,.078,.078,0,.78],
  ], 12, bare ? undefined : (y, x, z, angle, sin, cos, tone) => {
    const surface = cloth(y, x, z, angle, sin, cos, tone);
    surface.shade += (cos > 0 ? .08 : .02) * Math.abs(sin) ** 32 - .10 * Math.abs(sin) ** 80;
    return surface;
  });
}

export function bootGeometry() {
  const boot = loft([
    [-.046,.041,.114,.016,.18],[-.033,.053,.123,.016,.27],[-.009,.055,.127,.016,.47],
    [.018,.054,.121,.016,.56],[.062,.049,.089,.003,.76],[.099,.048,.052,-.017,.66],[.133,.043,.044,-.020,.55],
  ], 12, cloth);
  const welt = loft([[-.034,.054,.123,.016,.34],[-.028,.056,.126,.016,.45],[-.018,.055,.126,.016,.23]], 12);
  const details = [];
  for (let i = 0; i < 4; i++) {
    const y = .025 + i * .014, z = .126 - i * .018;
    details.push(seam([[-.029,y,z-.013],[.003,y+.003,z],[.028,y+.008,z-.015]], .0028, 0x8b8071));
  }
  for (let i = 0; i < 5; i++) details.push(box(.098, .012, .016, 0, -.041, -.066+i*.04, 0x53504a));
  return join(boot, welt, ...details);
}

function morphPosition(geometry, name, transform) {
  const from = geometry.getAttribute('position'), to = from.clone();
  for (let i = 0; i < from.count; i++) to.setXYZ(i, ...transform(from.getX(i), from.getY(i), from.getZ(i)));
  to.name = name;
  geometry.setAttribute('targetPosition', to);
  return geometry;
}

function joinMorph(name, ...parts) {
  for (const part of parts) {
    if (!part.hasAttribute('targetPosition')) part.setAttribute('targetPosition', part.getAttribute('position').clone());
  }
  const geometry = join(...parts);
  const target = geometry.getAttribute('targetPosition');
  target.name = name;
  geometry.morphAttributes.position = [target];
  geometry.deleteAttribute('targetPosition');
  const rest = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  geometry.setAttribute('position', target);
  geometry.computeVertexNormals();
  const targetNormal = geometry.getAttribute('normal').clone();
  targetNormal.name = name;
  geometry.setAttribute('position', rest);
  geometry.setAttribute('normal', normal);
  geometry.computeVertexNormals();
  geometry.morphAttributes.normal = [targetNormal];
  return geometry;
}

export function handGeometry(side) {
  const palm = loft([
    [-.045,.026,.012,.004,.89],[-.035,.032,.017,.003,.92],[-.016,.033,.02,0,.99],
    [.004,.029,.019,-.006,.94],[.025,.023,.018,-.006,.94],[.04,.022,.018,-.004,.85],
  ], 12);
  const fingers = [];
  for (let i = 0; i < 4; i++) {
    const x = side * (i - 1.5) * .0164, length = [.052, .059, .055, .041][i];
    const width = [.0084, .0083, .0076, .0072][i];
    const y = -.034 + Math.abs(i - 1.4) * .004;
    const p = loft([
      [-length,.0033,.0034,.011,.81],[-length*.85,width*.78,width*.76,.008,.91],
      [-length*.64,width*.82,width*.79,.004,.93],[-length*.48,width*.76,width*.77,.001,.95],
      [-length*.29,width,width*.93,0,.94],[-length*.10,width*.91,width*.87,-.004,.91],
      [.006,width*.87,width*.76,-.004,.88],
    ], 8);
    p.translate(x, y, .005);
    const tip = (a, b, c) => {
      const extending = Math.max(0, (y - b) / length), bending = extending * 2.35;
      return [a - x * extending * .33, b + (extending - Math.sin(bending) / 2.35) * length, c + (1 - Math.cos(bending)) * length / 2.35];
    };
    fingers.push(morphPosition(p, 'grip', tip));
    const nail = ellipsoid(x, y - length * .85, .005 + .008 - width * .73, width * .52, length * .115, .0015, 0xf4dbcc, 0, 8, 4);
    fingers.push(morphPosition(nail, 'grip', tip));
  }
  const thumb = loft([
    [-.037,.005,.005,.012,.85],[-.03,.010,.009,.009,.91],
    [-.013,.013,.01,.003,.98],[.007,.011,.01,-.002,.91],[.016,.009,.009,0,.89],
  ], 9);
  thumb.rotateZ(-side * .46).translate(-side * .026, -.005, .013);
  fingers.push(morphPosition(thumb, 'grip', (x, y, z) => [x + side * Math.max(0, -y) * .47, y + Math.max(0, -y) * .2, z + Math.max(0, -y) * .38]));
  return joinMorph('grip', palm, ...fingers);
}

// Local +Z faces forward. Keep the proportions and eye placement in model space, so
// the same rig fits different heads and eyes can follow a common blink channel.
const faces = [
  { jaw: .97, cheeks: 1.04, nose: 1.07, brow: .98, width: .98, hairline: .02 },
  { jaw: 1.10, cheeks: 1.02, nose: .94, brow: 1.08, width: 1.02, hairline: 0 },
  { jaw: .88, cheeks: .98, nose: .93, brow: .88, width: .94, hairline: .014 },
  { jaw: .94, cheeks: .94, nose: 1.01, brow: 1.02, width: 1.04, hairline: .031 },
];

const headSections = [
  [-.025,.033,.033,-.026], [0,.044,.045,-.025], [.020,.05,.054,-.020], [.035,.055,.06,-.013],
  [.049,.060,.061,-.004], [.065,.064,.065,-.005], [.08,.068,.067,-.006], [.101,.075,.072,-.008],
  [.126,.082,.081,-.011], [.152,.082,.091,-.015], [.18,.080,.092,-.015], [.202,.078,.085,-.014],
  [.224,.069,.079,-.018], [.241,.058,.068,-.018], [.254,.032,.039,-.018], [.258,.006,.007,-.019],
];

const gauss = (v, centre, width) => Math.exp(-(((v - centre) / width) ** 2));
const eyeCentre = .0355;
const lipY = x => .069 + .0016 * gauss(Math.abs(x), .0075, .005) - .0013 * (x / .024) ** 2;

function headSection(y, variant) {
  let end = 1;
  while (end < headSections.length - 1 && headSections[end][0] < y) end++;
  const from = headSections[end - 1], to = headSections[end];
  const t = THREE.MathUtils.clamp((y - from[0]) / (to[0] - from[0]), 0, 1);
  const mix = k => from[k] + (to[k] - from[k]) * t;
  const jaw = 1 + (variant.jaw - 1) * gauss(y, .058, .045);
  return [mix(1) * variant.width * jaw, mix(2), mix(3)];
}

function skinTone(x, y, front, beard) {
  const ax = Math.abs(x);
  const shave = gauss(y, .058, .036) * gauss(ax, .034, .047) * front;
  const sun = (gauss(ax, .057, .027) * gauss(y, .124, .023) + gauss(ax, .014, .027) * gauss(y,.109,.018)) * front;
  const eye = gauss(ax, eyeCentre, .023) * gauss(y, .148, .015) * front;
  const chin = gauss(y,.025,.024);
  const lip = gauss(ax, 0, .016) * gauss(y, lipY(x) - .0014, .0054) * front ** 6;
  const variation = Math.sin(x*267 + y*219) * Math.sin(y*169 - x*457) * .018;
  const jawStubble = gauss(y, .043, .021) * gauss(ax, .014, .048);
  const moustache = gauss(y, .081, .006) * gauss(ax, .013, .014);
  const stubble = beard * Math.max(jawStubble, moustache) * front ** 3;
  const tone = (.94 - eye * .19 - chin * .11 - shave * .12 + variation) * (1 - stubble * .61);
  return [tone + sun * .085 + lip * .045, tone - sun * .029 - lip * .19, tone - sun * .037 + shave * .034 - lip * .064 + stubble * .034];
}

function shapeFace(x, y, z, cos, variant) {
  const front = Math.max(0, cos);
  const ax = Math.abs(x), central = front ** 5;
  const socket = gauss(y, .150, .015) * gauss(ax, eyeCentre, .021) * front;
  const brow = gauss(y, .169, .010) * gauss(ax, .037, .019) * front;
  const cheek = gauss(y, .124, .025) * gauss(ax, .054, .025) * front;
  const bridge = gauss(ax, 0, .012) * gauss(y, .141, .033) * .021;
  const nose = gauss(ax, .001, .015) * gauss(y, .110, .013) * .040;
  const wing = gauss(ax, .015, .010) * gauss(y, .106, .008) * .020;
  const nostril = gauss(ax, .012, .0045) * gauss(y, .102, .0045) * .009;
  const muzzle = gauss(ax, 0, .031) * gauss(y, .073, .027) * .013;
  const chin = gauss(ax, 0, .037) * gauss(y, .039, .018) * .014;
  const philtrum = gauss(ax, .0045, .0036) * gauss(y, .089, .012) * .005;
  const lip = gauss(ax, 0, .019) * (gauss(y, lipY(x) - .004, .0028) * .004 + gauss(y, lipY(x) + .0026, .0026) * .0027);
  return z + (.010 * brow * variant.brow + .012 * cheek * variant.cheeks - .012 * socket)
    + central * (variant.nose * (bridge + nose + wing - nostril) + muzzle + chin + philtrum + lip);
}

function facePoint(x, y, depth, variant) {
  const [w, d, offset] = headSection(y, variant);
  const cos = Math.sqrt(1 - Math.min(1, (x / w) ** 2));
  return [x, y, shapeFace(x, y, offset + cos * d, cos, variant) + depth];
}

export function headGeometry(form = 0, beard = false) {
  const variant = faces[form];
  const rings = Array.from({ length: 44 }, (_, i) => {
    const y = -.025 + i / 43 * .283;
    return [y, ...headSection(y, variant)];
  });
  const head = loft(rings, 48, (y, x, z, angle, sin, cos) => ({
    x, z: shapeFace(x, y, z, cos, variant), shade: skinTone(x, y, Math.max(0, cos), beard),
  }));
  const ears = [];
  for (const side of [-1, 1]) {
    const x = side * .076 * variant.width;
    ears.push(
      ellipsoid(x, .121, -.021, .017, .032, .018, 0xe9c6b5, -side * .20, 12, 8),
      ellipsoid(x + side * .012, .124, -.004, .0055, .020, .005, 0xa48070, -side * .21, 9, 6),
      ellipsoid(x + side * .007, .116, .0001, .0038, .012, .007, 0xb99b8c, side * .21, 7, 4),
      ellipsoid(x + side * .007, .100, -.013, .009, .01, .012, 0xe1b8a6, 0, 8, 6),
    );
  }
  return join(head, ...ears);
}

function faceRibbon(xMin, xMax, profile, variant, shade, steps = 14) {
  const points = [], faces = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, x = xMin + t * (xMax - xMin);
    const [low, high, depth] = profile(x, t);
    points.push(...facePoint(x, low, depth, variant), ...facePoint(x, high, depth, variant));
    if (i < steps) faces.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
  }
  const surface = new THREE.BufferGeometry();
  surface.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  surface.setIndex(faces);
  surface.computeVertexNormals();
  return tint(surface, shade);
}

export function featuresGeometry(shades, form = 0) {
  const variant = faces[form];
  const features = [
    faceRibbon(-.023,.023, (x,t) => {
      const y = lipY(x), taper = Math.sin(Math.PI * t);
      return [y -.00068 * taper, y + .0006*taper, .0007];
    }, variant, 0x513a31),
  ];
  for (const side of [-1,1]) {
    const nose = side * .0125;
    features.push(faceRibbon(nose - .004, nose + .004, (x, t) => {
      const y = .103 + side * (x - nose) * .21, h = .0015 * Math.sin(Math.PI * t);
      return [y - h, y + h, .0009];
    }, variant, 0x4e342a, 8));
    const cx = side * eyeCentre;
    if (shades) {
      features.push(ellipsoid(cx,.151,.080,.028,.014,.009,0x4c3831,side*.04,16,8));
      features.push(ellipsoid(cx,.151,.083,.026,.012,.009,0x222625,side*.04,16,8));
      features.push(box(.032,.003,.038,side*.066,.157,.062,0x392f2a));
    } else {
      const line = x => .149 + side * (x - cx) * .11;
      const compress = (x,y,z) => [x, line(x) + (y - line(x)) * .03, z];
      const outline = faceRibbon(cx-.017,cx+.017, (x,t) => {
        const arch = Math.sin(Math.PI*t), y = line(x);
        return [y - .0039 * arch, y + .0052 * arch, .0043];
      }, variant, 0x503a30);
      const white = faceRibbon(cx-.0155,cx+.0155, (x,t) => {
        const arch = Math.sin(Math.PI*t), y = line(x);
        return [y - .0029 * arch, y + .0039 * arch, .0051];
      }, variant, 0x716a60);
      const ix = cx - side * .0008;
      const z = facePoint(ix,.149,.0067,variant)[2];
      const irisColours = [0x635941,0x666358,0x8a7257,0x574f3b];
      const iris = ellipsoid(ix,.1496,z,.0046,.0038,.0013,irisColours[form],0,10,6);
      const pupil = ellipsoid(ix,.1495,z+.0011,.0020,.0031,.0006,0x241f1b,0,8,5);
      const catchlight = ellipsoid(ix-.0013,.1507,z+.0017,.00065,.0006,.0002,0xe6d7bb,0,5,3);
      for (const part of [outline, white, iris, pupil, catchlight]) features.push(morphPosition(part, 'blink', compress));
      features.push(faceRibbon(cx-.022,cx+.023, (x,t) => {
        const arch = Math.sin(Math.PI*t);
        const y = .168 + .11 * side * (x-cx) + .003*arch;
        return [y - .0023*arch, y + .0033*arch, .0016];
      }, variant, form === 3 ? 0x72645a : 0x604638));
    }
  }
  if (shades) features.push(box(.026,.003,.009,0,.153,.092,0x49413a));
  return shades ? join(...features) : joinMorph('blink', ...features);
}

export function hairGeometry(form = 0) {
  const variant = faces[form], rows = Array.from({ length: 15 }, (_, i) => [i / 14, 1, 1, 0, .90]);
  return loft(rows, 36, (s, unitX, unitZ, angle, sin, cos, tone) => {
    const forehead = Math.max(0, cos);
    const part = .007 * Math.cos(3 * angle + .58) * forehead;
    const bottom = .113 + (.071 + variant.hairline) * forehead ** .55 + part;
    const y = bottom + (0.258 - bottom) * s;
    const [width, depth, offset] = headSection(y,variant);
    const strands = Math.cos(angle*(form === 3 ? 29 : 15) + y*79 + sin*2.5);
    const silhouette = (.005 + .004 * s + .003 * strands) * Math.sin(s * Math.PI * .88);
    return { x: sin * (width + silhouette + .0016), y: y + s * .007, z: offset + cos * (depth + silhouette + .0015), shade: tone + strands * .12 - (1 - s) * .16 };
  });
}

export function neckGeometry() {
  return loft([
    [.523,.094,.053,-.015,.77],[.555,.089,.051,-.011,.88],[.579,.067,.045,-.012,.94],
    [.60,.053,.043,-.013,.99],[.623,.048,.043,-.014,.95],[.642,.042,.035,-.016,.89],
  ], 16, (y,x,z,angle,sin,cos,shade) => {
    const contour = Math.max(0,cos) * gauss(Math.abs(x), .028, .012) * gauss(y, .59, .034);
    return { x, z: z + contour * .006, shade: shade - contour * .044 };
  });
}

function capBillGeometry() {
  const positions = [], shades = [], indices = [];
  const strips = 16, rows = 6, stride = strips + 1, sheet = stride * (rows + 1);
  for (let face = 0; face < 2; face++) {
    for (let row = 0; row <= rows; row++) {
      const t = row / rows;
      for (let column = 0; column <= strips; column++) {
        const s = column / strips * 2 - 1, edge = s * s;
        const x = s * (.077 + .014 * Math.sin(t * Math.PI)), z = .069 - edge * .021 + t * (.119 - edge * .058);
        const y = .191 - edge * .018 - t * .025 - t * edge * .012 - face * .0055;
        positions.push(x, y, z);
        shades.push(face === 0 ? .99 - t * .07 - edge * .04 : .61);
        if (column === strips || row === rows) continue;
        const a = face * sheet + row * stride + column, b = a + stride;
        if (face === 0) indices.push(a, b, a + 1, b, b + 1, a + 1);
        else indices.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }
  const side = (a, b) => indices.push(a, b, a + sheet, b, b + sheet, a + sheet);
  for (let i = 0; i < strips; i++) {
    side(i + 1, i);
    side(i + rows * stride, i + rows * stride + 1);
  }
  for (let i = 0; i < rows; i++) {
    side(i * stride, (i + 1) * stride);
    side((i + 1) * stride + strips, i * stride + strips);
  }
  const bill = new THREE.BufferGeometry();
  bill.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  bill.setIndex(indices);
  bill.computeVertexNormals();
  return tint(bill, shades);
}

export function hatGeometry(brimmed) {
  const crown = loft([
    [.181,.097,.103,-.012,.72],[.186,.099,.101,-.010,.94],[.205,.094,.098,-.010,.97],
    [.228,.088,.088,-.014,.94],[.252,.070,.072,-.013,.97],[.269,.041,.046,-.014,.99],
    [.276,.007,.008,-.012,.94],
  ], 24, (y, x, z, angle, sin, cos, shade) => ({ x, z, shade: shade - .086 * Math.cos(angle * 3.0) ** 14 }));
  const button = ellipsoid(0,.276,-.011,.012,.004,.01,0xa5a096,0,8,4);
  const band = loft([
    [.178,.096,.102,-.011,.60],[.184,.099,.103,-.012,.73],
    [.192,.099,.103,-.012,.83],[.197,.097,.102,-.012,.77],
  ], 24);
  if (!brimmed) return join(crown, band, capBillGeometry(), button);
  const brim = loft([
    [.172,.098,.103,-.011,.62],[.171,.152,.159,.006,.81],
    [.174,.156,.161,.006,.89],[.181,.154,.158,.006,.95],[.191,.099,.103,-.011,.81],
  ], 24, (y, x, z, angle, sin, cos, shade) => ({
    x, y: y - x * x * .47 - Math.max(0, z - .055) * .11 + cos * .005,
    z, shade: shade - .045 * Math.sin(x * 45 + z * 21),
  }));
  return join(crown, band, brim, button);
}
