"""Generates the Blender source files of the weapon models and the mushroom cloud.

Every model lives in its own editable file `blender/models/<name>.blend`. Those files are the
source of truth: edit them in Blender and export them with `blender/export_models.py`. This script
only creates files that do not exist yet, so manual edits are never overwritten. Run headless from
the project root:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python blender/build_weapons.py -- --models-dir blender/models

``--rebuild <name> ...`` (or ``--rebuild all``) regenerates existing files on purpose and replaces
any manual edits in them; Blender keeps the previous version as `<name>.blend1`.

Conventions: metres, Blender +Y is the barrel direction, +Z is up. Moving parts are separate
objects (pump, top cover) so the game can animate them; empties mark the muzzle and the ports.
"""

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

# --------------------------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------------------------

MATERIALS = {
    # name: (base colour, metallic, roughness)
    "Gunmetal": ((0.09, 0.09, 0.1), 0.5, 0.45),
    "Steel": ((0.17, 0.17, 0.18), 0.35, 0.55),
    "Dark": ((0.02, 0.02, 0.02), 0.0, 0.8),
    "Wood": ((0.45, 0.23, 0.1), 0.0, 0.6),
    "Rubber": ((0.03, 0.03, 0.03), 0.0, 0.85),
    "Bakelite": ((0.13, 0.06, 0.04), 0.0, 0.45),
    "Brass": ((0.8, 0.58, 0.22), 0.8, 0.3),
    "AgedBrass": ((0.42, 0.3, 0.12), 0.7, 0.45),
    "ShellRed": ((0.72, 0.07, 0.05), 0.0, 0.4),
    "Sand": ((0.36, 0.31, 0.19), 0.1, 0.7),
    "PaintWhite": ((0.78, 0.8, 0.82), 0.1, 0.35),
    "Olive": ((0.22, 0.25, 0.1), 0.1, 0.6),
    "Yellow": ((0.85, 0.65, 0.05), 0.0, 0.5),
    "Smoke": ((0.3, 0.27, 0.25), 0.0, 1.0),
    # Names starting with "Glow" are rendered unlit and emissive by the game.
    "GlowCyan": ((0.2, 0.95, 1.0), 0.0, 0.2),
    "GlowRed": ((1.0, 0.12, 0.08), 0.0, 0.3),
    "GlowGreen": ((0.35, 1.0, 0.3), 0.0, 0.3),
    "Glove": ((0.33, 0.25, 0.15), 0.0, 0.8),
    "Sleeve": ((0.17, 0.19, 0.1), 0.0, 0.95),
}


def create_materials():
    materials = {}
    for name, (color, metallic, roughness) in MATERIALS.items():
        material = bpy.data.materials.new(name)
        material.diffuse_color = (*color, 1.0)
        material.metallic = metallic
        material.roughness = roughness
        if material.node_tree is None:
            material.use_nodes = True
        principled = material.node_tree.nodes.get("Principled BSDF")
        if principled:
            principled.inputs["Base Color"].default_value = (*color, 1.0)
            principled.inputs["Metallic"].default_value = metallic
            principled.inputs["Roughness"].default_value = roughness
            if name.startswith("Glow"):
                principled.inputs["Emission Color"].default_value = (*color, 1.0)
                principled.inputs["Emission Strength"].default_value = 3.0
        materials[name] = material
    return materials


# --------------------------------------------------------------------------------------------
# Geometry helpers — every helper returns a new object with one material.
# --------------------------------------------------------------------------------------------


def object_from_bmesh(name, bm, material, smooth=False):
    mesh = bpy.data.meshes.new(name)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for face in bm.faces:
        face.smooth = smooth
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def box(name, size, location, material):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(location), verts=bm.verts)
    return object_from_bmesh(name, bm, material)


def cylinder_y(name, radius, start_y, end_y, x, z, material, segments=16, radius_end=None, scale_x=1.0):
    """Cylinder (or cone) whose axis runs along +Y from start_y to end_y."""
    bm = bmesh.new()
    depth = end_y - start_y
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=segments,
        radius1=radius,
        radius2=radius if radius_end is None else radius_end,
        depth=depth,
    )
    # create_cone builds along Z, centred on the origin: turn it onto the Y axis.
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-math.pi / 2, 3, "X"))
    bmesh.ops.scale(bm, vec=(scale_x, 1, 1), verts=bm.verts)
    bmesh.ops.translate(bm, vec=(x, start_y + depth / 2, z), verts=bm.verts)
    obj = object_from_bmesh(name, bm, material, smooth=True)
    # Caps stay flat so the ends read crisp.
    for polygon in obj.data.polygons:
        if abs(polygon.normal.y) > 0.9:
            polygon.use_smooth = False
    return obj


def cylinder_x(name, radius, length, location, material, segments=12):
    """Cylinder whose axis runs along X, centred on location."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=length)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
    bmesh.ops.translate(bm, vec=Vector(location), verts=bm.verts)
    return object_from_bmesh(name, bm, material, smooth=True)


def sphere(name, radius, location, material):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=6, radius=radius)
    bmesh.ops.translate(bm, vec=Vector(location), verts=bm.verts)
    return object_from_bmesh(name, bm, material, smooth=True)


def profile(name, points, width, material, x=0.0):
    """Prism from a side-view outline: points are (y, z) pairs, extruded symmetrically along X."""
    bm = bmesh.new()
    half = width / 2
    left = [bm.verts.new((x - half, y, z)) for y, z in points]
    right = [bm.verts.new((x + half, y, z)) for y, z in points]
    bm.faces.new(left)
    bm.faces.new(list(reversed(right)))
    count = len(points)
    for i in range(count):
        j = (i + 1) % count
        bm.faces.new((left[i], left[j], right[j], right[i]))
    return object_from_bmesh(name, bm, material)


def torus(name, major, minor, location, material, axis="Z", major_segments=24, minor_segments=8):
    bm = bmesh.new()
    rings = []
    for i in range(major_segments):
        a = 2 * math.pi * i / major_segments
        ring = []
        for j in range(minor_segments):
            b = 2 * math.pi * j / minor_segments
            radius = major + minor * math.cos(b)
            ring.append(bm.verts.new((radius * math.cos(a), radius * math.sin(a), minor * math.sin(b))))
        rings.append(ring)
    for i in range(major_segments):
        for j in range(minor_segments):
            n_i = (i + 1) % major_segments
            n_j = (j + 1) % minor_segments
            bm.faces.new((rings[i][j], rings[n_i][j], rings[n_i][n_j], rings[i][n_j]))
    if axis == "X":
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
    elif axis == "Y":
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    bmesh.ops.translate(bm, vec=Vector(location), verts=bm.verts)
    return object_from_bmesh(name, bm, material, smooth=True)


def handwheel(name, radius, location, material, axis="X"):
    parts = [torus(f"{name}_rim", radius, radius * 0.08, location, material, axis=axis, minor_segments=6)]
    for i in range(3):
        spoke = box(f"{name}_spoke_{i}", (radius * 0.08, radius * 2, radius * 0.08), (0, 0, 0), material)
        rotation_axis = {"X": "X", "Y": "Y", "Z": "Z"}[axis]
        spoke.data.transform(Matrix.Rotation(i * math.pi / 3, 4, rotation_axis))
        if axis == "Y":
            spoke.data.transform(Matrix.Rotation(math.pi / 2, 4, "Y"))
        spoke.location = location
        parts.append(spoke)
    return parts


def cloud_blob(name, radius, scale, location, material, roughness=0.25, seed=0.0, subdivisions=4):
    """Icosphere pushed in and out with noise — reads as a billowing cloud."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    offset = Vector((seed, seed * 1.7, seed * 2.3))
    for vert in bm.verts:
        direction = vert.co.normalized()
        bump = noise.noise(direction * 2.5 + offset) * 0.6 + noise.noise(direction * 6.0 + offset) * 0.4
        vert.co += direction * bump * roughness * radius
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(location), verts=bm.verts)
    return object_from_bmesh(name, bm, material, smooth=True)


