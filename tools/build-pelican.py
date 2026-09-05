"""Rebuild the brown pelican in an isolated Blender background process.

Blender --background --factory-startup --python tools/build-pelican.py
Authoring coordinates below match the game: metres, Y up, head toward -Z.
"""
import bpy
import bmesh
import json
import math
from pathlib import Path
from mathutils import Vector

if not bpy.app.background:
    raise RuntimeError('Run this builder with --background; it must not replace an open Blender document.')

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/wildlife'
EXPORT = ROOT / 'public/wildlife'
EXPORT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'

vertices, faces, colors, wings, uvs = [], [], [], [], []


def linear(c):
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


def vertex(p, color, wing=0, uv=(0.5, 0.5), region='body'):
    vertices.append(p)
    # Texture supplies the feather grain; vertex colour retains the regional plumage tones.
    reference = 0.75 if region == 'down' else 0.58 if region == 'bill' else 0.5
    colors.append((*linear(tuple(min(1, v / reference) for v in color)), 1))
    wings.append(wing)
    left, bottom = {'flight': (0, 0.5), 'body': (0.5, 0.5), 'down': (0, 0), 'bill': (0.5, 0)}[region]
    uvs.append((left + 0.006 + uv[0] * 0.488, bottom + 0.006 + uv[1] * 0.488))
    return len(vertices) - 1


def tint(c, amount):
    return tuple(min(1, max(0, v * amount)) for v in c)


def loft(stations, color, sides=12, wing=0, region='body'):
    """Elliptic cross-sections: (z, centre-y, radius-x, radius-y)."""
    rings = []
    for ri, (z, y, rx, ry) in enumerate(stations):
        ring = []
        for j in range(sides):
            a = j * math.tau / sides
            shade = 0.90 + 0.10 * math.sin(a) + 0.035 * math.sin(j * 2.4 + ri * 1.7)
            ring.append(vertex((math.cos(a) * rx, y + math.sin(a) * ry, z), tint(color, shade), wing, (j / sides, 1 - ri / max(1, len(stations) - 1)), region))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            faces.append((a[j], b[j], b[(j + 1) % sides], a[(j + 1) % sides]))
    faces.append(tuple(reversed(rings[0])))
    faces.append(tuple(rings[-1]))


def ellipsoid(center, radius, color, sides=12, rings=8, region='body'):
    stations = []
    for i in range(rings + 1):
        a = math.pi * i / rings
        stations.append((center[2] - math.cos(a) * radius[2], center[1], max(0.0001, math.sin(a) * radius[0]), max(0.0001, math.sin(a) * radius[1])))
    before = len(vertices)
    loft(stations, color, sides, region=region)
    if center[0]:
        for j in range(before, len(vertices)):
            x, y, z = vertices[j]
            vertices[j] = (x + center[0], y, z)


def feather(start, end, width, color, wing=0, camber=0.006):
    """Thin cambered vane with a tapered outline and pale edges; no alpha overdraw."""
    s, e = Vector(start), Vector(end)
    along = e - s
    across = Vector((-along.z, 0, along.x)).normalized() * width
    ids = []
    for t, w in ((0, 0.25), (0.28, 1), (0.76, 0.87), (0.94, 0.48), (1, 0.04)):
        centre = s + along * t
        ridge = camber * math.sin(math.pi * t)
        ids.append([
            vertex(tuple(centre - across * w), tint(color, 1.08), wing, (0.02, 1 - t), 'flight'),
            vertex(tuple(centre + Vector((0, ridge, 0))), color, wing, (0.5, 1 - t), 'flight'),
            vertex(tuple(centre + across * w), tint(color, 1.05), wing, (0.98, 1 - t), 'flight'),
        ])
    for a, b in zip(ids, ids[1:]):
        faces.append((a[0], a[1], b[1], b[0]))
        faces.append((a[1], a[2], b[2], b[1]))


