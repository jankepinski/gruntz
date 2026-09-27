"""Items: tools, toys, powerups, utilities and rewards. Exports
apps/client/public/models/items.glb (one object per item id) and, with --icons,
renders HUD icons to apps/client/public/icons/<ID>.png.

Conventions: Z up, forward -Y. Tools have their origin at the grip (where the hand
holds them) and point "up" (+Z) when held upright.
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Vector, noise

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as C  # noqa: E402

ICON_DIR = os.path.join(C.ROOT, 'apps', 'client', 'public', 'icons')
MATS = {}


def m(name, color, rough=0.6, metal=0.0, emit=0.0):
    key = f'{name}'
    if key not in MATS:
        mat = C.clay_material(name, C.hex_color(color), roughness=rough, metallic=metal, bump=0)
        if emit > 0:
            bsdf = mat.node_tree.nodes['Principled BSDF']
            bsdf.inputs['Emission Color'].default_value = (*C.hex_color(color), 1)
            bsdf.inputs['Emission Strength'].default_value = emit
        MATS[key] = mat
    return MATS[key]


def steel():
    return m('Steel', 0xb8c2cf, 0.3, 0.85)


def dark_steel():
    return m('DarkSteel', 0x5a6270, 0.35, 0.8)


def wood():
    return m('Wood', 0x9a6a3e, 0.8)


def dark_wood():
    return m('DarkWood', 0x6a4424, 0.85)


def leather():
    return m('Leather', 0x7a4a2a, 0.75)


def gold():
    return m('Gold', 0xf2c040, 0.3, 0.9)


# --- primitive helpers (return objects, all get applied transforms) ----------------------------

def _obj():
    o = bpy.context.active_object
    return o


def cyl(r, depth, loc=(0, 0, 0), rot=(0, 0, 0), verts=16, mat=None, r2=None, bev=0.0):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = _obj()
    C.apply_transform(o)
    if bev:
        mod = o.modifiers.new('b', 'BEVEL')
        mod.width = bev
        mod.segments = 2
        mod.limit_method = 'ANGLE'
        C.apply_modifiers(o)
    if mat:
        C.set_material(o, mat)
    return o


def box(size, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, bev=0.01, seg=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = _obj()
    o.scale = size
    C.apply_transform(o)
    if bev:
        mod = o.modifiers.new('b', 'BEVEL')
        mod.width = bev
        mod.segments = seg
        C.apply_modifiers(o)
    if mat:
        C.set_material(o, mat)
    return o


def sphere(r, loc=(0, 0, 0), scale=(1, 1, 1), mat=None, seg=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=r, location=loc)
    o = _obj()
    o.scale = scale
    C.apply_transform(o)
    C.shade_smooth(o)
    if mat:
        C.set_material(o, mat)
    return o


def torus(R, r, loc=(0, 0, 0), rot=(0, 0, 0), mat=None, maj=32, mino=12):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=maj, minor_segments=mino, location=loc, rotation=rot)
    o = _obj()
    C.apply_transform(o)
    C.shade_smooth(o)
    if mat:
        C.set_material(o, mat)
    return o


def smooth(o):
    C.shade_smooth(o)
    return o


def join(parts, name):
    o = C.join(parts, name)
    return o


ITEMS = []


def item(name):
    def deco(fn):
        ITEMS.append((name, fn))
        return fn
    return deco


# --- tools -----------------------------------------------------------------------------------------

@item('GAUNTLETZ')
def gauntletz():
    metal = m('Gauntlet', 0x9aa4b4, 0.35, 0.8)
    parts = [sphere(0.075, (0, 0, 0.02), (1.05, 0.95, 1.1), metal)]
    for i, x in enumerate((-0.04, -0.013, 0.013, 0.04)):
        parts.append(sphere(0.022, (x, -0.06, 0.05 - abs(x) * 0.3), (1, 1.3, 1), metal))
    parts.append(cyl(0.062, 0.07, (0, 0.0, -0.05), mat=leather(), r2=0.07))
    for z in (-0.03, -0.065):
        parts.append(torus(0.066, 0.008, (0, 0, z), mat=gold()))
    return join(parts, 'GAUNTLETZ')


@item('SHOVEL')
def shovel():
    parts = [cyl(0.014, 0.42, (0, 0, 0.1), mat=wood())]
    parts.append(box((0.08, 0.02, 0.035), (0, 0, 0.32), mat=dark_wood()))
    blade = box((0.13, 0.016, 0.15), (0, 0, -0.17), mat=steel(), bev=0.006)
    for v in blade.data.vertices:
        if v.co.z < -0.2:
            v.co.x *= 0.55
    parts.append(blade)
    return join(parts, 'SHOVEL')


@item('CLUB')
def club():
    c = cyl(0.03, 0.42, (0, 0, 0.12), mat=wood(), r2=0.07, verts=12)
    for v in c.data.vertices:
        v.co += Vector((noise.noise(v.co * 18) * 0.01, noise.noise(v.co * 17 + Vector((3, 0, 0))) * 0.01, 0))
    smooth(c)
    parts = [c]
    for i in range(6):
        a = i / 6 * math.tau
        z = 0.22 + (i % 2) * 0.07
        parts.append(cyl(0.012, 0.05, (math.cos(a) * 0.06, math.sin(a) * 0.06, z), (math.pi / 2, 0, a + math.pi / 2), mat=steel(), r2=0.0, verts=6))
    return join(parts, 'CLUB')


@item('SWORD')
def sword():
    blade = box((0.05, 0.012, 0.42), (0, 0, 0.28), mat=steel(), bev=0.004)
    for v in blade.data.vertices:
        if v.co.z > 0.45:
            v.co.x *= 0.1
    parts = [blade]
    parts.append(box((0.18, 0.035, 0.03), (0, 0, 0.065), mat=gold(), bev=0.008))
    parts.append(cyl(0.017, 0.1, (0, 0, 0.0), mat=leather()))
    parts.append(sphere(0.024, (0, 0, -0.06), mat=gold()))
    return join(parts, 'SWORD')


@item('GLOVEZ')
def glovez():
    red = m('BoxRed', 0xd82a2a, 0.45)
    parts = [sphere(0.085, (0, -0.01, 0.03), (1, 1.1, 1.05), red)]
    parts.append(sphere(0.035, (0.07, -0.03, 0.0), (1, 1, 1.2), red))
    parts.append(cyl(0.06, 0.07, (0, 0.01, -0.06), mat=m('BoxWhite', 0xf2f2f2, 0.6)))
    return join(parts, 'GLOVEZ')


@item('SPRING')
def spring():
    bm = bmesh.new()
    turns, steps = 6, 120
    prev = None
    verts = []
    for i in range(steps + 1):
        t = i / steps
        a = t * turns * math.tau
        verts.append(Vector((math.cos(a) * 0.05, math.sin(a) * 0.05, -0.1 + t * 0.2)))
    curve = bpy.data.curves.new('spring', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = 0.009
    curve.bevel_resolution = 3
    spl = curve.splines.new('POLY')
    spl.points.add(len(verts) - 1)
    for p, v in zip(spl.points, verts):
        p.co = (*v, 1)
    o = bpy.data.objects.new('spring', curve)
    bpy.context.collection.objects.link(o)
    C.select_only(o)
    bpy.ops.object.convert(target='MESH')
    o = _obj()
    C.set_material(o, steel())
    smooth(o)
    base = cyl(0.06, 0.02, (0, 0, -0.11), mat=dark_steel(), bev=0.005)
    return join([o, base], 'SPRING')


@item('TOOB')
def toob():
    ring = torus(0.2, 0.07, mat=m('Toob', 0xf2cf2a, 0.35))
    parts = [ring]
    for i in range(4):
        a = i / 4 * math.tau + math.pi / 4
        stripe = torus(0.2, 0.072, (0, 0, 0), mat=m('ToobStripe', 0xe8413a, 0.35))
        # keep only a segment of the stripe torus
        bm = bmesh.new()
        bm.from_mesh(stripe.data)
        dele = [v for v in bm.verts if abs(math.atan2(v.co.y, v.co.x) - (a - math.pi)) % math.tau > 0.25 and abs(math.atan2(v.co.y, v.co.x) - (a - math.pi)) % math.tau < math.tau - 0.25]
        bmesh.ops.delete(bm, geom=dele, context='VERTS')
        bm.to_mesh(stripe.data)
        bm.free()
        parts.append(stripe)
    return join(parts, 'TOOB')


@item('WINGZ')
def wingz():
    feather = m('Feather', 0xf6f4ee, 0.7)
    parts = []
    for side in (-1, 1):
        for i in range(5):
            f = sphere(0.045, (side * (0.07 + i * 0.045), 0.02, 0.05 + i * 0.03 - i * i * 0.008), (1.8 - i * 0.15, 0.25, 0.7), feather)
            f.rotation_euler = Euler((0, side * (0.4 + i * 0.1), 0))
            C.apply_transform(f)
            parts.append(f)
    parts.append(box((0.06, 0.03, 0.06), (0, 0.02, 0.03), mat=leather()))
    return join(parts, 'WINGZ')


@item('GRAVITYBOOTZ')
def gravitybootz():
    blue = m('Boot', 0x404a78, 0.4, 0.5)
    parts = [box((0.1, 0.18, 0.05), (0, -0.03, -0.06), mat=dark_steel(), bev=0.015)]
    parts.append(box((0.09, 0.1, 0.1), (0, 0.01, 0.01), mat=blue, bev=0.02))
    parts.append(torus(0.05, 0.01, (0, 0.01, 0.06), mat=gold()))
    return join(parts, 'GRAVITYBOOTZ')


@item('BOOMERANG')
def boomerang():
    bm = bmesh.new()
    pts = []
    for i in range(21):
        t = i / 20
        a = -1.1 + t * 2.2
        pts.append((math.sin(a) * 0.17, math.cos(a) * 0.12 - 0.08))
    top = [bm.verts.new((x, y, 0.012)) for x, y in pts]
    bottom = [bm.verts.new((x, y, -0.012)) for x, y in pts]
    for i in range(len(pts) - 1):
        bm.faces.new((top[i], top[i + 1], bottom[i + 1], bottom[i]))
    o = C.mesh_from_bmesh('boomerang', bm)
    mod = o.modifiers.new('sol', 'SOLIDIFY')
    mod.thickness = 0.04
    C.apply_modifiers(o)
    mod = o.modifiers.new('sub', 'SUBSURF')
    mod.levels = 2
    C.apply_modifiers(o)
    C.set_material(o, m('Boomerang', 0xd89a4a, 0.6))
    smooth(o)
    o.rotation_euler = Euler((math.pi / 2, 0, 0))
    C.apply_transform(o)
    return join([o], 'BOOMERANG')


@item('ROCK')
def rock():
    parts = []
    for i, (x, z, r) in enumerate(((0, 0.0, 0.07), (0.05, 0.07, 0.05), (-0.04, 0.06, 0.045))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=(x, 0, z))
        o = _obj()
        for v in o.data.vertices:
            v.co += v.normal * noise.noise(v.co * 25 + Vector((i, 0, 0))) * 0.012
        C.set_material(o, m('Stone', 0x8f8578, 0.9))
        parts.append(o)
    return join(parts, 'ROCK')


@item('NERFGUN')
def nerfgun():
    green = m('NerfGreen', 0x3ab84a, 0.45)
    orange = m('NerfOrange', 0xf29a2a, 0.45)
    parts = [box((0.06, 0.26, 0.08), (0, -0.07, 0.07), mat=green, bev=0.02)]
    parts.append(cyl(0.028, 0.08, (0, -0.22, 0.08), (math.pi / 2, 0, 0), mat=orange))
    parts.append(box((0.045, 0.06, 0.12), (0, 0.0, 0.0), rot=(0.3, 0, 0), mat=orange, bev=0.015))
    parts.append(sphere(0.035, (0, -0.07, 0.14), mat=m('Sponge', 0xf2e84a, 0.9)))
    return join(parts, 'NERFGUN')


@item('GUNHAT')
def gunhat():
    army = m('Army', 0x5a6a42, 0.6, 0.2)
    parts = [sphere(0.17, (0, 0, 0), (1, 1, 0.6), army)]
    bm_cut = [v for v in parts[0].data.vertices]
    parts.append(torus(0.165, 0.02, (0, 0, 0.0), mat=army))
    parts.append(cyl(0.035, 0.26, (0, -0.15, 0.07), (math.pi / 2 - 0.15, 0, 0), mat=dark_steel()))
    parts.append(cyl(0.045, 0.04, (0, -0.28, 0.09), (math.pi / 2 - 0.15, 0, 0), mat=dark_steel()))
    # keep only the dome's upper half
    dome = parts[0]
    bm = bmesh.new()
    bm.from_mesh(dome.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.005], context='VERTS')
    bm.to_mesh(dome.data)
    bm.free()
    return join(parts, 'GUNHAT')


@item('WELDER')
def welder():
    tank = m('Tank', 0xe86a2a, 0.45, 0.2)
    parts = [cyl(0.05, 0.16, (0, 0.05, 0.02), mat=tank, bev=0.02)]
    parts.append(cyl(0.02, 0.04, (0, 0.05, 0.12), mat=dark_steel()))
    parts.append(cyl(0.015, 0.2, (0, -0.06, 0.08), (0.6, 0, 0), mat=steel()))
    parts.append(cyl(0.024, 0.05, (0, -0.13, 0.16), (0.6, 0, 0), mat=gold(), r2=0.012))
    parts.append(sphere(0.02, (0, -0.15, 0.18), mat=m('Flame', 0x5ad8ff, 0.2, emit=4)))
    return join(parts, 'WELDER')


@item('SHIELD')
def shield():
    parts = [cyl(0.19, 0.035, (0, -0.02, 0.05), (math.pi / 2, 0, 0), verts=32, mat=m('ShieldBlue', 0x3a5ac8, 0.5, 0.3), bev=0.012)]
    parts.append(torus(0.185, 0.018, (0, -0.02, 0.05), (math.pi / 2, 0, 0), mat=steel()))
    parts.append(sphere(0.05, (0, -0.045, 0.05), (1, 0.6, 1), gold()))
    return join(parts, 'SHIELD')


@item('BRICK')
def brick_trowel():
    parts = [cyl(0.018, 0.12, (0, 0, 0.0), mat=wood())]
    parts.append(cyl(0.006, 0.07, (0, -0.03, 0.08), (0.9, 0, 0), mat=steel()))
    blade = box((0.1, 0.004, 0.14), (0, -0.07, 0.14), mat=steel(), bev=0.0)
    for v in blade.data.vertices:
        if v.co.z > 0.19:
            v.co.x *= 0.05
    parts.append(blade)
    parts.append(box((0.08, 0.05, 0.04), (0, 0.04, -0.09), mat=m('Brick', 0xb85a3a, 0.8), bev=0.008))
    return join(parts, 'BRICK')


@item('TIMEBOMB')
def timebomb():
    body = sphere(0.1, (0, 0, 0), mat=m('BombBlack', 0x24242c, 0.35, 0.3))
    face = cyl(0.055, 0.02, (0, -0.095, 0.01), (math.pi / 2, 0, 0), verts=24, mat=m('ClockFace', 0xf6f0dc, 0.4))
    hand1 = box((0.006, 0.004, 0.04), (0, -0.107, 0.025), mat=m('BombBlack', 0x24242c))
    hand2 = box((0.03, 0.004, 0.006), (0.012, -0.107, 0.012), mat=m('BombBlack', 0x24242c))
    bell_l = sphere(0.03, (-0.06, 0, 0.1), (1, 1, 0.6), gold())
    bell_r = sphere(0.03, (0.06, 0, 0.1), (1, 1, 0.6), gold())
    feet = [cyl(0.015, 0.03, (x, 0, -0.1), mat=gold()) for x in (-0.05, 0.05)]
    return join([body, face, hand1, hand2, bell_l, bell_r, *feet], 'TIMEBOMB')


@item('BOMB')
def bomb():
    body = sphere(0.11, (0, 0, 0), mat=m('BombBlack', 0x24242c, 0.35, 0.3))
    cap = cyl(0.03, 0.03, (0, 0, 0.11), mat=dark_steel())
    fuse = cyl(0.008, 0.07, (0.01, 0, 0.15), (0, 0.4, 0), mat=m('Fuse', 0xc8a870, 0.9))
    spark = sphere(0.018, (0.025, 0, 0.19), mat=m('Spark', 0xffc83a, 0.2, emit=6))
    shine = sphere(0.025, (-0.04, -0.07, 0.05), (1, 0.4, 1), m('Shine', 0x6a6a78, 0.2))
    return join([body, cap, fuse, spark, shine], 'BOMB')


@item('GOOBER')
def goober():
    pink = m('Straw', 0xf25a9a, 0.4)
    stripe = m('StrawWhite', 0xffffff, 0.4)
    parts = []
    for i in range(8):
        z = -0.1 + i * 0.04
        parts.append(cyl(0.012, 0.04, (0, 0, z), mat=pink if i % 2 == 0 else stripe))
    parts.append(torus(0.03, 0.012, (0.03, 0, 0.23), (math.pi / 2, 0, 0), mat=pink))
    parts.append(cyl(0.012, 0.06, (0.06, 0, 0.2), mat=stripe))
    return join(parts, 'GOOBER')


@item('SPY')
def spy():
    black = m('SpyBlack', 0x202028, 0.3, 0.4)
    lens = m('Lens', 0x3ad8a8, 0.1, 0.2, emit=1.2)
    parts = []
    for side in (-1, 1):
        parts.append(cyl(0.035, 0.07, (side * 0.045, -0.02, 0), (math.pi / 2, 0, 0), mat=black))
        parts.append(cyl(0.028, 0.01, (side * 0.045, -0.058, 0), (math.pi / 2, 0, 0), mat=lens))
    parts.append(box((0.03, 0.03, 0.02), (0, 0, 0), mat=black))
    return join(parts, 'SPY')


@item('WAND')
def wand():
    parts = [cyl(0.012, 0.32, (0, 0, 0.12), mat=m('WandBlack', 0x2a2a30, 0.3))]
    parts.append(cyl(0.013, 0.05, (0, 0, 0.26), mat=m('WandTip', 0xf6f6f6, 0.3)))
    bm = bmesh.new()
    pts = []
    for i in range(10):
        a = i / 10 * math.tau + math.pi / 2
        r = 0.06 if i % 2 == 0 else 0.026
        pts.append((math.cos(a) * r, math.sin(a) * r))
    top = [bm.verts.new((x, 0.01, z)) for x, z in pts]
    bot = [bm.verts.new((x, -0.01, z)) for x, z in pts]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    for i in range(10):
        j = (i + 1) % 10
        bm.faces.new((top[i], bot[i], bot[j], top[j]))
    star = C.mesh_from_bmesh('star', bm)
    star.location = (0, 0, 0.33)
    C.apply_transform(star)
    C.set_material(star, m('WandStar', 0xff4a6a, 0.3, emit=0.8))
    parts.append(star)
    return join(parts, 'WAND')


@item('WARPSTONE')
def warpstone():
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.12, location=(0, 0, 0))
    o = _obj()
    o.scale = (0.8, 0.8, 1.4)
    C.apply_transform(o)
    for v in o.data.vertices:
        v.co += v.normal * noise.noise(v.co * 10) * 0.02
    C.set_material(o, m('Warp', 0x6af0ff, 0.1, 0.2, emit=1.5))
    return join([o], 'WARPSTONE')


# --- toys ----------------------------------------------------------------------------------------------

@item('BEACHBALL')
def beachball():
    cols = [0xf24a4a, 0xffffff, 0x3a8ae8, 0xffffff, 0xf2cf2a, 0xffffff]
    parts = []
    for i, col in enumerate(cols):
        s = sphere(0.14, (0, 0, 0.14), mat=m(f'Ball{i}', col, 0.4), seg=24, rings=14)
        bm = bmesh.new()
        bm.from_mesh(s.data)
        a0 = i / 6 * math.tau
        dele = []
        for v in bm.verts:
            a = (math.atan2(v.co.y, v.co.x) - a0) % math.tau
            if a > math.tau / 6 + 0.01:
                dele.append(v)
        bmesh.ops.delete(bm, geom=dele, context='VERTS')
        bm.to_mesh(s.data)
        bm.free()
        parts.append(s)
    return join(parts, 'BEACHBALL')


@item('SQUEAKTOY')
def squeaktoy():
    yellow = m('Duck', 0xffd23a, 0.35)
    parts = [sphere(0.08, (0, 0.02, 0.07), (1, 1.2, 0.8), yellow)]
    parts.append(sphere(0.05, (0, -0.06, 0.15), mat=yellow))
    parts.append(sphere(0.022, (0, -0.11, 0.14), (1, 1.3, 0.5), m('Beak', 0xf2902a, 0.4)))
    for side in (-1, 1):
        parts.append(sphere(0.009, (side * 0.025, -0.1, 0.17), mat=m('Eye', 0x141010, 0.2)))
    return join(parts, 'SQUEAKTOY')


@item('YOYO')
def yoyo():
    purple = m('Yoyo', 0x9b4de0, 0.35)
    parts = [cyl(0.07, 0.03, (-0.022, 0, 0.07), (0, math.pi / 2, 0), mat=purple, bev=0.01), cyl(0.07, 0.03, (0.022, 0, 0.07), (0, math.pi / 2, 0), mat=purple, bev=0.01)]
    parts.append(cyl(0.02, 0.02, (0, 0, 0.07), (0, math.pi / 2, 0), mat=gold()))
    parts.append(cyl(0.003, 0.2, (0, 0, 0.17), mat=m('String', 0xf6f6f6, 0.8)))
    return join(parts, 'YOYO')


@item('JACKINTHEBOX')
def jackinthebox():
    parts = [box((0.16, 0.16, 0.16), (0, 0, 0.08), mat=m('JackBox', 0x3a7fe8, 0.5), bev=0.012)]
    parts.append(box((0.17, 0.04, 0.17), (0, 0.08, 0.22), rot=(-0.9, 0, 0), mat=m('JackLid', 0xf24a4a, 0.5), bev=0.01))
    for i in range(4):
        parts.append(torus(0.035, 0.008, (0, 0, 0.17 + i * 0.025), mat=steel()))
    parts.append(sphere(0.05, (0, 0, 0.29), mat=m('JackFace', 0xf6e0c8, 0.5)))
    parts.append(cyl(0.05, 0.07, (0, 0, 0.36), mat=m('JackHat', 0xf2cf2a, 0.5), r2=0.0))
    return join(parts, 'JACKINTHEBOX')


@item('GOKART')
def gokart():
    red = m('Kart', 0xe03a2a, 0.35, 0.2)
    parts = [box((0.22, 0.34, 0.06), (0, 0, 0.08), mat=red, bev=0.02)]
    parts.append(box((0.18, 0.08, 0.1), (0, 0.12, 0.14), mat=red, bev=0.02))
    for x, y in ((-0.13, -0.11), (0.13, -0.11), (-0.13, 0.11), (0.13, 0.11)):
        parts.append(cyl(0.05, 0.04, (x, y, 0.05), (0, math.pi / 2, 0), mat=m('Tire', 0x202020, 0.8), bev=0.01))
    parts.append(torus(0.04, 0.008, (0, -0.08, 0.17), (1.1, 0, 0), mat=dark_steel()))
    return join(parts, 'GOKART')


@item('BIGWHEEL')
def bigwheel():
    parts = [torus(0.14, 0.045, (0, 0, 0.15), (0, math.pi / 2, 0), mat=m('Tire', 0x202020, 0.8))]
    parts.append(cyl(0.1, 0.04, (0, 0, 0.15), (0, math.pi / 2, 0), mat=m('Hub', 0xe03a2a, 0.4)))
    parts.append(box((0.03, 0.03, 0.18), (0, 0.06, 0.26), mat=m('Hub', 0xe03a2a)))
    return join(parts, 'BIGWHEEL')


@item('BABYWALKER')
def babywalker():
    parts = [torus(0.13, 0.03, (0, 0, 0.16), mat=m('Walker', 0x7ad0f0, 0.4))]
    for i in range(4):
        a = i / 4 * math.tau + math.pi / 4
        parts.append(cyl(0.012, 0.15, (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.08), mat=m('WalkerLeg', 0xf2f2f2, 0.4)))
        parts.append(sphere(0.02, (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.015), mat=m('Tire', 0x202020, 0.8)))
    return join(parts, 'BABYWALKER')


@item('JUMPROPE')
def jumprope():
    parts = [torus(0.12, 0.006, (0, 0, 0.12), (math.pi / 2, 0, 0), mat=m('Rope', 0xf25a9a, 0.7))]
    for side in (-1, 1):
        parts.append(cyl(0.015, 0.07, (side * 0.12, 0, 0.05), mat=wood()))
    return join(parts, 'JUMPROPE')


@item('POGOSTICK')
def pogostick():
    parts = [cyl(0.013, 0.4, (0, 0, 0.2), mat=m('Pogo', 0x3ac04a, 0.4))]
    parts.append(box((0.14, 0.03, 0.015), (0, 0, 0.1), mat=dark_steel()))
    parts.append(box((0.14, 0.025, 0.02), (0, 0, 0.39), mat=m('Grip', 0x202020, 0.8)))
    parts.append(cyl(0.02, 0.05, (0, 0, 0.02), mat=m('Tire', 0x202020, 0.8)))
    return join(parts, 'POGOSTICK')


@item('SCROLL')
def scroll():
    parts = [cyl(0.035, 0.18, (0, 0, 0.05), (0, math.pi / 2, 0), mat=m('Paper', 0xf4e8c8, 0.8))]
    for side in (-1, 1):
        parts.append(cyl(0.012, 0.04, (side * 0.1, 0, 0.05), (0, math.pi / 2, 0), mat=dark_wood()))
        parts.append(sphere(0.017, (side * 0.12, 0, 0.05), mat=dark_wood()))
    parts.append(torus(0.037, 0.006, (0, 0, 0.05), (0, math.pi / 2, 0), mat=m('Seal', 0xc8282a, 0.5)))
    return join(parts, 'SCROLL')


# --- powerups (the original's spinning icons) -------------------------------------------------------------

@item('GHOST')
def ghost():
    stone = m('Grave', 0xb8b8c4, 0.8)
    parts = [box((0.14, 0.05, 0.16), (0, 0, 0.1), mat=stone, bev=0.01)]
    parts.append(cyl(0.07, 0.05, (0, 0, 0.18), (math.pi / 2, 0, 0), mat=stone))
    parts.append(box((0.07, 0.01, 0.012), (0, -0.028, 0.16), mat=m('GraveDark', 0x505060, 0.8), bev=0))
    parts.append(box((0.012, 0.01, 0.06), (0, -0.028, 0.155), mat=m('GraveDark', 0x505060), bev=0))
    return join(parts, 'GHOST')


@item('SUPERSPEED')
def superspeed():
    parts = [torus(0.1, 0.02, (0, 0, 0.12), (math.pi / 2, 0, 0), mat=m('Speed', 0x3ad8f2, 0.3, 0.3, emit=0.6))]
    for i in range(8):
        a = i / 8 * math.tau
        parts.append(cyl(0.008, 0.1, (math.cos(a) * 0.05, 0, 0.12 + math.sin(a) * 0.05), (0, -a + math.pi / 2, 0), mat=steel()))
    parts.append(sphere(0.02, (0, 0, 0.12), mat=gold()))
    return join(parts, 'SUPERSPEED')


@item('INVULNERABILITY')
def invulnerability():
    crest = m('Crest', 0xf2d83a, 0.3, 0.8)
    bm = bmesh.new()
    pts = [(-0.09, 0.2), (0.09, 0.2), (0.09, 0.08), (0.0, -0.02), (-0.09, 0.08)]
    top = [bm.verts.new((x, 0.015, z)) for x, z in pts]
    bot = [bm.verts.new((x, -0.015, z)) for x, z in pts]
    bm.faces.new(top)
    bm.faces.new(list(reversed(bot)))
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((top[i], bot[i], bot[j], top[j]))
    o = C.mesh_from_bmesh('crest', bm)
    mod = o.modifiers.new('b', 'BEVEL')
    mod.width = 0.01
    mod.segments = 2
    C.apply_modifiers(o)
    C.set_material(o, crest)
    band = box((0.02, 0.035, 0.2), (0, -0.005, 0.1), mat=m('CrestRed', 0xd8282a, 0.4), bev=0)
    return join([o, band], 'INVULNERABILITY')


@item('CONVERSION')
def conversion():
    parts = [cyl(0.01, 0.26, (0, 0, 0.13), mat=wood())]
    parts.append(box((0.18, 0.015, 0.11), (0, -0.01, 0.23), mat=m('Sign', 0xf6f0e0, 0.7), bev=0.005))
    parts.append(box((0.12, 0.005, 0.02), (0, -0.02, 0.24), mat=m('SignInk', 0xd8282a, 0.5), bev=0))
    return join(parts, 'CONVERSION')


@item('DEATHTOUCH')
def deathtouch():
    parts = [cyl(0.012, 0.22, (0, 0, 0.1), mat=dark_wood())]
    bm = bmesh.new()
    arc = []
    for i in range(16):
        t = i / 15
        a = math.pi * 0.1 + t * math.pi * 0.8
        r = 0.12
        arc.append((math.cos(a) * r - 0.0, math.sin(a) * r * 0.8 + 0.08, 0.035 * (1 - t) + 0.004))
    top = [bm.verts.new((x, 0.004, z + 0.14)) for x, z, w in [(p[0], p[1], p[2]) for p in arc]]
    # simple ribbon blade
    o_verts = []
    for x, z, w in arc:
        o_verts.append((bm.verts.new((x, -0.004, z + 0.14)), bm.verts.new((x * 0.85, -0.004, z + 0.14 - w))))
    for i in range(len(o_verts) - 1):
        a0, b0 = o_verts[i]
        a1, b1 = o_verts[i + 1]
        bm.faces.new((a0, a1, b1, b0))
    blade = C.mesh_from_bmesh('blade', bm)
    mod = blade.modifiers.new('s', 'SOLIDIFY')
    mod.thickness = 0.008
    C.apply_modifiers(blade)
    C.set_material(blade, m('Sickle', 0x9aa4b4, 0.3, 0.9))
    parts.append(blade)
    return join(parts, 'DEATHTOUCH')


@item('ROIDZ')
def roidz():
    parts = [sphere(0.045, (0, 0, 0.12), (1, 1, 1.9), m('PillA', 0xe03a3a, 0.3))]
    half = parts[0]
    bm = bmesh.new()
    bm.from_mesh(half.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.119], context='VERTS')
    bm.to_mesh(half.data)
    bm.free()
    other = sphere(0.045, (0, 0, 0.12), (1, 1, 1.9), m('PillB', 0xf6f6f6, 0.3))
    bm = bmesh.new()
    bm.from_mesh(other.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 0.121], context='VERTS')
    bm.to_mesh(other.data)
    bm.free()
    o = join([half, other], 'ROIDZ')
    o.rotation_euler = Euler((0, 0.6, 0))
    C.apply_transform(o)
    return o


@item('REACTIVEARMOR')
def reactivearmor():
    armor = m('Armor', 0xaab4c4, 0.3, 0.85)
    parts = [sphere(0.08, (0, 0, 0.1), (1, 0.7, 1.1), armor)]
    parts.append(sphere(0.045, (0, 0, 0.22), (1, 1, 1.1), armor))
    for side in (-1, 1):
        parts.append(sphere(0.035, (side * 0.085, 0, 0.16), mat=armor))
    parts.append(box((0.05, 0.01, 0.012), (0, -0.045, 0.22), mat=m('Visor', 0x202028, 0.3), bev=0))
    return join(parts, 'REACTIVEARMOR')


# --- utilities & rewards ------------------------------------------------------------------------------------

@item('MEGAPHONE')
def megaphone():
    parts = [cyl(0.08, 0.2, (0, -0.02, 0.1), (math.pi / 2, 0, 0), mat=m('Mega', 0xe8e8f0, 0.3, 0.5), r2=0.025, verts=24)]
    parts.append(torus(0.08, 0.01, (0, -0.12, 0.1), (math.pi / 2, 0, 0), mat=m('MegaRed', 0xe03a2a, 0.4)))
    parts.append(box((0.025, 0.03, 0.07), (0, 0.04, 0.05), mat=m('Grip', 0x202020, 0.8)))
    return join(parts, 'MEGAPHONE')


@item('HEALTH1')
def zap_can():
    parts = [cyl(0.045, 0.12, (0, 0, 0.06), mat=m('Can', 0xe03a3a, 0.3, 0.6), bev=0.006)]
    parts.append(cyl(0.04, 0.004, (0, 0, 0.12), mat=steel()))
    parts.append(box((0.002, 0.07, 0.04), (0.046, 0, 0.06), rot=(0, 0, math.pi / 2), mat=m('Label', 0xf6f6f6, 0.5), bev=0))
    return join(parts, 'HEALTH1')


@item('HEALTH2')
def zap_bottle():
    parts = [cyl(0.05, 0.16, (0, 0, 0.08), mat=m('Bottle', 0xe03a3a, 0.2, 0.1), bev=0.01)]
    parts.append(cyl(0.05, 0.06, (0, 0, 0.19), mat=m('Bottle', 0xe03a3a), r2=0.018))
    parts.append(cyl(0.02, 0.02, (0, 0, 0.23), mat=m('Cap', 0xf6f6f6, 0.4)))
    return join(parts, 'HEALTH2')


@item('HEALTH3')
def zap_keg():
    parts = [cyl(0.11, 0.2, (0, 0, 0.1), mat=m('Keg', 0x9a6a3a, 0.7), bev=0.02)]
    for z in (0.03, 0.17):
        parts.append(torus(0.112, 0.01, (0, 0, z), mat=dark_steel()))
    parts.append(cyl(0.02, 0.03, (0, -0.11, 0.06), (math.pi / 2, 0, 0), mat=gold()))
    parts.append(box((0.002, 0.08, 0.06), (0.0, -0.112, 0.12), rot=(0, 0, math.pi / 2), mat=m('Label', 0xf6f6f6, 0.5), bev=0))
    return join(parts, 'HEALTH3')


@item('STOPWATCH')
def stopwatch():
    parts = [cyl(0.09, 0.03, (0, 0, 0.1), (math.pi / 2, 0, 0), verts=32, mat=m('Watch', 0xd8d8e0, 0.25, 0.8), bev=0.01)]
    parts.append(cyl(0.075, 0.01, (0, -0.016, 0.1), (math.pi / 2, 0, 0), verts=32, mat=m('WatchFace', 0xf6f6f0, 0.4)))
    parts.append(cyl(0.012, 0.04, (0, 0, 0.21), mat=steel()))
    parts.append(box((0.005, 0.004, 0.06), (0, -0.023, 0.12), mat=m('Hand', 0x202020), bev=0))
    return join(parts, 'STOPWATCH')


@item('TOYBOX')
def toybox():
    parts = [box((0.28, 0.28, 0.2), (0, 0, 0.1), mat=m('ToyboxBox', 0xf2902a, 0.6), bev=0.015)]
    parts.append(box((0.3, 0.3, 0.05), (0, 0, 0.22), mat=m('ToyboxLid', 0xe03a2a, 0.6), bev=0.015))
    parts.append(box((0.06, 0.305, 0.255), (0, 0, 0.125), mat=m('Ribbon', 0xf2cf2a, 0.5), bev=0.004))
    parts.append(box((0.305, 0.06, 0.255), (0, 0, 0.125), mat=m('Ribbon', 0xf2cf2a), bev=0.004))
    return join(parts, 'TOYBOX')


@item('COIN')
def coin():
    parts = [cyl(0.09, 0.02, (0, 0, 0.1), (math.pi / 2, 0, 0), verts=32, mat=gold(), bev=0.006)]
    parts.append(cyl(0.06, 0.024, (0, 0, 0.1), (math.pi / 2, 0, 0), verts=32, mat=m('GoldDark', 0xd89a20, 0.3, 0.9)))
    return join(parts, 'COIN')


def letter_item(ch):
    curve = bpy.data.curves.new(f'letter_{ch}', 'FONT')
    curve.body = ch
    curve.extrude = 0.02
    curve.bevel_depth = 0.005
    curve.size = 0.2
    curve.align_x = 'CENTER'
    o = bpy.data.objects.new(f'letter_{ch}', curve)
    bpy.context.collection.objects.link(o)
    o.rotation_euler = Euler((math.pi / 2, 0, 0))
    o.location = (0, 0, 0.05)
    C.select_only(o)
    bpy.ops.object.convert(target='MESH')
    o = _obj()
    C.apply_transform(o)
    C.set_material(o, gold())
    return join([o], f'SECRET_{ch}')


for ch in 'WARP':
    ITEMS.append((f'SECRET_{ch}', (lambda c: lambda: letter_item(c))(ch)))


# --- build ----------------------------------------------------------------------------------------------------

def render_icons(objs):
    os.makedirs(ICON_DIR, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = 128
    scene.render.resolution_y = 128
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('icons')
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    light = bpy.data.lights.new('key', 'SUN')
    light.energy = 3.5
    lo = bpy.data.objects.new('key', light)
    lo.rotation_euler = Euler((math.radians(50), 0, math.radians(30)))
    scene.collection.objects.link(lo)
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    co = bpy.data.objects.new('cam', cam)
    scene.collection.objects.link(co)
    scene.camera = co
    for o in objs:
        o.hide_render = True
    for o in objs:
        o.hide_render = False
        o.location = (0, 0, 0)
        bpy.context.view_layer.update()
        corners = [o.matrix_world @ Vector(c) for c in o.bound_box]
        mn = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
        mx = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
        center = (mn + mx) / 2
        size = max((mx - mn).length, 0.05)
        cam.ortho_scale = size * 1.1
        direction = Vector((0.55, -1.0, 0.65)).normalized()
        co.location = center + direction * 3
        co.rotation_euler = (center - co.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(ICON_DIR, f'{o.name}.png')
        bpy.ops.render.render(write_still=True)
        o.hide_render = True
    for o in objs:
        o.hide_render = False


if __name__ == '__main__':
    C.reset_scene()
    objs = []
    for name, fn in ITEMS:
        o = fn()
        o.name = name
        o.data.name = name
        objs.append(o)
    print('ITEMS', len(objs), sum(C.tri_count(o) for o in objs))
    for i, o in enumerate(objs):
        o.location = (0, 0, 0)
    path = C.export_glb('items', objects=objs)
    print('EXPORTED', path)
    if C.arg('icons'):
        render_icons(objs)
        print('ICONS', ICON_DIR)
