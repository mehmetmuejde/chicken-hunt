"""Builds the first-person weapon models and exports them as glTF binaries.

Run headless from the project root:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python blender/build_weapons.py -- --out public/models --blend blender/weapons.blend

Optional: ``--preview <dir>`` renders preview images of every model into <dir>.

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
    "ShellRed": ((0.72, 0.07, 0.05), 0.0, 0.4),
    "Sand": ((0.36, 0.31, 0.19), 0.1, 0.7),
    "PaintWhite": ((0.78, 0.8, 0.82), 0.1, 0.35),
    "Olive": ((0.22, 0.25, 0.1), 0.1, 0.6),
    "Yellow": ((0.85, 0.65, 0.05), 0.0, 0.5),
    "Smoke": ((0.3, 0.27, 0.25), 0.0, 1.0),
    # Names starting with "Glow" are rendered unlit and emissive by the game.
    "GlowCyan": ((0.2, 0.95, 1.0), 0.0, 0.2),
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

    markers = [
        empty("Shotgun_Muzzle", (0, 0.71, 0.05)),
        empty("Shotgun_LoadPort", (0, 0.13, -0.004)),
        empty("Shotgun_EjectPort", (0.026, 0.11, 0.045)),
    ]
    return [body, pump, shell, *markers]


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

    markers = [
        empty("MG42_Muzzle", (0, 0.81, 0.025)),
        empty("MG42_EjectPort", (0, 0.2, -0.025)),
    ]
    return [body, cover, belt, *markers]


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
    return [laser, muzzle]


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
# Export and preview
# --------------------------------------------------------------------------------------------


def export_glb(objects, path):
    for obj in bpy.context.scene.objects:
        obj.select_set(obj in objects)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
    )


def render_previews(objects_by_name, directory):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = 1400
    scene.render.resolution_y = 700
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("PreviewWorld")
    world.color = (0.75, 0.82, 0.88)
    scene.world = world

    camera = bpy.data.objects.new("PreviewCamera", bpy.data.cameras.new("PreviewCamera"))
    camera.data.type = "ORTHO"
    scene.collection.objects.link(camera)
    scene.camera = camera

    for name, objects in objects_by_name.items():
        for obj in scene.objects:
            obj.hide_render = obj.type != "CAMERA" and obj not in objects and obj.parent not in objects
        corners = [obj.matrix_world @ Vector(corner) for obj in objects if obj.type == "MESH" for corner in obj.bound_box]
        low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
        high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
        center = (low + high) / 2
        size = max(high - low)
        camera.data.ortho_scale = size * 1.15
        views = {
            "side": (center + Vector((size * 2, 0, 0)), (math.pi / 2, 0, math.pi / 2)),
            "three_quarter": (center + Vector((size * 1.4, -size * 1.0, size * 0.7)), (math.radians(62), 0, math.radians(55))),
        }
        for view, (location, rotation) in views.items():
            camera.location = location
            camera.rotation_euler = rotation
            scene.render.filepath = os.path.join(directory, f"{name}_{view}.png")
            bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, help="Directory for the exported .glb files")
    parser.add_argument("--blend", help="Path to save the generated .blend file")
    parser.add_argument("--preview", help="Directory for preview renders")
    args = parser.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = create_materials()
    models = {
        "shotgun": build_shotgun(materials),
        "mg42": build_mg42(materials),
        "flak88": build_flak88(materials),
        "laser": build_laser(materials),
        "nuke": build_nuke(materials),
        "mushroom": build_mushroom(materials),
    }

    os.makedirs(args.out, exist_ok=True)
    for name, objects in models.items():
        export_glb(objects, os.path.join(args.out, f"{name}.glb"))

    if args.blend:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
        render_previews(models, args.preview)


main()
