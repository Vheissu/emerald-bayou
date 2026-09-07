"""Build the great egret in an isolated Blender scene.

Blender --background --factory-startup --python tools/build-egret.py
Authoring coordinates: metres, Y up, bill toward -Z. Basis stands on the ground.
"""
import bpy
import bmesh
import json
import math
from pathlib import Path
from mathutils import Vector

if not bpy.app.background:
    raise RuntimeError('Use --background; this builder must not replace an open Blender document.')

ROOT = Path(__file__).resolve().parents[1]
SOURCE, EXPORT = ROOT / 'assets/wildlife', ROOT / 'public/wildlife'
EXPORT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
POSES = ['Flight', 'Upstroke', 'Downstroke', 'Probe', 'StepLeft', 'StepRight']
vertices, faces, colors, uvs = [], [], [], []
targets = {name: [] for name in POSES}
WHITE, SHADOW_WHITE, BLACK = (0.89, 0.885, 0.86), (0.82, 0.82, 0.79), (0.047, 0.053, 0.050)
HEAD = Vector((0, 1.005, -0.265))


def clamp(v):
    return min(1, max(0, v))


def linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def rotate_x(p, pivot, angle):
    q = Vector(p) - Vector(pivot)
    c, s = math.cos(angle), math.sin(angle)
    return Vector(pivot) + Vector((q.x, q.y * c - q.z * s, q.y * s + q.z * c))


def rotate_z(p, pivot, angle):
    q = Vector(p) - Vector(pivot)
    c, s = math.cos(angle), math.sin(angle)
    return Vector(pivot) + Vector((q.x * c - q.y * s, q.x * s + q.y * c, q.z))


def folded_wing(p):
    # Closed wing follows shoulder -> rearward elbow -> forward wrist -> rearward primaries.
    side, x = (1 if p[0] > 0 else -1), abs(p[0])
    path = [(0.075, 0.078, 0.650, -0.13), (0.235, 0.112, 0.666, 0.09),
            (0.395, 0.119, 0.630, -0.045), (0.720, 0.069, 0.535, 0.285)]
    for a, b in zip(path, path[1:]):
        if x <= b[0]:
            break
    t = clamp((x - a[0]) / (b[0] - a[0]))
    xx, yy, zz = [a[i] + (b[i] - a[i]) * t for i in (1, 2, 3)]
    chord = p[2] + 0.055
    return Vector((side * (xx + chord * 0.06), yy - chord * 0.21 + (p[1] - 0.65) * 0.30, zz + chord * 0.38))


def pose_vertex(p, zone, pose):
    p = Vector(p)
    if zone.startswith('wing'):
        side = 1 if zone == 'wingR' else -1
        if pose in ('Flight', 'Upstroke', 'Downstroke'):
            if pose == 'Flight':
                return p
            angle = 1.00 if pose == 'Upstroke' else -0.69
            wrist = -0.27 if pose == 'Upstroke' else 0.21
            q = rotate_z(p, (side * 0.4, 0.65, -0.02), side * wrist * clamp((abs(p.x) - 0.37) / 0.13))
            return rotate_z(q, (side * 0.078, 0.65, -0.13), side * angle * clamp((abs(p.x) - 0.075) / 0.09))
        return folded_wing(p)
    if zone == 'head':
        if pose in ('Flight', 'Upstroke', 'Downstroke'):
            return p - HEAD + Vector((0, 0.748, -0.285))
        if pose == 'Probe':
            return rotate_x(p, HEAD, -0.56) - HEAD + Vector((0, 0.185, -0.445))
    if zone.startswith('leg'):
        side = -1 if zone == 'legL' else 1
        if pose in ('Flight', 'Upstroke', 'Downstroke'):
            return rotate_x(p, (side * 0.04, 0.54, 0.015), -1.40)
        if pose == ('StepLeft' if side < 0 else 'StepRight'):
            w = clamp((0.53 - p.y) / 0.47)
            return p + Vector((0, math.sin(w * math.pi * 0.5) * 0.052, -w * 0.072))
    return p