def cylinder_between(name, start, end, radius, material, segments=10, radius_end=None):
    """Cylinder (or cone) from point start to point end."""
    start, end = Vector(start), Vector(end)
    axis = end - start
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        segments=segments,
        radius1=radius,
        radius2=radius if radius_end is None else radius_end,
        depth=axis.length,
    )
    rotation = Vector((0, 0, 1)).rotation_difference(axis.normalized()).to_matrix()
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=rotation)
    bmesh.ops.translate(bm, vec=(start + end) / 2, verts=bm.verts)
    return object_from_bmesh(name, bm, material, smooth=True)


def oriented_box(name, size, center, axes, material):
    """Box of `size` along the three unit vectors `axes`, centred on `center`."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    basis = Matrix((axes[0], axes[1], axes[2])).transposed().to_4x4()
    bmesh.ops.transform(bm, matrix=basis, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return object_from_bmesh(name, bm, material)


def build_hand(m, name, palm, forward, back, index_side, elbow, curl=(0.6, 1.6, 2.4), thumb_curl=0.8):
    """
    Gloved hand with forearm and sleeve, wrapped around something on the palm side.

    palm: centre of the palm · forward: direction of the straight fingers · back: back-of-hand normal ·
    index_side: +1/-1, at which end of forward × back the index finger sits · elbow: offset of the
    elbow from the wrist · curl: bend of the three finger joints in radians, relative to forward.
    """
    f = Vector(forward).normalized()
    u = Vector(back)
    u = (u - f * u.dot(f)).normalized()
    s = f.cross(u).normalized()
    palm = Vector(palm)
    glove = m["Glove"]
    parts = [oriented_box(f"{name}_palm", (0.08, 0.085, 0.03), palm, (s, f, u), glove)]

    lengths = (0.04, 0.026, 0.021)
    for i, factor in enumerate((0.95, 1.0, 0.95, 0.8)):
        point = palm + f * 0.04 + s * (1.5 - i) * 0.021 * index_side
        for j, (length, bend) in enumerate(zip(lengths, curl)):
            direction = f * math.cos(bend) - u * math.sin(bend)
            tip = point + direction * length * factor
            radius = 0.0095 - j * 0.0009
            parts.append(cylinder_between(f"{name}_finger_{i}_{j}", point, tip, radius, glove, segments=8))
            parts.append(sphere(f"{name}_joint_{i}_{j}", radius, tip, glove))
            point = tip

    thumb_base = palm - f * 0.015 + s * index_side * 0.045 - u * 0.01
    first = (f * 0.55 + s * index_side * 0.25 - u * thumb_curl).normalized()
    thumb_middle = thumb_base + first * 0.036
    second = (f * 0.85 - u * thumb_curl * 0.6).normalized()
    thumb_tip = thumb_middle + second * 0.03
    parts.append(cylinder_between(f"{name}_thumb_0", thumb_base, thumb_middle, 0.011, glove, segments=8))
    parts.append(sphere(f"{name}_thumb_joint", 0.011, thumb_middle, glove))
    parts.append(cylinder_between(f"{name}_thumb_1", thumb_middle, thumb_tip, 0.0095, glove, segments=8))
    parts.append(sphere(f"{name}_thumb_tip", 0.0095, thumb_tip, glove))

    wrist = palm - f * 0.06
    elbow_point = wrist + Vector(elbow)
    along_arm = (elbow_point - wrist).normalized()
    parts.append(cylinder_between(f"{name}_wrist", palm - f * 0.03, wrist, 0.03, glove, segments=12, radius_end=0.029))
    parts.append(cylinder_between(f"{name}_cuff", wrist, wrist + along_arm * 0.04, 0.034, m["Dark"], segments=12))
    parts.append(cylinder_between(f"{name}_sleeve", wrist + along_arm * 0.035, elbow_point, 0.037, m["Sleeve"], segments=12, radius_end=0.05))
    return join(name, parts)


def roughen(obj, amount, seed=0.0):
    """Pushes every vertex along its normal by noise, so smooth primitives read as smoke."""
    offset = Vector((seed, seed * 1.3, seed * 2.1))
    for vert in obj.data.vertices:
        bump = noise.noise(vert.co * 3.0 + offset) * 0.6 + noise.noise(vert.co * 7.0 + offset) * 0.4
        vert.co += vert.normal * bump * amount


def add_bevel(obj, width=0.0025, segments=2):
    bevel = obj.modifiers.new("Bevel", "BEVEL")
    bevel.width = width
    bevel.segments = segments
    bevel.limit_method = "ANGLE"
    bevel.angle_limit = math.radians(35)


def join(name, objects):
    # Joining keeps only the active object's modifiers, so bake every part's modifiers first.
    for obj in objects:
        apply_modifiers(obj)
    target = objects[0]
    with bpy.context.temp_override(
        active_object=target,
        object=target,
        selected_objects=objects,
        selected_editable_objects=objects,
    ):
        bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def apply_modifiers(obj):
    with bpy.context.temp_override(active_object=obj, object=obj):
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)


def set_origin(obj, origin):
    """Moves the object's origin to `origin` without moving its geometry (pivot for animation)."""
    offset = Vector(origin)
    obj.data.transform(Matrix.Translation(-offset))
    obj.location = offset


def empty(name, location):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = "PLAIN_AXES"
    obj.empty_display_size = 0.02
    obj.location = location
    bpy.context.collection.objects.link(obj)
    return obj


def new_collection(name):
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    layer_collection = bpy.context.view_layer.layer_collection.children[name]
    bpy.context.view_layer.active_layer_collection = layer_collection
    return collection


# --------------------------------------------------------------------------------------------
# Pump-action shotgun
# --------------------------------------------------------------------------------------------