back = (0.42, 0.40, 0.36)
flight = (0.22, 0.21, 0.19)
coverts = (0.47, 0.45, 0.41)
# Torso tapers into the tail and shoulders; the neck is retracted against the breast.
loft([(-0.27, 0.025, 0.045, 0.055), (-0.19, 0.005, 0.098, 0.093), (-0.06, 0, 0.125, 0.11), (0.08, 0.007, 0.112, 0.096), (0.23, 0.018, 0.068, 0.057), (0.31, 0.022, 0.023, 0.025)], back, 20)
loft([(-0.18, 0.055, 0.062, 0.058), (-0.215, 0.10, 0.058, 0.067), (-0.26, 0.17, 0.042, 0.047), (-0.30, 0.20, 0.033, 0.038)], (0.67, 0.65, 0.58), 14)
ellipsoid((0, 0.215, -0.335), (0.052, 0.055, 0.092), (0.78, 0.73, 0.56), 16, 10, 'down')
# Long upper mandible and the folded gular pouch are different volumes.
loft([(-0.405, 0.206, 0.025, 0.015), (-0.47, 0.199, 0.025, 0.012), (-0.64, 0.185, 0.016, 0.009), (-0.78, 0.167, 0.003, 0.006), (-0.795, 0.159, 0.002, 0.005)], (0.61, 0.56, 0.45), 8, region='bill')
loft([(-0.405, 0.174, 0.025, 0.026), (-0.46, 0.15, 0.028, 0.035), (-0.58, 0.154, 0.02, 0.022), (-0.70, 0.158, 0.009, 0.010), (-0.78, 0.162, 0.001, 0.002)], (0.31, 0.32, 0.27), 10, region='bill')
for side in (-1, 1):
    ellipsoid((side * 0.048, 0.229, -0.369), (0.0035, 0.012, 0.013), (0.35, 0.31, 0.28), 8, 6)
    ellipsoid((side * 0.051, 0.230, -0.37), (0.0025, 0.0065, 0.0075), (0.73, 0.73, 0.62), 8, 6)
    ellipsoid((side * 0.053, 0.230, -0.371), (0.0015, 0.0038, 0.0045), (0.045, 0.041, 0.035), 8, 6)
    # Closed wing sections give the leading edge depth and a shallow bowed profile.
    sections = [(0.082, 0.036, -0.14, 0.17), (0.22, 0.045, -0.20, 0.16), (0.43, 0.026, -0.19, 0.14), (0.64, -0.005, -0.10, 0.11), (0.78, -0.017, -0.015, 0.12)]
    strips = []
    for x, y, lead, trail in sections:
        strips.append([
            vertex((side * x, y, lead), tint(coverts, 0.91), side, (x, 1)),
            vertex((side * x, y + 0.014, lead * 0.6 + trail * 0.4), coverts, side, (x, 0.6)),
            vertex((side * x, y, trail), flight, side, (x, 0)),
            vertex((side * x, y - 0.009, lead * 0.6 + trail * 0.4), tint(flight, 1.2), side, (x, 0.6)),
        ])
    for a, b in zip(strips, strips[1:]):
        for j in range(4):
            face = (a[j], b[j], b[(j + 1) % 4], a[(j + 1) % 4])
            faces.append(face if side == 1 else tuple(reversed(face)))
    faces.append(tuple(reversed(strips[0])))
    faces.append(tuple(strips[-1]))
    def wing_surface(x, z):
        a, b = sections[0], sections[1]
        for a, b in zip(sections, sections[1:]):
            if x <= b[0]:
                break
        t = min(1, max(0, (x - a[0]) / (b[0] - a[0])))
        y, lead, trail = [a[k] + (b[k] - a[k]) * t for k in (1, 2, 3)]
        chord = min(1, max(0, (z - lead) / (trail - lead)))
        return y + 0.014 * math.sin(math.pi * chord) + 0.003
    # Outer primary feathers fan sideways, with clear gaps at their tapered tips.
    for j, (x, z) in enumerate([(1.03, 0.012), (1.025, 0.075), (1.00, 0.14), (0.955, 0.205), (0.90, 0.263), (0.83, 0.305), (0.75, 0.322)]):
        feather((side * (0.67 - j * 0.011), 0.001, -0.035 + j * 0.027), (side * x, -0.024 + j * 0.004, z), 0.030 + j * 0.001, tint(flight, 0.98 + j * 0.015), side, 0.002)
    # Overlapping secondaries and three rows of shorter coverts.
    for j in range(13):
        x = 0.14 + j * 0.04
        y = wing_surface(x, -0.015)
        feather((side * x, y, -0.015), (side * (x + 0.032), y - 0.018, 0.30 - 0.048 * x), 0.027, tint(flight, 1.0 + 0.045 * math.sin(j * 2)), side, 0.002)
    for row in range(3):
        for j in range(16):
            x = 0.13 + j * 0.036
            lead = -0.15 + max(0, x - 0.42) * 0.32 + row * 0.075
            y = wing_surface(x, lead) + 0.004
            end_y = max(wing_surface(x + 0.025, lead + 0.13), y - 0.008) + 0.002
            feather((side * x, y, lead), (side * (x + 0.025), end_y, lead + 0.13), 0.021, tint(coverts, 0.94 + 0.085 * math.sin(j * 2.1 + row)), side, 0.0015)
    # Feet tuck back beside the rump, with a small webbed paddle silhouette.
    feather((side * 0.055, -0.073, 0.19), (side * 0.074, -0.070, 0.35), 0.022, (0.24, 0.25, 0.23), camber=0.003)