def vertex(p, color=WHITE, uv=(0.5, 0.5), region='body', zone='body', posed=None):
    basis = pose_vertex(p, zone, 'Basis')
    vertices.append(tuple(basis))
    # Albedo carries the fine grain; vertex colours set the white plumage, yellow bill and black feet.
    reference = 0.69 if region == 'horn' else 0.89
    colors.append(tuple(linear(min(1, c / reference)) for c in color) + (1,))
    left, bottom = {'flight': (0, 0.5), 'body': (0.5, 0.5), 'down': (0, 0), 'horn': (0.5, 0)}[region]
    uvs.append((left + 0.008 + uv[0] * 0.484, bottom + 0.008 + uv[1] * 0.484))
    for name in POSES:
        targets[name].append(tuple(posed[name] if posed and name in posed else pose_vertex(p, zone, name)))
    return len(vertices) - 1


def loft(stations, color=WHITE, sides=12, zone='body', region='body', offset_x=0):
    rings = []
    for i, (z, y, rx, ry) in enumerate(stations):
        ring = []
        for j in range(sides):
            a = j * math.tau / sides
            ring.append(vertex((offset_x + math.cos(a) * rx, y + math.sin(a) * ry, z), color,
                               (j / sides, i / max(1, len(stations) - 1)), region, zone))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            faces.append((a[j], b[j], b[(j + 1) % sides], a[(j + 1) % sides]))
    faces.append(tuple(reversed(rings[0])))
    faces.append(tuple(rings[-1]))


def ellipsoid(center, radius, color=WHITE, sides=12, rings=8, zone='body', region='body'):
    stations = []
    for i in range(rings + 1):
        a = math.pi * i / rings
        stations.append((center[2] - math.cos(a) * radius[2], center[1],
                         max(0.00005, math.sin(a) * radius[0]), max(0.00005, math.sin(a) * radius[1])))
    loft(stations, color, sides, zone, region, center[0])


def tube(points, radii, color, zone='body', sides=8, region='horn', pose_paths=None):
    rings = []
    def at(path, i, angle, radius):
        centre = Vector(path[i])
        tangent = (Vector(path[min(i + 1, len(path) - 1)]) - Vector(path[max(0, i - 1)])).normalized()
        across = Vector((1, 0, 0))
        if abs(tangent.dot(across)) > 0.95:
            across = Vector((0, 0, 1))
        across = (across - tangent * tangent.dot(across)).normalized()
        other = tangent.cross(across).normalized()
        return centre + radius * (across * math.cos(angle) + other * math.sin(angle))
    for i in range(len(points)):
        ring = []
        for j in range(sides):
            angle = j * math.tau / sides
            posed = {name: at(path, i, angle, radii[i]) for name, path in (pose_paths or {}).items()}
            ring.append(vertex(at(points, i, angle, radii[i]), color, (j / sides, i / (len(points) - 1)), region, zone, posed))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            faces.append((a[j], b[j], b[(j + 1) % sides], a[(j + 1) % sides]))
    faces.append(tuple(reversed(rings[0])))
    faces.append(tuple(rings[-1]))


def smooth_path(points, radii=None, subdivisions=4):
    result, widths = [], []
    for i in range(len(points) - 1):
        a, b, c, d = [Vector(points[min(len(points) - 1, max(0, j))]) for j in (i - 1, i, i + 1, i + 2)]
        for step in range(subdivisions):
            t = step / subdivisions
            result.append(tuple(0.5 * ((2 * b) + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t
                                      + (-a + 3 * b - 3 * c + d) * t * t * t)))
            if radii:
                widths.append(radii[i] + (radii[i + 1] - radii[i]) * t)
    result.append(points[-1])
    if radii:
        widths.append(radii[-1])
    return (result, widths) if radii else result