def build_shotgun(m):
    new_collection("Shotgun")
    parts = []

    receiver = profile(
        "receiver",
        [(0, 0), (0.2, 0), (0.2, 0.06), (0.188, 0.068), (0.02, 0.068), (0, 0.058)],
        0.045,
        m["Gunmetal"],
    )
    add_bevel(receiver)
    parts.append(receiver)
    parts.append(box("ejection_port", (0.004, 0.07, 0.022), (0.0225, 0.11, 0.045), m["Dark"]))
    parts.append(box("loading_port", (0.03, 0.1, 0.004), (0, 0.12, 0.0005), m["Dark"]))

    parts.append(cylinder_y("barrel", 0.0115, 0.2, 0.7, 0, 0.05, m["Steel"]))
    parts.append(cylinder_y("muzzle_ring", 0.013, 0.69, 0.705, 0, 0.05, m["Gunmetal"]))
    parts.append(box("vent_rib", (0.008, 0.48, 0.004), (0, 0.45, 0.0635), m["Steel"]))
    parts.append(sphere("bead", 0.003, (0, 0.69, 0.068), m["Brass"]))

    parts.append(cylinder_y("magazine_tube", 0.0105, 0.2, 0.62, 0, 0.022, m["Steel"]))
    parts.append(cylinder_y("magazine_cap", 0.0125, 0.62, 0.64, 0, 0.022, m["Gunmetal"]))
    clamp = profile("barrel_clamp", [(0.585, 0.012), (0.605, 0.012), (0.605, 0.06), (0.585, 0.06)], 0.02, m["Gunmetal"])
    parts.append(clamp)

    parts.append(box("guard_bottom", (0.012, 0.075, 0.005), (0, 0.06, -0.03), m["Gunmetal"]))
    parts.append(box("guard_front", (0.012, 0.005, 0.032), (0, 0.095, -0.015), m["Gunmetal"]))
    parts.append(box("guard_rear", (0.012, 0.005, 0.032), (0, 0.025, -0.015), m["Gunmetal"]))
    parts.append(profile("trigger", [(0.055, 0), (0.062, 0), (0.058, -0.02), (0.05, -0.024)], 0.006, m["Dark"]))

    stock = profile(
        "stock",
        [
            (0.0, 0.058),
            (-0.36, 0.03),
            (-0.37, 0.025),
            (-0.37, -0.11),
            (-0.355, -0.115),
            (-0.07, -0.035),
            (-0.02, -0.01),
            (0.0, 0.0),
        ],
        0.04,
        m["Wood"],
    )
    add_bevel(stock, width=0.004, segments=3)
    parts.append(stock)
    butt_pad = profile(
        "butt_pad", [(-0.37, 0.026), (-0.385, 0.024), (-0.385, -0.114), (-0.37, -0.112)], 0.042, m["Rubber"]
    )
    parts.append(butt_pad)

    body = join("Shotgun_Body", parts)

    pump_parts = [cylinder_y("pump", 0.022, 0.28, 0.45, 0, 0.025, m["Wood"], segments=12, scale_x=0.85)]
    for i in range(4):
        y = 0.305 + i * 0.035
        pump_parts.append(cylinder_y(f"pump_groove_{i}", 0.0225, y, y + 0.006, 0, 0.025, m["Dark"], segments=12, scale_x=0.86))
    pump = join("Shotgun_Pump", pump_parts)
    set_origin(pump, (0, 0.365, 0.025))

    shell = join(
        "Shotgun_Shell",
        [
            cylinder_y("shell_hull", 0.0095, 0.0, 0.055, 0, 0, m["ShellRed"], segments=12),
            cylinder_y("shell_base", 0.0099, -0.012, 0.0, 0, 0, m["Brass"], segments=12),
        ],
    )
    set_origin(shell, (0, 0.02, 0))
    shell.location = (0.06, 0.12, -0.04)

    hands = [
        build_hand(m, "Shotgun_HandRight", (0.034, -0.035, 0.035), (0, 0.25, -1), (1, 0, 0.2), -1, (0.06, -0.2, -0.26)),
        build_hand(m, "Shotgun_HandLeft", (-0.03, 0.365, -0.012), (1, 0, 0), (0, 0, -1), 1, (-0.1, -0.35, -0.26)),
    ]

    markers = [
        empty("Shotgun_Muzzle", (0, 0.71, 0.05)),
        empty("Shotgun_LoadPort", (0, 0.13, -0.004)),
        empty("Shotgun_EjectPort", (0.026, 0.11, 0.045)),
    ]
    return [body, pump, shell, *hands, *markers]


# --------------------------------------------------------------------------------------------
# MG 42
# --------------------------------------------------------------------------------------------


def build_mg42(m):
    new_collection("MG42")
    parts = []

    receiver = profile(
        "receiver", [(0, -0.02), (0.32, -0.02), (0.32, 0.055), (0.0, 0.055)], 0.05, m["Gunmetal"]
    )
    add_bevel(receiver)
    parts.append(receiver)

    stock = profile(
        "stock",
        [
            (0.0, 0.045),
            (-0.05, 0.04),
            (-0.33, 0.004),
            (-0.345, -0.002),
            (-0.345, -0.115),
            (-0.325, -0.12),
            (-0.12, -0.046),
            (-0.03, -0.02),
            (0.0, -0.02),
        ],
        0.04,
        m["Bakelite"],
    )
    add_bevel(stock, width=0.004, segments=3)
    parts.append(stock)

    grip = profile(
        "grip",
        [(0.06, -0.02), (0.115, -0.02), (0.1, -0.125), (0.072, -0.13), (0.058, -0.118), (0.075, -0.03)],
        0.032,
        m["Bakelite"],
    )
    add_bevel(grip, width=0.004)
    parts.append(grip)
    parts.append(box("guard_bottom", (0.012, 0.07, 0.005), (0, 0.155, -0.05), m["Gunmetal"]))
    parts.append(box("guard_front", (0.012, 0.005, 0.03), (0, 0.19, -0.035), m["Gunmetal"]))
    parts.append(profile("trigger", [(0.15, -0.02), (0.158, -0.02), (0.153, -0.04), (0.145, -0.043)], 0.006, m["Dark"]))

    parts.append(cylinder_x("cocking_knob", 0.008, 0.02, (0.034, 0.24, 0.025), m["Steel"]))
    parts.append(box("cocking_slot", (0.002, 0.12, 0.008), (0.0255, 0.2, 0.025), m["Dark"]))
    parts.append(box("feed_tray", (0.004, 0.06, 0.03), (-0.0265, 0.22, 0.04), m["Dark"]))
    parts.append(box("ejection_port", (0.03, 0.05, 0.003), (0, 0.2, -0.0215), m["Dark"]))

    # Barrel jacket with the characteristic oval cooling holes.
    jacket = profile("jacket", [(0.32, 0.0), (0.72, 0.0), (0.72, 0.05), (0.32, 0.05)], 0.045, m["Steel"])
    cutters = []
    for i in range(6):
        y = 0.36 + i * 0.058
        side = cylinder_x(f"side_hole_{i}", 0.012, 0.1, (0, 0, 0), m["Dark"], segments=12)
        side.data.transform(Matrix.Diagonal((1, 1.7, 1, 1)))
        side.location = (0, y, 0.025)
        cutters.append(side)
    for i in range(5):
        y = 0.39 + i * 0.065
        top = cylinder_y(f"top_hole_{i}", 0.007, 0, 0.001, 0, 0, m["Dark"], segments=10)
        top.data.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
        top.scale = (1, 1, 60)
        top.location = (0, y, 0.05)
        cutters.append(top)
    for cutter in cutters:
        boolean = jacket.modifiers.new(f"cut_{cutter.name}", "BOOLEAN")
        boolean.operation = "DIFFERENCE"
        boolean.object = cutter
    apply_modifiers(jacket)
    for cutter in cutters:
        bpy.data.objects.remove(cutter, do_unlink=True)
    parts.append(jacket)

    parts.append(cylinder_y("barrel", 0.009, 0.3, 0.78, 0, 0.025, m["Dark"]))
    parts.append(cylinder_y("muzzle_booster", 0.017, 0.72, 0.8, 0, 0.025, m["Gunmetal"], radius_end=0.021))
    parts.append(cylinder_y("muzzle_cap", 0.021, 0.8, 0.808, 0, 0.025, m["Dark"]))
    parts.append(box("front_sight", (0.004, 0.006, 0.03), (0, 0.7, 0.065), m["Gunmetal"]))
    parts.append(box("barrel_latch", (0.006, 0.04, 0.02), (0.026, 0.33, 0.025), m["Gunmetal"]))
    for side in (-1, 1):
        parts.append(cylinder_y(f"bipod_leg_{side}", 0.004, 0.42, 0.7, side * 0.012, -0.008, m["Steel"], segments=8))

    body = join("MG42_Body", parts)

    cover = join(
        "MG42_Cover",
        [
            profile(
                "cover",
                [(0.06, 0.055), (0.32, 0.055), (0.32, 0.075), (0.3, 0.085), (0.08, 0.085), (0.06, 0.075)],
                0.054,
                m["Gunmetal"],
            ),
            box("rear_sight", (0.012, 0.02, 0.012), (0, 0.11, 0.09), m["Steel"]),
        ],
    )
    add_bevel(cover)
    set_origin(cover, (0, 0.32, 0.07))

    belt_parts = []
    for i in range(9):
        t = i / 8
        x = -0.04 - i * 0.014
        z = 0.04 - (t * t) * 0.09
        belt_parts.append(cylinder_y(f"round_{i}", 0.0055, 0.19, 0.25, x, z, m["Brass"], segments=8))
        belt_parts.append(cylinder_y(f"bullet_{i}", 0.0055, 0.25, 0.27, x, z, m["Brass"], segments=8, radius_end=0.0015))
        belt_parts.append(box(f"link_{i}", (0.01, 0.03, 0.013), (x, 0.215, z), m["Dark"]))
    belt = join("MG42_Belt", belt_parts)

    hands = [
        build_hand(m, "MG42_HandRight", (0.024, 0.055, -0.07), (0, 1, 0), (1, 0, 0), -1, (0.06, -0.2, -0.26)),
        build_hand(m, "MG42_HandLeft", (-0.032, 0.42, -0.02), (1, 0, 0), (0, 0, -1), 1, (-0.1, -0.38, -0.26)),
    ]

    markers = [
        empty("MG42_Muzzle", (0, 0.81, 0.025)),
        empty("MG42_EjectPort", (0, 0.2, -0.025)),
    ]
    return [body, cover, belt, *hands, *markers]


