"""Exports the per-model Blender source files as glTF binaries for the game.

Reads every `<name>.blend` in the models directory and writes `<name>.glb` into the output
directory. The .blend files are only read, never saved. Run headless from the project root:

    /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup \
        --python blender/export_models.py -- --models-dir blender/models --out public/models

Optional: ``--only <name> ...`` exports just these models, ``--preview <dir>`` renders preview
images of every exported model into <dir>.

All mesh objects and empties of the file's scene are exported; cameras and lights are left out.
Keep the node names (`<Prefix>_<Part>`), the game looks them up.
"""

import argparse
import glob
import os
import sys

import bpy
from mathutils import Vector


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


def render_previews(name, objects, directory):
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

    for obj in scene.objects:
        obj.hide_render = obj.type != "CAMERA" and obj not in objects
    # bound_box is not evaluated yet right after opening a file, so frame the mesh vertices.
    corners = [obj.matrix_world @ v.co for obj in objects if obj.type == "MESH" for v in obj.data.vertices]
    low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    center = (low + high) / 2
    size = max(high - low)
    # The frame is twice as wide as high, so tall models need a wider view.
    camera.data.ortho_scale = max(high.x - low.x, high.y - low.y, 2 * (high.z - low.z)) * 1.15
    views = {
        "side": Vector((size * 2, 0, 0)),
        "three_quarter": Vector((size * 1.4, -size * 1.0, size * 0.7)),
    }
    for view, offset in views.items():
        camera.location = center + offset
        camera.rotation_euler = (-offset).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(directory, f"{name}_{view}.png")
        bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", required=True, help="Directory of the per-model .blend files")
    parser.add_argument("--out", required=True, help="Directory for the exported .glb files")
    parser.add_argument("--only", nargs="+", help="Export only these models")
    parser.add_argument("--preview", help="Directory for preview renders")
    args = parser.parse_args(argv)

    paths = sorted(glob.glob(os.path.join(os.path.abspath(args.models_dir), "*.blend")))
    if args.only:
        paths = [p for p in paths if os.path.splitext(os.path.basename(p))[0] in args.only]
    if not paths:
        sys.exit(f"No matching .blend files in {args.models_dir}")

    os.makedirs(args.out, exist_ok=True)
    if args.preview:
        os.makedirs(args.preview, exist_ok=True)
    for path in paths:
        name = os.path.splitext(os.path.basename(path))[0]
        bpy.ops.wm.open_mainfile(filepath=path)
        objects = [obj for obj in bpy.context.scene.objects if obj.type in {"MESH", "EMPTY"}]
        export_glb(objects, os.path.join(os.path.abspath(args.out), f"{name}.glb"))
        print(f"Exported {name}.glb ({len(objects)} objects)")
        if args.preview:
            render_previews(name, objects, os.path.abspath(args.preview))


main()