def feather(start, end, width, color=WHITE, zone='body', camber=0.003):
    start, end = Vector(start), Vector(end)
    along = end - start
    across = Vector((-along.z, 0, along.x)).normalized() * width
    strips = []
    for t, w in ((0, 0.24), (0.25, 1), (0.70, 0.96), (0.90, 0.72), (0.975, 0.32), (1, 0.025)):
        c = start + along * t
        strips.append([vertex(c - across * w, color, (0.02, 1 - t), 'flight', zone),
                       vertex(c + Vector((0, camber * math.sin(t * math.pi), 0)), color, (0.5, 1 - t), 'flight', zone),
                       vertex(c + across * w, color, (0.98, 1 - t), 'flight', zone)])
    for a, b in zip(strips, strips[1:]):
        faces.append((a[0], a[1], b[1], b[0]))
        faces.append((a[1], a[2], b[2], b[1]))


# Narrow torso with a full breast, rather than a long-necked sphere.
loft([(-0.17, 0.635, 0.045, 0.060), (-0.12, 0.610, 0.076, 0.099),
      (0.0, 0.612, 0.098, 0.100), (0.12, 0.617, 0.073, 0.078), (0.23, 0.60, 0.025, 0.034)], WHITE, 18)
standing_neck = [(0, 0.625, -0.14), (0, 0.695, -0.205), (0, 0.755, -0.224),
                 (0, 0.812, -0.185), (0, 0.861, -0.151), (0, 0.920, -0.163),
                 (0, 0.974, -0.205), (0, 0.999, -0.251)]
flight_neck = [(0, 0.625, -0.14), (0, 0.605, -0.18), (0, 0.608, -0.225),
               (0, 0.633, -0.25), (0, 0.664, -0.238), (0, 0.704, -0.214),
               (0, 0.733, -0.24), (0, 0.745, -0.27)]
probe_neck = [(0, 0.625, -0.14), (0, 0.597, -0.212), (0, 0.548, -0.252),
              (0, 0.483, -0.265), (0, 0.403, -0.297), (0, 0.324, -0.341),
              (0, 0.245, -0.39), (0, 0.190, -0.435)]
standing_neck, neck_widths = smooth_path(standing_neck, [0.046, 0.04, 0.032, 0.025, 0.023, 0.023, 0.024, 0.025])
flight_neck, probe_neck = smooth_path(flight_neck), smooth_path(probe_neck)
tube(standing_neck, neck_widths, WHITE, sides=14, region='down',
     pose_paths={**{name: flight_neck for name in POSES[:3]}, 'Probe': probe_neck})
ellipsoid(HEAD, (0.029, 0.034, 0.066), WHITE, 16, 10, 'head', 'down')
loft([(-0.317, 0.999, 0.015, 0.013), (-0.370, 0.993, 0.013, 0.010),
      (-0.466, 0.985, 0.006, 0.004), (-0.523, 0.981, 0.0005, 0.0007)],
     (0.89, 0.64, 0.13), 8, 'head', 'horn')
# The lower mandible seam, lores and eyes stay attached to the head in every pose.
tube([(0, 0.987, -0.321), (0, 0.983, -0.425), (0, 0.980, -0.515)], [0.0013, 0.0008, 0.0002],
     (0.33, 0.25, 0.065), 'head', sides=5)