# --------------------------------------------------------------------------------------------
# 8.8 cm Flak — seen from the gunner's position, so only the breech end and barrel matter.
# --------------------------------------------------------------------------------------------


def build_flak88(m):
    new_collection("Flak88")

    barrel_parts = []
    ring = box("breech_ring", (0.36, 0.5, 0.36), (0, 0.25, 0), m["Sand"])
    add_bevel(ring, width=0.01)
    barrel_parts.append(ring)
    barrel_parts.append(cylinder_y("jacket", 0.13, 0.5, 2.0, 0, 0, m["Sand"], segments=20))
    barrel_parts.append(cylinder_y("tube", 0.105, 2.0, 4.85, 0, 0, m["Sand"], segments=20, radius_end=0.08))
    barrel_parts.append(cylinder_y("muzzle", 0.09, 4.85, 4.95, 0, 0, m["Sand"], segments=20))
    barrel_parts.append(cylinder_y("bore", 0.045, 4.93, 4.951, 0, 0, m["Dark"], segments=16))
    barrel_parts.append(cylinder_y("breech_opening", 0.05, -0.001, 0.02, 0, 0, m["Dark"], segments=16))
    barrel = join("Flak88_Barrel", barrel_parts)

    breech = join(
        "Flak88_Breech",
        [
            box("breech_block", (0.26, 0.14, 0.26), (0, 0.06, 0), m["Gunmetal"]),
            box("breech_lever", (0.04, 0.04, 0.22), (0.16, 0.02, -0.08), m["Gunmetal"]),
            cylinder_x("breech_knob", 0.03, 0.06, (0.2, 0.02, -0.19), m["Dark"]),
        ],
    )
    breech.parent = barrel

    body_parts = []
    cradle = box("cradle", (0.42, 2.6, 0.22), (0, 1.3, -0.3), m["Sand"])
    add_bevel(cradle, width=0.01)
    body_parts.append(cradle)
    for side in (-1, 1):
        body_parts.append(cylinder_y(f"recuperator_{side}", 0.075, 0.55, 2.6, side * 0.11, 0.21, m["Sand"], segments=16))
        body_parts.append(cylinder_y(f"recuperator_cap_{side}", 0.08, 2.6, 2.66, side * 0.11, 0.21, m["Gunmetal"], segments=16))
    body_parts.append(box("recoil_guard", (0.5, 0.9, 0.05), (0, -0.25, -0.42), m["Sand"]))
    body_parts.append(cylinder_y("sight", 0.04, 0.2, 0.9, -0.42, 0.18, m["Dark"], segments=12))
    body_parts.append(cylinder_y("sight_eyepiece", 0.05, 0.1, 0.2, -0.42, 0.18, m["Rubber"], segments=12))
    body_parts.append(box("sight_mount", (0.25, 0.1, 0.06), (-0.3, 0.55, 0.12), m["Sand"]))
    body_parts.extend(handwheel("elevation_wheel", 0.16, (-0.52, 0.35, -0.3), m["Gunmetal"], axis="X"))
    body_parts.extend(handwheel("traverse_wheel", 0.14, (-0.42, 0.0, -0.62), m["Gunmetal"], axis="Y"))
    tray = box("loading_tray", (0.24, 1.1, 0.04), (0.42, -0.45, -0.14), m["Sand"])
    tray.data.transform(Matrix.Translation((0.42, -0.45, -0.14)) @ Matrix.Rotation(-0.1, 4, "X") @ Matrix.Translation((-0.42, 0.45, 0.14)))
    body_parts.append(tray)
    body = join("Flak88_Body", body_parts)

    shell = join(
        "Flak88_Shell",
        [
            cylinder_y("case", 0.045, 0.0, 0.57, 0, 0, m["Brass"], segments=16),
            cylinder_y("rim", 0.05, -0.01, 0.0, 0, 0, m["Brass"], segments=16),
            cylinder_y("projectile", 0.044, 0.57, 0.8, 0, 0, m["Olive"], segments=16, radius_end=0.02),
            cylinder_y("fuze", 0.02, 0.8, 0.86, 0, 0, m["Steel"], segments=12, radius_end=0.004),
        ],
    )
    set_origin(shell, (0, 0.43, 0))
    shell.location = (0.42, -0.6, -0.06)
    # Empty case thrown out of the breech after each shot.
    case = join(
        "Flak88_Case",
        [
            cylinder_y("spent_case", 0.045, 0.0, 0.57, 0, 0, m["Brass"], segments=16),
            cylinder_y("spent_rim", 0.05, -0.01, 0.0, 0, 0, m["Brass"], segments=16),
        ],
    )
    set_origin(case, (0, 0.28, 0))

    muzzle = empty("Flak88_Muzzle", (0, 5.0, 0))
    muzzle.parent = barrel
    load_port = empty("Flak88_LoadPort", (0, 0.43, 0))
    load_port.parent = barrel
    return [barrel, breech, body, shell, case, muzzle, load_port]


# --------------------------------------------------------------------------------------------
# Laser blaster
# --------------------------------------------------------------------------------------------