for j in range(9):
    x = (j - 4) * 0.021
    feather((x * 0.42, 0.026, 0.22), (x, 0.017, 0.415 - abs(x) * 0.45), 0.017, tint(back, 0.90 + j * 0.015))
# Scapular feathering joins the shoulders to the rump without a bare sphere.
for j in range(7):
    x = (j - 3) * 0.026
    feather((x, 0.108 - abs(x) * 0.3, -0.10), (x * 0.62, 0.075, 0.25), 0.020, tint(coverts, 0.88 + j * 0.015), camber=0.004)

def blender(p):
    return (p[0], -p[2], p[1])


mesh = bpy.data.meshes.new('BrownPelicanSurface')
mesh.from_pydata([blender(v) for v in vertices], [], faces)
mesh.update()
bm = bmesh.new()
bm.from_mesh(mesh)
bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
bm.to_mesh(mesh)
bm.free()
bird = bpy.data.objects.new('BrownPelican', mesh)
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
material = bpy.data.materials.new('PelicanPlumage')
material.use_nodes = True
bsdf = material.node_tree.nodes.get('Principled BSDF')
bsdf.inputs['Roughness'].default_value = 0.87
attr = material.node_tree.nodes.new('ShaderNodeVertexColor')
attr.layer_name = 'Plumage'
texture = material.node_tree.nodes.new('ShaderNodeTexImage')
texture.image = bpy.data.images.load(str(SOURCE / 'brown-pelican-plumage.png'))
texture.image.scale(1024, 1024)
texture.image.pack()
multiply = material.node_tree.nodes.new('ShaderNodeMixRGB')
multiply.blend_type = 'MULTIPLY'
multiply.inputs[0].default_value = 1
material.node_tree.links.new(texture.outputs['Color'], multiply.inputs[1])
material.node_tree.links.new(attr.outputs['Color'], multiply.inputs[2])
material.node_tree.links.new(multiply.outputs[0], bsdf.inputs['Base Color'])
mesh.materials.append(material)


def rotated(p, pivot, angle):
    x, y, z = p
    dx, dy = x - pivot[0], y - pivot[1]
    c, s = math.cos(angle), math.sin(angle)
    return (pivot[0] + c * dx - s * dy, pivot[1] + s * dx + c * dy, z)