for side in (-1, 1):
    ellipsoid((side * 0.024, 1.006, -0.304), (0.0009, 0.005, 0.015), (0.61, 0.65, 0.43), 8, 6, 'head', 'horn')
    ellipsoid((side * 0.026, 1.014, -0.29), (0.0009, 0.0055, 0.0055), (0.70, 0.68, 0.28), 8, 6, 'head', 'horn')
    ellipsoid((side * 0.027, 1.014, -0.291), (0.0006, 0.003, 0.003), (0.016, 0.018, 0.015), 8, 6, 'head', 'horn')
    leg = 'legL' if side < 0 else 'legR'
    # Hock bends backward; each foot has three forward toes and a shorter hind toe, all black.
    tube([(side * 0.04, 0.555, 0.015), (side * 0.044, 0.310, 0.054), (side * 0.045, 0.040, 0.01)],
         [0.011, 0.0085, 0.0055], BLACK, leg)
    ellipsoid((side * 0.044, 0.310, 0.054), (0.010, 0.015, 0.011), BLACK, 8, 6, leg, 'horn')
    for toe in (-1, 0, 1):
        x = side * 0.045
        tube([(x, 0.042, 0.01), (x + toe * 0.027, 0.015, -0.035), (x + toe * 0.046, 0.010, -0.086 + abs(toe) * 0.017)],
             [0.0042, 0.0028, 0.0005], BLACK, leg, sides=6)
    tube([(side * 0.045, 0.03, 0.014), (side * 0.06, 0.011, 0.06), (side * 0.064, 0.010, 0.078)],
         [0.0035, 0.0020, 0.0005], BLACK, leg, sides=6)
    zone = 'wingL' if side < 0 else 'wingR'
    sections = [(0.075, -0.12, 0.13), (0.21, -0.15, 0.16), (0.38, -0.11, 0.15), (0.53, -0.042, 0.14)]
    strips = []
    for x, lead, trail in sections:
        strips.append([vertex((side * x, 0.648, lead), WHITE, (x, 1), 'body', zone),
                       vertex((side * x, 0.664, lead * 0.55 + trail * 0.45), WHITE, (x, 0.5), 'body', zone),
                       vertex((side * x, 0.650, trail), SHADOW_WHITE, (x, 0), 'body', zone),
                       vertex((side * x, 0.638, lead * 0.55 + trail * 0.45), SHADOW_WHITE, (x, 0.5), 'body', zone)])
    for a, b in zip(strips, strips[1:]):
        for j in range(4):
            faces.append((a[j], b[j], b[(j + 1) % 4], a[(j + 1) % 4]))
    faces.append(tuple(reversed(strips[0])))
    faces.append(tuple(strips[-1]))
    for j, (x, z) in enumerate([(0.705, 0.005), (0.710, 0.060), (0.693, 0.112), (0.660, 0.160),
                              (0.620, 0.201), (0.575, 0.234), (0.525, 0.253)]):
        feather((side * (0.45 - j * 0.009), 0.653, -0.03 + j * 0.021),
                (side * x, 0.635 + j * 0.002, z), 0.023, WHITE, zone, 0.002)
    for j in range(11):
        x = 0.12 + j * 0.032
        feather((side * x, 0.659, -0.006), (side * (x + 0.022), 0.641, 0.25 - x * 0.02),
                0.022, WHITE, zone, 0.002)
    for row in range(2):
        for j in range(12):
            x, lead = 0.10 + j * 0.033, -0.107 + row * 0.076
            feather((side * x, 0.672, lead), (side * (x + 0.021), 0.666, lead + 0.12),
                    0.019, WHITE, zone, 0.002)
for j in range(7):
    x = (j - 3) * 0.013
    feather((x * 0.3, 0.63, 0.16), (x, 0.585, 0.32 - abs(x) * 0.45), 0.013, SHADOW_WHITE)
for j in range(5):
    x = (j - 2) * 0.025
    feather((x, 0.705 - abs(x) * 0.3, -0.09), (x * 0.6, 0.665, 0.20), 0.019, WHITE)


def blender(p):
    return (p[0], -p[2], p[1])


mesh = bpy.data.meshes.new('GreatEgretSurface')
mesh.from_pydata([blender(v) for v in vertices], [], faces)
mesh.update()
bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(mesh)
bm.free()
bird = bpy.data.objects.new('GreatEgret', mesh)
scene.collection.objects.link(bird)
bpy.context.view_layer.objects.active = bird
bird.select_set(True)
for poly in mesh.polygons:
    poly.use_smooth = True
mesh.set_sharp_from_angle(angle=math.radians(50))
color = mesh.color_attributes.new(name='Plumage', type='FLOAT_COLOR', domain='POINT')
for datum, rgba in zip(color.data, colors):
    datum.color = rgba
uv_layer = mesh.uv_layers.new(name='PlumageUV')
for loop in mesh.loops:
    uv_layer.data[loop.index].uv = uvs[loop.vertex_index]