def build_laser(m):
    new_collection("Laser")
    parts = []
    body = profile(
        "body",
        [(-0.12, 0.0), (0.2, 0.0), (0.26, 0.02), (0.26, 0.055), (0.18, 0.075), (-0.06, 0.075), (-0.14, 0.04)],
        0.06,
        m["PaintWhite"],
    )
    add_bevel(body, width=0.006, segments=3)
    parts.append(body)
    parts.append(box("stripe", (0.062, 0.24, 0.012), (0, 0.06, 0.03), m["Dark"]))
    grip = profile("grip", [(-0.04, 0.0), (0.03, 0.0), (0.01, -0.12), (-0.04, -0.125), (-0.06, -0.11)], 0.04, m["Dark"])
    add_bevel(grip, width=0.006)
    parts.append(grip)
    parts.append(box("trigger_guard", (0.012, 0.07, 0.006), (0, 0.06, -0.045), m["Dark"]))
    parts.append(profile("trigger", [(0.045, 0), (0.052, 0), (0.048, -0.02), (0.04, -0.024)], 0.008, m["Dark"]))
    parts.append(cylinder_y("emitter", 0.026, 0.26, 0.42, 0, 0.035, m["Gunmetal"], segments=16))
    for i in range(3):
        y = 0.29 + i * 0.04
        parts.append(cylinder_y(f"emitter_ring_{i}", 0.032, y, y + 0.012, 0, 0.035, m["GlowCyan"], segments=16))
    parts.append(cylinder_y("lens", 0.018, 0.42, 0.43, 0, 0.035, m["GlowCyan"], segments=16))
    parts.append(cylinder_y("core", 0.016, -0.06, 0.18, 0, 0.09, m["GlowCyan"], segments=12))
    for x in (-0.012, 0.012):
        parts.append(box(f"core_clamp_{x}", (0.008, 0.02, 0.03), (x, 0.1, 0.085), m["Gunmetal"]))
    for side in (-1, 1):
        parts.append(box(f"cell_{side}", (0.008, 0.06, 0.02), (side * 0.031, -0.04, 0.03), m["GlowCyan"]))
    laser = join("Laser_Body", parts)
    muzzle = empty("Laser_Muzzle", (0, 0.44, 0.035))
    hands = [
        build_hand(m, "Laser_HandRight", (0.03, -0.03, -0.055), (0, 1, 0), (1, 0, 0), -1, (0.06, -0.2, -0.26)),
        build_hand(m, "Laser_HandLeft", (-0.034, 0.3, -0.008), (1, 0, 0), (0, 0, -1), 1, (-0.1, -0.35, -0.26)),
    ]
    return [laser, *hands, muzzle]


# --------------------------------------------------------------------------------------------
# Throwable atomic bomb (cartoon) and its mushroom cloud
# --------------------------------------------------------------------------------------------


def build_nuke(m):
    new_collection("Nuke")
    parts = [cloud_blob("shell", 1.0, (0.13, 0.2, 0.13), (0, 0, 0), m["Olive"], roughness=0.0, subdivisions=3)]
    parts.append(cylinder_y("band", 0.132, -0.03, 0.03, 0, 0, m["Yellow"], segments=24))
    for i in range(3):
        angle = i * 2 * math.pi / 3
        blade = profile(f"trefoil_{i}", [(0, 0), (0.025, 0.045), (-0.025, 0.045)], 0.004, m["Dark"])
        blade.data.transform(Matrix.Rotation(angle, 4, "X"))
        blade.location = (0.133, 0, 0)
        parts.append(blade)
    parts.append(cylinder_y("tail_box", 0.07, -0.32, -0.18, 0, 0, m["Olive"], segments=4))
    for i in range(4):
        fin = box(f"fin_{i}", (0.006, 0.12, 0.2), (0, -0.26, 0), m["Olive"])
        fin.data.transform(Matrix.Rotation(i * math.pi / 2 + math.pi / 4, 4, "Y"))
        parts.append(fin)
    parts.append(cylinder_y("nose", 0.03, 0.19, 0.22, 0, 0, m["Dark"], segments=12))
    bomb = join("Nuke_Bomb", parts)
    # Marks the nose so the game can point the bomb forward.
    return [bomb, empty("Nuke_Muzzle", (0, 0.23, 0))]


def build_radio(m):
    """Field radio used to call in the atomic bomb, held upright in the right hand."""
    new_collection("Radio")
    case = box("case", (0.06, 0.035, 0.14), (0, 0, 0), m["Olive"])
    add_bevel(case, width=0.004)
    parts = [
        case,
        box("display", (0.04, 0.002, 0.022), (0, -0.0185, 0.04), m["GlowGreen"]),
        cylinder_y("button", 0.01, -0.024, -0.017, 0, 0.005, m["GlowRed"], segments=12),
        cylinder_between("antenna", (0.018, 0, 0.07), (0.022, 0.01, 0.2), 0.004, m["Dark"], segments=8),
        sphere("antenna_tip", 0.006, (0.022, 0.01, 0.2), m["Dark"]),
        cylinder_between("knob", (-0.016, 0, 0.07), (-0.016, 0, 0.082), 0.007, m["Dark"], segments=10),
    ]
    for i in range(4):
        parts.append(box(f"grille_{i}", (0.04, 0.002, 0.003), (0, -0.0185, -0.02 - i * 0.008), m["Dark"]))
    body = join("Radio_Body", parts)
    hand = build_hand(m, "Radio_HandRight", (0.042, -0.03, -0.025), (0, 1, 0), (1, 0, 0), -1, (0.06, -0.2, -0.26), curl=(1.0, 1.9, 2.6))
    return [body, hand, empty("Radio_Muzzle", (0.022, 0.01, 0.2))]


def build_mushroom(m):
    new_collection("Mushroom")
    stem = cloud_blob("Mushroom_Stem", 1.0, (0.32, 0.32, 1.25), (0, 0, 1.25), m["Smoke"], seed=3.0)
    set_origin(stem, (0, 0, 0))
    cap = join(
        "Mushroom_Cap",
        [
            cloud_blob("cap", 1.0, (1.05, 1.05, 0.6), (0, 0, 2.75), m["Smoke"], roughness=0.3, seed=1.0),
            cloud_blob("cap_top", 1.0, (0.7, 0.7, 0.45), (0, 0, 3.15), m["Smoke"], roughness=0.3, seed=5.0),
        ],
    )
    set_origin(cap, (0, 0, 2.75))
    ring = torus("Mushroom_Ring", 0.95, 0.3, (0, 0, 2.4), m["Smoke"], major_segments=48, minor_segments=16)
    roughen(ring, 0.18, seed=4.0)
    set_origin(ring, (0, 0, 2.4))
    base = cloud_blob("Mushroom_Base", 1.0, (1.6, 1.6, 0.3), (0, 0, 0.15), m["Smoke"], roughness=0.35, seed=8.0)
    set_origin(base, (0, 0, 0))
    return [stem, cap, ring, base]


# --------------------------------------------------------------------------------------------
# 9 mm pistol
# --------------------------------------------------------------------------------------------