bird.shape_key_add(name='Basis')
for name, shoulder, wrist in [('Upstroke', 0.80, -0.30), ('Downstroke', -0.62, 0.24), ('Dive', -0.90, -0.58)]:
    key = bird.shape_key_add(name=name, from_mix=False)
    key.value = 0
    for i, (p, side) in enumerate(zip(vertices, wings)):
        if not side:
            continue
        # Wrist rotates first, then follows the shoulder; root vertices blend into the torso.
        weight = min(1, max(0, (abs(p[0]) - 0.52) / 0.14))
        q = rotated(p, (side * 0.57, 0.005), side * wrist * weight)
        weight = min(1, max(0, (abs(p[0]) - 0.085) / 0.15))
        q = rotated(q, (side * 0.095, 0.035), side * shoulder * weight)
        if name == 'Dive':
            q = (q[0], q[1], q[2] + max(0, abs(p[0]) - 0.15) * 0.46)
        key.data[i].co = blender(q)
bird['flight_pose_rig'] = 'Basis glide; Upstroke; Downstroke; Dive. Wings only. Morph normals exported.'
bird['reference'] = 'brown-pelican-reference.png'
bird['wingspan_metres'] = 2.06

# Reference remains editable in Blender but is not rendered or exported to the game.
reference = bpy.data.objects.new('AnatomyReference', None)
reference.empty_display_type = 'IMAGE'
reference.data = bpy.data.images.load(str(SOURCE / 'brown-pelican-reference.png'))
reference.data.pack()
reference.empty_display_size = 3
reference.location = (0, 1.8, 0)
reference.hide_render = True
scene.collection.objects.link(reference)

scene.world = bpy.data.worlds.new('Studio')
scene.world.use_nodes = True
scene.world.node_tree.nodes['Background'].inputs[0].default_value = (0.17, 0.19, 0.21, 1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value = 0.6
for name, location, energy, size in [('Key', (1.0, 2.2, 3.2), 260, 4), ('Fill', (-2, -0.5, 1.4), 120, 3)]:
    data = bpy.data.lights.new(name, 'AREA')
    data.energy, data.shape, data.size = energy, 'DISK', size
    light = bpy.data.objects.new(name, data)
    scene.collection.objects.link(light)
    light.location = location
    light.rotation_euler = (Vector((0, 0, 0)) - light.location).to_track_quat('-Z', 'Y').to_euler()
camera_data = bpy.data.cameras.new('AssetCamera')
camera = bpy.data.objects.new('AssetCamera', camera_data)
scene.collection.objects.link(camera)
camera.location = (0.8, 2.4, 2.8)
camera.rotation_euler = (Vector((0, 0.12, 0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera_data.type, camera_data.ortho_scale = 'ORTHO', 2.5
scene.camera = camera
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x, scene.render.resolution_y = 1400, 1000
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'AgX'
scene.render.film_transparent = False

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE / 'brown-pelican.blend'), compress=True)
bpy.ops.object.select_all(action='DESELECT')
bird.select_set(True)
bpy.context.view_layer.objects.active = bird
bpy.ops.export_scene.gltf(filepath=str(EXPORT / 'brown-pelican.glb'), export_format='GLB', use_selection=True, export_animations=False, export_morph=True, export_morph_normal=True, export_vertex_color='ACTIVE', export_image_format='JPEG', export_jpeg_quality=85, export_extras=True)
mesh.calc_loop_triangles()
stats = {'vertices': len(mesh.vertices), 'triangles': len(mesh.loop_triangles), 'materials': len(mesh.materials), 'morphTargets': [key.name for key in mesh.shape_keys.key_blocks][1:], 'wingspanMetres': max(v[0] for v in vertices) - min(v[0] for v in vertices), 'glbBytes': (EXPORT / 'brown-pelican.glb').stat().st_size}
(SOURCE / 'brown-pelican-stats.json').write_text(json.dumps(stats, indent=2) + '\n')
print(json.dumps(stats))
scene.render.filepath = str(SOURCE / 'brown-pelican-preview.png')
bpy.ops.render.render(write_still=True)
