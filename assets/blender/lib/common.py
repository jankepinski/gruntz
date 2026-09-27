"""Shared helpers for the Gruntz asset scripts (run with `blender -b -P <script>`)."""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
MODELS_DIR = os.path.join(ROOT, 'apps', 'client', 'public', 'models')
PREVIEW_DIR = os.path.join(ROOT, 'assets', 'previews')
OUT_DIR = os.path.join(ROOT, 'assets', 'blender', 'out')


def arg(name, default=None):
    """Read `--name value` after the `--` separator on the command line."""
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    if f'--{name}' in argv:
        i = argv.index(f'--{name}')
        return argv[i + 1] if i + 1 < len(argv) else True
    return default


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.render.fps = 30
    return scene


def select_only(*objects, active=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active or (objects[0] if objects else None)


def apply_modifiers(obj):
    select_only(obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def apply_transform(obj, location=True, rotation=True, scale=True):
    select_only(obj)
    bpy.ops.object.transform_apply(location=location, rotation=rotation, scale=scale)


def shade_smooth(obj, angle=None):
    select_only(obj)
    if angle is None:
        bpy.ops.object.shade_smooth()
    else:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(angle))


def join(objects, name):
    select_only(*objects, active=objects[0])
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def mesh_from_bmesh(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    return obj


def decimate(obj, target_tris):
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if tris <= target_tris:
        return
    mod = obj.modifiers.new('decimate', 'DECIMATE')
    mod.ratio = target_tris / tris
    mod.use_collapse_triangulate = False
    apply_modifiers(obj)


def voxel_remesh(obj, voxel=0.01, smooth_iterations=0):
    mod = obj.modifiers.new('remesh', 'REMESH')
    mod.mode = 'VOXEL'
    mod.voxel_size = voxel
    mod.use_smooth_shade = True
    apply_modifiers(obj)
    if smooth_iterations:
        sm = obj.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
        sm.iterations = smooth_iterations
        sm.use_only_smooth = True
        sm.smooth_type = 'SIMPLE'
        apply_modifiers(obj)


def tri_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# --- materials ------------------------------------------------------------------------

def clay_material(name, color, roughness=0.8, metallic=0.0, bump=0.25):
    """Principled clay with a fine procedural bump (baked away / approximated in-game)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if bump > 0:
        noise = nt.nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 60.0
        noise.inputs['Detail'].default_value = 4.0
        bmp = nt.nodes.new('ShaderNodeBump')
        bmp.inputs['Strength'].default_value = bump * 0.3
        bmp.inputs['Distance'].default_value = 0.002
        nt.links.new(noise.outputs['Fac'], bmp.inputs['Height'])
        nt.links.new(bmp.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def hex_color(h):
    """sRGB hex -> linear rgb tuple."""
    def lin(c):
        c /= 255.0
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin((h >> 16) & 255), lin((h >> 8) & 255), lin(h & 255))


def set_material(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)


# --- UV + bake ------------------------------------------------------------------------

def smart_uv(obj, margin=0.02):
    select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_ao_into_base(obj, mat, size=1024, samples=48, strength=1.0, base=(1.0, 1.0, 1.0)):
    """Bake ambient occlusion, multiply it into a flat base colour and use the result as
    the material's base colour texture (a plain image -> Base Color link exports to glTF)."""
    import numpy as np

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    img = bpy.data.images.new(f'{obj.name}_{mat.name}_ao', size, size)
    nt = mat.node_tree
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    # Only bake this material: make its texture node active, others keep theirs.
    for m in obj.data.materials:
        if m and m != mat and m.use_nodes:
            dummy = m.node_tree.nodes.new('ShaderNodeTexImage')
            dummy.image = img
            m.node_tree.nodes.active = dummy
    nt.nodes.active = tex
    select_only(obj)
    bpy.ops.object.bake(type='AO', margin=8, use_clear=True)
    for m in obj.data.materials:
        if m and m != mat and m.use_nodes:
            for n in list(m.node_tree.nodes):
                if n.type == 'TEX_IMAGE' and n.image == img:
                    m.node_tree.nodes.remove(n)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
    ao = px[:, 0:1]
    shade = 1.0 - strength + strength * ao
    rgb = np.array(base, dtype=np.float32)[None, :] * shade
    px[:, 0:3] = rgb
    px[:, 3] = 1.0
    img.pixels[:] = px.ravel()
    os.makedirs(OUT_DIR, exist_ok=True)
    img.filepath_raw = os.path.join(OUT_DIR, f'{img.name}.png')
    img.file_format = 'PNG'
    img.save()
    bsdf = nt.nodes.get('Principled BSDF')
    nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return img


# --- preview renders ------------------------------------------------------------------

def setup_preview(target=(0, 0, 0.4), distance=2.6, height=1.3, size=768, background=(0.94, 0.9, 0.84)):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('preview') if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*background, 1.0)
    bg.inputs['Strength'].default_value = 0.7
    # soft key + rim light
    key = bpy.data.lights.new('key', 'AREA')
    key.energy = 260
    key.size = 3
    key_obj = bpy.data.objects.new('key', key)
    key_obj.location = (2.2, -2.4, 3.2)
    key_obj.rotation_euler = Euler((math.radians(50), 0, math.radians(40)))
    scene.collection.objects.link(key_obj)
    rim = bpy.data.lights.new('rim', 'AREA')
    rim.energy = 140
    rim.size = 2
    rim_obj = bpy.data.objects.new('rim', rim)
    rim_obj.location = (-2.2, 2.6, 2.4)
    rim_obj.rotation_euler = Euler((math.radians(-55), 0, math.radians(200)))
    scene.collection.objects.link(rim_obj)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 60
    cam_obj = bpy.data.objects.new('cam', cam)
    scene.collection.objects.link(cam_obj)
    scene.camera = cam_obj
    # ground
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
    ground = bpy.context.active_object
    ground.name = 'preview_ground'
    set_material(ground, clay_material('ground', (0.62, 0.55, 0.45), roughness=0.95, bump=0))
    return cam_obj, Vector(target), distance, height


def render_views(name, cam_obj, target, distance, height, angles=(0, 90, 180, 315)):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    paths = []
    for a in angles:
        rad = math.radians(a)
        # angle 0 = looking at the model's front (-Y in Blender is front after export? we use +Y front)
        cam_obj.location = target + Vector((math.sin(rad) * distance, -math.cos(rad) * distance, height))
        direction = target - cam_obj.location
        cam_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        path = os.path.join(PREVIEW_DIR, f'{name}_{a}.png')
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        paths.append(path)
    return paths


# --- export ---------------------------------------------------------------------------

def export_glb(name, objects=None, animations=False, selected=True, vertex_colors=False):
    os.makedirs(MODELS_DIR, exist_ok=True)
    path = os.path.join(MODELS_DIR, f'{name}.glb')
    if objects is not None:
        select_only(*objects)
    kwargs = dict(
        filepath=path,
        export_format='GLB',
        use_selection=selected,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
    )
    if vertex_colors:
        kwargs.update(export_vertex_color='ACTIVE')
    if animations:
        kwargs.update(export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True, export_skins=True)
    else:
        kwargs.update(export_animations=False)
    bpy.ops.export_scene.gltf(**kwargs)
    return path


def bake_vertex_ao(objs, samples=24):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = samples
    scene.render.bake.target = 'VERTEX_COLORS'
    for o in objs:
        me = o.data
        if not me.color_attributes.get('Col'):
            me.color_attributes.new('Col', 'BYTE_COLOR', 'CORNER')
        me.color_attributes.active_color = me.color_attributes['Col']
        select_only(o)
        # bake each piece in isolation: hide others
        for other in objs:
            other.hide_render = other is not o
        bpy.ops.object.bake(type='AO', use_clear=True)
    for o in objs:
        o.hide_render = False