def build_pistol(m):
    new_collection("Pistol")
    parts = []

    frame = profile(
        "frame",
        [(0.0, 0.0), (0.165, 0.0), (0.165, -0.016), (0.075, -0.016), (0.06, -0.012), (0.0, -0.006)],
        0.026,
        m["Dark"],
    )
    add_bevel(frame)
    parts.append(frame)
    grip = profile(
        "grip",
        [(-0.02, -0.004), (0.05, -0.004), (0.032, -0.105), (-0.006, -0.108), (-0.028, -0.098), (-0.016, -0.03)],
        0.03,
        m["Dark"],
    )
    add_bevel(grip, width=0.004, segments=3)
    parts.append(grip)
    parts.append(box("guard_bottom", (0.012, 0.055, 0.004), (0, 0.075, -0.036), m["Dark"]))
    parts.append(box("guard_front", (0.012, 0.004, 0.024), (0, 0.101, -0.025), m["Dark"]))
    parts.append(profile("trigger", [(0.06, -0.012), (0.066, -0.012), (0.062, -0.03), (0.056, -0.032)], 0.006, m["Steel"]))
    parts.append(cylinder_y("barrel", 0.0055, 0.15, 0.172, 0, 0.016, m["Steel"]))
    body = join("Pistol_Body", parts)

    slide_parts = [
        profile(
            "slide",
            [(-0.004, 0.0), (0.17, 0.0), (0.17, 0.026), (0.164, 0.032), (0.004, 0.032), (-0.004, 0.026)],
            0.027,
            m["Gunmetal"],
        ),
        box("ejection_port", (0.002, 0.03, 0.012), (0.0137, 0.07, 0.022), m["Dark"]),
        cylinder_y("bore", 0.0045, 0.169, 0.1705, 0, 0.016, m["Dark"], segments=10),
        box("rear_sight", (0.02, 0.006, 0.006), (0, 0.008, 0.035), m["Dark"]),
        box("front_sight", (0.004, 0.006, 0.006), (0, 0.16, 0.035), m["Dark"]),
    ]
    for i in range(5):
        for side in (-1, 1):
            slide_parts.append(box(f"serration_{i}_{side}", (0.001, 0.002, 0.02), (side * 0.0136, 0.006 + i * 0.006, 0.016), m["Dark"]))
    add_bevel(slide_parts[0])
    slide = join("Pistol_Slide", slide_parts)
    set_origin(slide, (0, 0.08, 0.016))

    mag = join(
        "Pistol_Mag",
        [
            profile("mag", [(-0.002, -0.01), (0.036, -0.01), (0.021, -0.104), (-0.013, -0.104)], 0.022, m["Gunmetal"]),
            profile("base_plate", [(-0.017, -0.104), (0.024, -0.104), (0.022, -0.113), (-0.019, -0.113)], 0.03, m["Dark"]),
        ],
    )
    set_origin(mag, (0, 0.012, -0.01))

    hands = [
        build_hand(m, "Pistol_HandRight", (0.024, -0.008, -0.05), (0, 1, 0), (1, 0, 0), -1, (0.06, -0.2, -0.26)),
        build_hand(m, "Pistol_HandLeft", (-0.036, 0.0, -0.075), (0, 1, 0), (-1, 0, 0), 1, (-0.08, -0.2, -0.26), curl=(0.5, 1.4, 2.2)),
    ]

    markers = [
        empty("Pistol_Muzzle", (0, 0.175, 0.016)),
        empty("Pistol_EjectPort", (0.016, 0.07, 0.024)),
    ]
    return [body, slide, mag, *hands, *markers]


# --------------------------------------------------------------------------------------------
# AK-47
# --------------------------------------------------------------------------------------------


def build_ak47(m):
    new_collection("AK47")
    parts = []

    receiver = profile(
        "receiver",
        [(0.0, -0.025), (0.25, -0.025), (0.25, 0.028), (0.235, 0.034), (0.02, 0.034), (0.0, 0.03)],
        0.044,
        m["Gunmetal"],
    )
    add_bevel(receiver)
    parts.append(receiver)
    parts.append(box("ejection_port", (0.002, 0.06, 0.016), (0.0225, 0.17, 0.014), m["Dark"]))
    parts.append(box("selector", (0.002, 0.11, 0.01), (0.0225, 0.14, -0.008), m["Steel"]))

    stock = profile(
        "stock",
        [
            (0.0, 0.025),
            (-0.02, 0.022),
            (-0.36, -0.03),
            (-0.365, -0.035),
            (-0.365, -0.12),
            (-0.35, -0.125),
            (-0.06, -0.045),
            (0.0, -0.02),
        ],
        0.038,
        m["Wood"],
    )
    add_bevel(stock, width=0.004, segments=3)
    parts.append(stock)
    parts.append(profile("butt_plate", [(-0.365, -0.035), (-0.372, -0.036), (-0.372, -0.121), (-0.365, -0.12)], 0.04, m["Steel"]))

    grip = profile(
        "grip",
        [(0.05, -0.025), (0.085, -0.025), (0.07, -0.13), (0.045, -0.134), (0.035, -0.122), (0.055, -0.03)],
        0.03,
        m["Wood"],
    )
    add_bevel(grip, width=0.004)
    parts.append(grip)
    parts.append(box("guard_bottom", (0.012, 0.075, 0.004), (0, 0.128, -0.052), m["Gunmetal"]))
    parts.append(box("guard_front", (0.012, 0.004, 0.028), (0, 0.164, -0.039), m["Gunmetal"]))
    parts.append(profile("trigger", [(0.115, -0.025), (0.122, -0.025), (0.118, -0.045), (0.11, -0.048)], 0.006, m["Dark"]))

    handguard = profile(
        "handguard", [(0.25, -0.02), (0.44, -0.02), (0.45, -0.005), (0.45, 0.025), (0.25, 0.025)], 0.042, m["Wood"]
    )
    add_bevel(handguard, width=0.004)
    parts.append(handguard)
    parts.append(cylinder_y("upper_handguard", 0.016, 0.29, 0.44, 0, 0.042, m["Wood"], segments=12, scale_x=1.1))
    parts.append(cylinder_y("gas_tube", 0.009, 0.44, 0.52, 0, 0.042, m["Steel"], segments=10))
    parts.append(box("gas_block", (0.022, 0.02, 0.05), (0, 0.515, 0.024), m["Gunmetal"]))
    parts.append(box("rear_sight", (0.022, 0.04, 0.014), (0, 0.27, 0.04), m["Steel"]))

    parts.append(cylinder_y("barrel", 0.0085, 0.25, 0.68, 0, 0.005, m["Steel"]))
    parts.append(box("front_sight", (0.012, 0.016, 0.04), (0, 0.62, 0.025), m["Gunmetal"]))
    parts.append(cylinder_y("muzzle_brake", 0.012, 0.66, 0.7, 0, 0.005, m["Gunmetal"], segments=12))
    body = join("AK47_Body", parts)

    bolt = join(
        "AK47_Bolt",
        [
            cylinder_x("bolt_handle", 0.006, 0.03, (0.036, 0.205, 0.016), m["Steel"], segments=10),
            box("bolt_carrier", (0.004, 0.03, 0.012), (0.0235, 0.205, 0.016), m["Steel"]),
        ],
    )
    set_origin(bolt, (0.03, 0.205, 0.016))

    # Curved "banana" magazine.
    mag = profile(
        "AK47_Mag",
        [
            (0.17, -0.02),
            (0.172, -0.07),
            (0.185, -0.12),
            (0.205, -0.165),
            (0.23, -0.205),
            (0.272, -0.19),
            (0.247, -0.152),
            (0.229, -0.11),
            (0.218, -0.065),
            (0.215, -0.02),
        ],
        0.026,
        m["Bakelite"],
    )
    add_bevel(mag, width=0.003)
    apply_modifiers(mag)
    set_origin(mag, (0, 0.19, -0.025))

    hands = [
        build_hand(m, "AK47_HandRight", (0.024, 0.045, -0.075), (0, 1, 0), (1, 0, 0), -1, (0.06, -0.2, -0.26)),
        build_hand(m, "AK47_HandLeft", (-0.03, 0.36, -0.045), (1, 0, 0), (0, 0, -1), 1, (-0.1, -0.35, -0.26)),
    ]

    markers = [
        empty("AK47_Muzzle", (0, 0.705, 0.005)),
        empty("AK47_EjectPort", (0.026, 0.17, 0.014)),
    ]
    return [body, bolt, mag, *hands, *markers]


# --------------------------------------------------------------------------------------------
# Gatling gun — classic hand-cranked model with brass housing, seen from behind the breech.
# --------------------------------------------------------------------------------------------