material = bpy.data.materials.new('EgretPlumage')
material.use_nodes = True
bsdf = material.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = 0.82
attr = material.node_tree.nodes.new('ShaderNodeVertexColor')
attr.layer_name = 'Plumage'
texture = material.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = bpy.data.images.load(str(SOURCE / 'great-egret-plumage.png'))
texture.image.scale(1024, 1024)
texture.image.pack()
multiply = material.node_tree.nodes.new('ShaderNodeMixRGB')
multiply.blend_type = 'MULTIPLY'
multiply.inputs[0].default_value = 1
material.node_tree.links.new(texture.outputs['Color'], multiply.inputs[1])
material.node_tree.links.new(attr.outputs['Color'], multiply.inputs[2])
material.node_tree.links.new(multiply.outputs[0], bsdf.inputs['Base Color'])
mesh.materials.append(material)
bird.shape_key_add(name='Basis')
for name in POSES:
    key = bird.shape_key_add(name=name, from_mix=False)
    key.value = 0
    for datum, p in zip(key.data, targets[name]):
        datum.co = blender(p)
bird['pose_rig'] = 'Basis standing; Flight, Upstroke, Downstroke with tucked neck and trailing legs; Probe; StepLeft; StepRight.'
bird['reference'] = 'great-egret-reference.png'
reference = bpy.data.objects.new('AnatomyReference', None)
reference.empty_display_type = 'IMAGE'
reference.data = bpy.data.images.load(str(SOURCE / 'great-egret-reference.png'))
reference.data.pack()
reference.empty_display_size = 2.5
reference.location = (0, -1.5, 0.6)
reference.hide_render = True
scene.collection.objects.link(reference)

scene.world = bpy.data.worlds.new('Studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.16, 0.19, 0.20, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.65
for name, location, energy, size in [('Key', (1.2, 2.0, 2.6), 210, 3), ('Fill', (-1.4, -1, 1.4), 85, 2)]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size = energy, 'DISK', size
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (Vector((0, 0, 0.55)) - light.location).to_track_quat('-Z', 'Y').to_euler()
camera_data = bpy.data.cameras.new('AssetCamera')
camera = bpy.data.objects.new('AssetCamera', camera_data)
scene.collection.objects.link(camera)
camera.location = (1.9, 2.3, 1.15)
camera.rotation_euler = (Vector((0, 0.045, 0.53)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type, camera_data.ortho_scale = 'ORTHO', 1.36
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x, scene.render.resolution_y = 1100, 1300
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
scene.render.film_transparent = False
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'great-egret.blend'), compress=True)
bpy.ops.object.select_all(action='DESELECT')
bird.select_set(True)
bpy.context.view_layer.objects.active = bird
bpy.ops.export_scene.gltf(filepath=str(EXPORT / 'great-egret.glb'), export_format='GLB', use_selection=True,
                          export_animations=False, export_morph=True, export_morph_normal=True, export_vertex_color='ACTIVE',
                          export_image_format='JPEG', export_jpeg_quality=85, export_extras=True)
mesh.calc_loop_triangles()
stats = {'vertices': len(mesh.vertices), 'triangles': len(mesh.loop_triangles), 'materials': len(mesh.materials),
         'morphTargets': POSES, 'standingHeightMetres': max(v[1] for v in vertices) - min(v[1] for v in vertices),
         'wingspanMetres': max(v[0] for v in targets['Flight']) - min(v[0] for v in targets['Flight']),
         'glbBytes': (EXPORT / 'great-egret.glb').stat().st_size}
(SOURCE / 'great-egret-stats.json').write_text(json.dumps(stats, indent=2) + '\n')
print(json.dumps(stats))
scene.render.filepath = str(SOURCE / 'great-egret-preview.png')
bpy.ops.render.render(write_still=True)
# A separate flight proof makes folded-neck and extended-leg mistakes visible before in-game integration.
bird.data.shape_keys.key_blocks['Flight'].value = 1
camera.location = (1.3, 2.5, 2.1)
camera.rotation_euler = (Vector((0, 0, 0.65)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.ortho_scale = 1.8
scene.render.resolution_x, scene.render.resolution_y = 1400, 1000
scene.render.filepath = str(SOURCE / 'great-egret-flight-preview.png')
bpy.ops.render.render(write_still=True)