def build_gatling(m):
    new_collection("Gatling")
    parts = [
        cylinder_y("housing", 0.1, 0.0, 0.24, 0, 0, m["AgedBrass"], segments=24),
        cylinder_y("rear_plate", 0.085, -0.03, 0.0, 0, 0, m["Gunmetal"], segments=24),
        sphere("cascabel", 0.025, (0, -0.05, 0), m["Gunmetal"]),
        box("hopper", (0.05, 0.08, 0.09), (0, 0.13, 0.14), m["Gunmetal"]),
        box("hopper_mouth", (0.06, 0.09, 0.008), (0, 0.13, 0.185), m["Gunmetal"]),
    ]
    for i in range(4):
        parts.append(cylinder_x(f"hopper_round_{i}", 0.006, 0.05, (0, 0.105 + i * 0.016, 0.195), m["Brass"], segments=8))
    for side in (-1, 1):
        parts.append(box(f"side_frame_{side}", (0.012, 0.32, 0.05), (side * 0.108, 0.13, -0.01), m["Gunmetal"]))
        parts.append(cylinder_x(f"trunnion_{side}", 0.022, 0.03, (side * 0.125, 0.16, -0.01), m["Gunmetal"]))
    body = join("Gatling_Body", parts)

    barrel_parts = [cylinder_y("shaft", 0.012, 0.24, 0.95, 0, 0, m["Steel"], segments=10)]
    for i in range(6):
        angle = i * math.pi / 3
        x = math.cos(angle) * 0.045
        z = math.sin(angle) * 0.045
        barrel_parts.append(cylinder_y(f"barrel_{i}", 0.011, 0.24, 0.95, x, z, m["Steel"], segments=10))
        barrel_parts.append(cylinder_y(f"bore_{i}", 0.006, 0.95, 0.952, x, z, m["Dark"], segments=8))
    for name, start, end in (("rear_disc", 0.245, 0.27), ("middle_disc", 0.6, 0.615), ("front_disc", 0.915, 0.93)):
        barrel_parts.append(cylinder_y(name, 0.066, start, end, 0, 0, m["AgedBrass"], segments=20))
    barrels = join("Gatling_Barrels", barrel_parts)
    set_origin(barrels, (0, 0.6, 0))

    crank = join(
        "Gatling_Crank",
        [
            cylinder_x("crank_axle", 0.01, 0.05, (0.135, 0.09, 0), m["Steel"]),
            box("crank_arm", (0.008, 0.016, 0.1), (0.158, 0.09, -0.045), m["Gunmetal"]),
            cylinder_x("crank_handle", 0.01, 0.05, (0.185, 0.09, -0.09), m["Wood"]),
        ],
    )
    set_origin(crank, (0.135, 0.09, 0))

    hands = [
        build_hand(m, "Gatling_HandRight", (0.125, 0.2, -0.045), (0, 0, -1), (1, 0, 0), -1, (0.08, -0.32, -0.08), curl=(0.4, 1.2, 1.9)),
    ]

    markers = [
        empty("Gatling_Muzzle", (0, 0.96, 0)),
        empty("Gatling_EjectPort", (0, 0.16, -0.1)),
    ]
    return [body, barrels, crank, *hands, *markers]


# --------------------------------------------------------------------------------------------
# RPG-7 rocket launcher with a PG-7V rocket in the muzzle
# --------------------------------------------------------------------------------------------


def build_rpg7(m):
    new_collection("RPG7")
    parts = [
        cylinder_y("tube", 0.021, -0.45, 0.5, 0, 0, m["Gunmetal"], segments=16),
        cylinder_y("heat_shield", 0.031, -0.05, 0.22, 0, 0, m["Wood"], segments=16),
        cylinder_y("venturi", 0.022, -0.58, -0.45, 0, 0, m["Gunmetal"], segments=16, radius_end=0.05),
        cylinder_y("muzzle_ring", 0.025, 0.47, 0.5, 0, 0, m["Dark"], segments=16),
        cylinder_y("rear_ring", 0.026, -0.47, -0.43, 0, 0, m["Dark"], segments=16),
        box("sight_mount", (0.012, 0.08, 0.03), (-0.028, 0.08, 0.02), m["Gunmetal"]),
        cylinder_y("sight", 0.014, 0.03, 0.15, -0.05, 0.035, m["Dark"], segments=12),
        box("front_sight", (0.004, 0.01, 0.03), (0, 0.4, 0.03), m["Dark"]),
        box("rear_sight", (0.012, 0.01, 0.024), (0, -0.02, 0.03), m["Dark"]),
    ]
    grip = profile(
        "grip",
        [(0.02, -0.02), (0.06, -0.02), (0.05, -0.13), (0.025, -0.135), (0.012, -0.122), (0.03, -0.03)],
        0.03,
        m["Bakelite"],
    )
    add_bevel(grip, width=0.004)
    parts.append(grip)
    parts.append(box("guard_bottom", (0.012, 0.06, 0.004), (0, 0.1, -0.05), m["Gunmetal"]))
    parts.append(box("guard_front", (0.012, 0.004, 0.03), (0, 0.13, -0.035), m["Gunmetal"]))
    parts.append(profile("trigger", [(0.085, -0.02), (0.092, -0.02), (0.088, -0.04), (0.08, -0.043)], 0.006, m["Dark"]))
    body = join("RPG7_Body", parts)

    rocket = join(
        "RPG7_Rocket",
        [
            cylinder_y("stem", 0.019, 0.42, 0.56, 0, 0, m["Olive"], segments=12),
            cylinder_y("warhead", 0.02, 0.56, 0.72, 0, 0, m["Olive"], segments=16, radius_end=0.042),
            cylinder_y("warhead_nose", 0.042, 0.72, 0.84, 0, 0, m["Olive"], segments=16, radius_end=0.012),
            cylinder_y("fuse", 0.012, 0.84, 0.88, 0, 0, m["Brass"], segments=10, radius_end=0.006),
        ],
    )
    set_origin(rocket, (0, 0.56, 0))

    hands = [
        build_hand(m, "RPG7_HandRight", (0.024, 0.02, -0.075), (0, 1, 0), (1, 0, 0), -1, (0.06, -0.2, -0.26)),
        build_hand(m, "RPG7_HandLeft", (-0.03, 0.28, -0.045), (1, 0, 0), (0, 0, -1), 1, (-0.1, -0.35, -0.26)),
    ]
    markers = [empty("RPG7_Muzzle", (0, 0.89, 0))]
    return [body, rocket, *hands, *markers]


# --------------------------------------------------------------------------------------------
# MP40 submachine gun
# --------------------------------------------------------------------------------------------


def build_mp40(m):
    new_collection("MP40")
    parts = [
        cylinder_y("receiver", 0.02, 0.0, 0.3, 0, 0.02, m["Gunmetal"], segments=14),
        cylinder_y("barrel", 0.009, 0.3, 0.5, 0, 0.02, m["Steel"], segments=10),
        cylinder_y("muzzle_nut", 0.012, 0.485, 0.505, 0, 0.02, m["Gunmetal"], segments=10),
        box("barrel_rest", (0.012, 0.11, 0.012), (0, 0.43, -0.002), m["Gunmetal"]),
        box("front_sight", (0.006, 0.01, 0.022), (0, 0.48, 0.042), m["Gunmetal"]),
        box("rear_sight", (0.016, 0.014, 0.014), (0, 0.27, 0.044), m["Gunmetal"]),
        box("ejection_port", (0.002, 0.05, 0.014), (0.0205, 0.17, 0.024), m["Dark"]),
        box("mag_well", (0.03, 0.036, 0.05), (0, 0.165, -0.015), m["Gunmetal"]),
    ]
    frame = profile(
        "frame",
        [(0.0, 0.002), (0.24, 0.002), (0.24, -0.012), (0.09, -0.016), (0.0, -0.012)],
        0.032,
        m["Bakelite"],
    )
    parts.append(frame)
    grip = profile(
        "grip",
        [(0.03, -0.01), (0.08, -0.01), (0.068, -0.115), (0.042, -0.12), (0.03, -0.108), (0.042, -0.02)],
        0.03,
        m["Bakelite"],
    )
    add_bevel(grip, width=0.004)
    parts.append(grip)
    parts.append(box("guard_bottom", (0.012, 0.06, 0.004), (0, 0.11, -0.045), m["Gunmetal"]))
    parts.append(profile("trigger", [(0.095, -0.012), (0.102, -0.012), (0.098, -0.032), (0.09, -0.035)], 0.006, m["Dark"]))
    # Folding stock, unfolded: two steel struts and a butt plate.
    for z in (0.012, -0.045):
        parts.append(cylinder_y(f"stock_strut_{z}", 0.005, -0.26, 0.0, 0.012, z, m["Steel"], segments=8))
        parts.append(cylinder_y(f"stock_strut_l_{z}", 0.005, -0.26, 0.0, -0.012, z, m["Steel"], segments=8))
    parts.append(box("butt_plate", (0.04, 0.012, 0.09), (0, -0.265, -0.015), m["Gunmetal"]))
    body = join("MP40_Body", parts)

    bolt = join("MP40_Bolt", [cylinder_x("bolt_handle", 0.006, 0.026, (0.033, 0.19, 0.03), m["Steel"], segments=10)])
    set_origin(bolt, (0.03, 0.19, 0.03))
    mag = box("MP40_Mag", (0.024, 0.03, 0.22), (0, 0.165, -0.14), m["Gunmetal"])
    set_origin(mag, (0, 0.165, -0.03))

    hands = [
        build_hand(m, "MP40_HandRight", (0.024, 0.055, -0.065), (0, 1, 0), (1, 0, 0), -1, (0.06, -0.2, -0.26)),
        build_hand(m, "MP40_HandLeft", (-0.03, 0.27, -0.02), (1, 0, 0), (0, 0, -1), 1, (-0.1, -0.35, -0.26)),
    ]
    markers = [empty("MP40_Muzzle", (0, 0.51, 0.02)), empty("MP40_EjectPort", (0.024, 0.17, 0.026))]
    return [body, bolt, mag, *hands, *markers]


# --------------------------------------------------------------------------------------------
# M1 Garand rifle with an eight-round en-bloc clip
# --------------------------------------------------------------------------------------------


def build_m1garand(m):
    new_collection("M1Garand")
    stock = profile(
        "stock",
        [
            (-0.42, 0.018),
            (-0.12, 0.024),
            (-0.03, 0.004),
            (0.45, 0.004),
            (0.45, -0.03),
            (0.08, -0.036),
            (0.0, -0.06),
            (-0.07, -0.05),
            (-0.42, -0.135),
        ],
        0.045,
        m["Wood"],
    )
    add_bevel(stock, width=0.005, segments=3)
    parts = [
        stock,
        profile("butt_plate", [(-0.42, 0.018), (-0.428, 0.018), (-0.428, -0.136), (-0.42, -0.135)], 0.047, m["Gunmetal"]),
        box("receiver", (0.036, 0.15, 0.045), (0, 0.045, 0.026), m["Gunmetal"]),
        box("clip_opening", (0.026, 0.06, 0.004), (0, 0.05, 0.049), m["Dark"]),
        box("upper_handguard", (0.036, 0.3, 0.022), (0, 0.27, 0.037), m["Wood"]),
        cylinder_y("barrel", 0.009, 0.12, 0.62, 0, 0.026, m["Steel"], segments=10),
        cylinder_y("gas_cylinder", 0.013, 0.5, 0.6, 0, 0.012, m["Gunmetal"], segments=12),
        box("front_sight", (0.012, 0.01, 0.026), (0, 0.6, 0.045), m["Gunmetal"]),
        box("rear_sight", (0.03, 0.02, 0.02), (0, -0.02, 0.058), m["Gunmetal"]),
        box("barrel_band", (0.04, 0.012, 0.05), (0, 0.44, 0.015), m["Gunmetal"]),
        box("guard_bottom", (0.012, 0.065, 0.004), (0, 0.05, -0.065), m["Gunmetal"]),
        box("guard_front", (0.012, 0.004, 0.03), (0, 0.082, -0.05), m["Gunmetal"]),
        profile("trigger", [(0.04, -0.035), (0.047, -0.035), (0.043, -0.055), (0.035, -0.058)], 0.006, m["Dark"]),
    ]
    body = join("M1Garand_Body", parts)

    op_rod = join(
        "M1Garand_OpRod",
        [
            box("op_rod", (0.008, 0.36, 0.01), (0.022, 0.26, 0.02), m["Steel"]),
            box("op_rod_handle", (0.016, 0.014, 0.014), (0.03, 0.09, 0.03), m["Steel"]),
        ],
    )
    set_origin(op_rod, (0.022, 0.09, 0.02))

    clip_parts = [box("clip", (0.024, 0.055, 0.012), (0, 0.05, 0.05), m["Brass"])]
    for i in range(4):
        clip_parts.append(cylinder_y(f"round_{i}", 0.0045, 0.025, 0.075, -0.009 + i * 0.006, 0.058, m["Brass"], segments=8))
    clip = join("M1Garand_Clip", clip_parts)
    set_origin(clip, (0, 0.05, 0.05))

    hands = [
        build_hand(m, "M1Garand_HandRight", (0.034, -0.07, 0.0), (0, 0.25, -1), (1, 0, 0.2), -1, (0.06, -0.2, -0.26)),
        build_hand(m, "M1Garand_HandLeft", (-0.03, 0.3, -0.035), (1, 0, 0), (0, 0, -1), 1, (-0.1, -0.35, -0.26)),
    ]
    markers = [empty("M1Garand_Muzzle", (0, 0.63, 0.026)), empty("M1Garand_EjectPort", (0.02, 0.06, 0.055))]
    return [body, op_rod, clip, *hands, *markers]


# --------------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------------

MODELS = {
    "pistol": build_pistol,
    "mp40": build_mp40,
    "shotgun": build_shotgun,
    "m1garand": build_m1garand,
    "ak47": build_ak47,
    "mg42": build_mg42,
    "gatling": build_gatling,
    "rpg7": build_rpg7,
    "flak88": build_flak88,
    "laser": build_laser,
    "nuke": build_nuke,
    "radio": build_radio,
    "mushroom": build_mushroom,
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", required=True, help="Directory of the per-model .blend files")
    parser.add_argument(
        "--rebuild",
        nargs="+",
        default=[],
        choices=[*MODELS, "all"],
        help="Regenerate these existing files (replaces manual edits)",
    )
    args = parser.parse_args(argv)
    rebuild = set(MODELS) if "all" in args.rebuild else set(args.rebuild)

    os.makedirs(args.models_dir, exist_ok=True)
    for name, build in MODELS.items():
        path = os.path.abspath(os.path.join(args.models_dir, f"{name}.blend"))
        if os.path.exists(path) and name not in rebuild:
            print(f"Keeping {path}")
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        build(create_materials())
        bpy.ops.wm.save_as_mainfile(filepath=path)
        print(f"Generated {path}")


main()
