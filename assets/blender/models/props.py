"""Level props: fort (with the King on top), grunt creation pad, wormhole, checkpoint flag,
rolling 8-ball. Exports apps/client/public/models/props.glb.

Materials named Team* are tinted with the owner's team colour in game.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Vector, noise

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as C  # noqa: E402
sys.path.insert(0, os.path.dirname(__file__))
from items import box, cyl, join, m, sphere, torus, gold, steel, wood, dark_wood  # noqa: E402
from mathutils import Vector  # noqa: E402,F811

PROPS = []


def prop(name):
    def deco(fn):
        PROPS.append((name, fn))
        return fn
    return deco


def stone():
    return m('FortStone', 0xc8b89c, 0.85)


def dark_stone():
    return m('FortStoneDark', 0x9a8a72, 0.9)


def team():
    return m('TeamColor', 0xffffff, 0.55)


def stones_ring(radius, z, count, h, mat, rng, jitter=0.01):
    parts = []
    for i in range(count):
        a = i / count * math.tau
        w = 2 * math.pi * radius / count * 0.92
        b = box((w, 0.12, h), (math.cos(a) * radius, math.sin(a) * radius, z), rot=(0, 0, a + math.pi / 2), mat=mat, bev=0.012)
        b.location.z += rng.uniform(-jitter, jitter)
        parts.append(b)
    return parts


def tower(x, y, rng, height=1.0, r=0.28):
    parts = [cyl(r, height, (x, y, height / 2), verts=16, mat=stone(), bev=0.02)]
    for k in range(3):
        parts += stones_ring(r + 0.005, 0.15 + k * 0.3, 10, 0.08, dark_stone(), rng)
    # crenellations
    for i in range(6):
        a = i / 6 * math.tau
        parts.append(box((0.1, 0.1, 0.12), (x + math.cos(a) * (r - 0.02), y + math.sin(a) * (r - 0.02), height + 0.06), rot=(0, 0, a), mat=stone(), bev=0.01))
    roof = cyl(r + 0.06, 0.45, (x, y, height + 0.34), verts=16, mat=team(), r2=0.0)
    parts.append(roof)
    return parts


@prop('fort')
def fort():
    rng = random.Random(3)
    parts = []
    # base platform (3x3 tiles, the centre is the keep)
    parts.append(box((2.2, 2.2, 0.16), (0, 0, 0.08), mat=dark_stone(), bev=0.04))
    # keep
    parts.append(box((1.1, 1.1, 0.9), (0, 0, 0.55), mat=stone(), bev=0.04))
    for z in (0.35, 0.65):
        parts.append(box((1.14, 1.14, 0.06), (0, 0, z), mat=dark_stone(), bev=0.01))
    # gate facing south (-Y is front in Blender)
    parts.append(box((0.36, 0.08, 0.5), (0, -0.56, 0.35), mat=dark_wood(), bev=0.02))
    parts.append(cyl(0.18, 0.08, (0, -0.56, 0.6), (math.pi / 2, 0, 0), verts=16, mat=dark_wood()))
    for i in range(4):
        a = i / 4 * math.tau + math.pi / 4
        parts += tower(math.cos(a) * 0.62, math.sin(a) * 0.62, rng, height=1.15, r=0.24)
    # banners
    for side in (-1, 1):
        parts.append(box((0.2, 0.02, 0.36), (side * 0.3, -0.56, 0.72), mat=team(), bev=0.005))
    # the King on top of the keep: a fat crowned grunt on a throne
    parts.append(box((0.34, 0.3, 0.1), (0, 0.1, 1.05), mat=m('Throne', 0x8a2a2a, 0.6), bev=0.02))
    parts.append(box((0.34, 0.06, 0.32), (0, 0.24, 1.2), mat=m('Throne', 0x8a2a2a), bev=0.02))
    king = m('KingSkin', 0xe0a070, 0.7)
    parts.append(sphere(0.14, (0, 0.06, 1.18), (1, 0.9, 1), king))
    parts.append(sphere(0.12, (0, 0.03, 1.38), mat=king))
    parts.append(sphere(0.035, (0, -0.09, 1.37), mat=king))
    for side in (-1, 1):
        ear = cyl(0.04, 0.16, (side * 0.17, 0.05, 1.42), (0, side * 1.2, 0), mat=king, r2=0.0, verts=8)
        parts.append(ear)
        parts.append(sphere(0.02, (side * 0.045, -0.09, 1.41), mat=m('KingEye', 0x141010, 0.2)))
    crown = cyl(0.08, 0.06, (0, 0.03, 1.5), verts=10, mat=gold())
    parts.append(crown)
    for i in range(5):
        a = i / 5 * math.tau
        parts.append(cyl(0.015, 0.05, (math.cos(a) * 0.07, 0.03 + math.sin(a) * 0.07, 1.55), mat=gold(), r2=0.0, verts=6))
    parts.append(torus(0.16, 0.035, (0, 0.06, 1.12), mat=m('Robe', 0x9a2a3a, 0.7)))
    return join(parts, 'fort')


@prop('pad')
def creation_pad():
    parts = [cyl(0.44, 0.06, (0, 0, 0.03), verts=6, mat=dark_stone(), bev=0.015)]
    parts.append(cyl(0.36, 0.03, (0, 0, 0.07), verts=6, mat=team(), bev=0.01))
    parts.append(cyl(0.14, 0.035, (0, 0, 0.085), verts=24, mat=m('PadGlow', 0xfff0c0, 0.3, emit=0.4)))
    for i in range(6):
        a = i / 6 * math.tau
        parts.append(sphere(0.025, (math.cos(a) * 0.4, math.sin(a) * 0.4, 0.07), mat=steel()))
    return join(parts, 'pad')


@prop('wormhole')
def wormhole():
    parts = [torus(0.36, 0.05, (0, 0, 0.05), mat=m('WormRim', 0x6a6a78, 0.4, 0.6))]
    for i in range(8):
        a = i / 8 * math.tau
        parts.append(box((0.08, 0.05, 0.05), (math.cos(a) * 0.36, math.sin(a) * 0.36, 0.1), rot=(0, 0, a), mat=gold(), bev=0.01))
    disc = cyl(0.32, 0.01, (0, 0, 0.04), verts=32, mat=m('WormSwirl', 0xffffff, 0.2, emit=1.0))
    parts.append(disc)
    return join(parts, 'wormhole')


@prop('flag')
def checkpoint_flag():
    parts = [cyl(0.025, 1.3, (0, 0, 0.65), mat=steel())]
    parts.append(sphere(0.04, (0, 0, 1.32), mat=gold()))
    parts.append(cyl(0.12, 0.05, (0, 0, 0.025), mat=m('FlagBase', 0x6a6a72, 0.8), bev=0.01))
    # checkered cloth (separate object so it can slide up the pole)
    bm = bmesh.new()
    cols, rows = 6, 4
    grid = []
    for r in range(rows + 1):
        row = []
        for c in range(cols + 1):
            x = 0.03 + c * 0.075
            z = -r * 0.075
            y = 0.03 * math.sin(c * 1.2)
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    faces = []
    for r in range(rows):
        for c in range(cols):
            f = bm.faces.new((grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]))
            f.material_index = (r + c) % 2
    cloth = C.mesh_from_bmesh('flag_cloth', bm)
    cloth.data.materials.append(m('CheckWhite', 0xf6f6f6, 0.7))
    cloth.data.materials.append(m('CheckBlack', 0x1a1a1a, 0.7))
    sol = cloth.modifiers.new('s', 'SOLIDIFY')
    sol.thickness = 0.01
    C.apply_modifiers(cloth)
    cloth.location = (0, 0, 1.2)
    C.apply_transform(cloth)
    cloth.name = 'flag_cloth'
    pole = join(parts, 'flag')
    return [pole, cloth]


@prop('ball')
def eight_ball():
    parts = [sphere(0.42, (0, 0, 0.42), mat=m('Ball8', 0x16161c, 0.15, 0.2), seg=32, rings=20)]
    spot = cyl(0.16, 0.02, (0, -0.415, 0.5), (math.pi / 2 - 0.2, 0, 0), verts=24, mat=m('BallSpot', 0xf6f6f0, 0.3))
    parts.append(spot)
    curve = bpy.data.curves.new('eight', 'FONT')
    curve.body = '8'
    curve.size = 0.2
    curve.extrude = 0.012
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    o = bpy.data.objects.new('eight', curve)
    bpy.context.collection.objects.link(o)
    o.rotation_euler = Euler((math.pi / 2 - 0.2, 0, 0))
    o.location = (0, -0.43, 0.505)
    C.select_only(o)
    bpy.ops.object.convert(target='MESH')
    txt = bpy.context.active_object
    C.apply_transform(txt)
    C.set_material(txt, m('Ball8Text', 0x16161c, 0.3))
    parts.append(txt)
    return join(parts, 'ball')


def rock_mesh(name, radius, loc, scale=(1, 1, 1), seed=0, subdiv=2, amp=0.18, mat=None, flat=True, grounded=True, cuts=7):
    """Low-poly clay rock: a lumpy icosphere sliced by random planes into big flat facets."""
    rng = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    offset = Vector((rng.uniform(0, 50), rng.uniform(0, 50), rng.uniform(0, 50)))
    for v in bm.verts:
        n = v.co.normalized()
        v.co += n * noise.noise(v.co * (1.6 / radius) + offset) * amp * radius
    for _ in range(cuts):
        # random slicing planes (not from below, rocks keep a broad base)
        z = rng.uniform(-0.25, 1.0)
        a = rng.uniform(0, math.tau)
        r = math.sqrt(max(0.0, 1 - z * z))
        nrm = Vector((math.cos(a) * r, math.sin(a) * r, z)).normalized()
        co = nrm * radius * rng.uniform(0.7, 0.9)
        res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=nrm, clear_outer=True)
        edges = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    for v in bm.verts:
        v.co.x *= scale[0]
        v.co.y *= scale[1]
        v.co.z *= scale[2]
    if grounded:
        floor = -radius * scale[2] * 0.3
        for v in bm.verts:
            if v.co.z < floor:
                v.co.z = floor + (v.co.z - floor) * 0.1
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    o = C.mesh_from_bmesh(name, bm)
    o.location = loc
    if grounded:
        o.location.z += radius * scale[2] * 0.3
    C.apply_transform(o)
    if not flat:
        C.shade_smooth(o)
    if mat:
        C.set_material(o, mat)
    return o


def strata(obj, period=0.16, depth=0.12, seed=0):
    """Darken the baked AO colours in horizontal bands: layered sandstone."""
    me = obj.data
    col = me.color_attributes.get('Col')
    if not col:
        return
    rng = random.Random(seed)
    phase = rng.uniform(0, math.tau)
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            k = 1.0 - depth * (0.5 + 0.5 * math.sin(v.co.z / period * math.tau + phase + v.co.x * 0.8))
            c = col.data[li].color
            col.data[li].color = (c[0] * k, c[1] * k, c[2] * k, 1.0)


def theme_rock():
    return m('ThemeRock', 0xffffff, 0.92)


def theme_rock_dark():
    return m('ThemeRockDark', 0xb8b0a4, 0.95)


@prop('giantRock')
def giant_rock():
    """3x3 tile boulder heap (centre at the origin)."""
    rng = random.Random(11)
    parts = [rock_mesh('gr_main', 1.05, (0.05, 0.1, 0), (1.25, 1.1, 1.05), seed=3, subdiv=3, amp=0.2, mat=theme_rock())]
    parts.append(rock_mesh('gr_top', 0.55, (-0.35, -0.2, 1.05), (1.1, 1.0, 0.8), seed=5, subdiv=2, amp=0.22, mat=theme_rock()))
    for i, (x, y, r) in enumerate([(-1.05, -0.95, 0.42), (1.15, -0.8, 0.5), (-1.2, 0.85, 0.46), (1.1, 1.05, 0.38), (0.1, -1.2, 0.36)]):
        parts.append(rock_mesh(f'gr_side{i}', r, (x, y, 0), (1.15, 1.0, 0.85), seed=20 + i, subdiv=2, amp=0.2, mat=theme_rock_dark()))
    for i in range(14):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(1.1, 1.45)
        parts.append(rock_mesh(f'gr_peb{i}', rng.uniform(0.06, 0.13), (math.cos(a) * d, math.sin(a) * d, 0), seed=40 + i, subdiv=1, amp=0.25, mat=theme_rock_dark()))
    return join(parts, 'giantRock')


@prop('boulder')
def boulder():
    """Rolling boulder of doom (same size and centre as the 8-ball): a round, water-worn stone
    with a few soft flats and shallow dents, nothing that sticks out."""
    rng = random.Random(7)
    R = 0.42
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=4, radius=R)
    off = Vector((3.1, 7.7, 1.3))
    flats = []
    for _ in range(6):
        z = rng.uniform(-1, 1)
        a = rng.uniform(0, math.tau)
        r = math.sqrt(1 - z * z)
        flats.append((Vector((math.cos(a) * r, math.sin(a) * r, z)), math.cos(math.radians(rng.uniform(28, 38))), rng.uniform(0.05, 0.09)))
    dents = []
    for _ in range(7):
        z = rng.uniform(-1, 1)
        a = rng.uniform(0, math.tau)
        r = math.sqrt(1 - z * z)
        dents.append((Vector((math.cos(a) * r, math.sin(a) * r, z)), rng.uniform(0.1, 0.18), rng.uniform(0.015, 0.03)))
    for v in bm.verts:
        n = v.co.normalized()
        rad = R + noise.noise(n * 2.2 + off) * 0.022 + noise.noise(n * 6.0 + off * 2) * 0.006
        for d, c, depth in flats:
            t = n.dot(d)
            if t > c:
                # soft flat: pushes in smoothly, no ridge
                k = (t - c) / (1 - c)
                rad -= depth * k * k * (3 - 2 * k) * 0.8
        for d, size, depth in dents:
            dist = (n - d).length
            if dist < size:
                k = 1 - dist / size
                rad -= depth * k * k
        v.co = n * rad
    o = C.mesh_from_bmesh('boulder', bm)
    o.location = (0, 0, R)
    C.apply_transform(o)
    C.shade_smooth(o)
    C.set_material(o, theme_rock())
    return o


if __name__ == '__main__':
    C.reset_scene()
    objs = []
    for name, fn in PROPS:
        o = fn()
        objs += o if isinstance(o, list) else [o]
    # rocks get baked AO + sandstone banding in their vertex colours (bake each alone)
    rocks = [o for o in objs if o.name in ('giantRock', 'boulder')]
    for i, o in enumerate(rocks):
        o.location = (50 + i * 10, 50, 0)
    C.bake_vertex_ao(rocks, samples=32)
    for i, o in enumerate(rocks):
        strata(o, seed=i)
    for o in objs:
        o.location = (0, 0, 0) if o.name != 'flag_cloth' else o.location
    print('PROPS', len(objs), sum(C.tri_count(o) for o in objs))
    path = C.export_glb('props', objects=objs, vertex_colors=True)
    print('EXPORTED', path)
    if C.arg('preview'):
        for i, o in enumerate(objs):
            if o.name == 'flag_cloth':
                o.location.x = [p for p in objs if p.name == 'flag'][0].location.x
                continue
            o.location.x = i * 2.6 - 4
        cloth = bpy.data.objects.get('flag_cloth')
        flag = bpy.data.objects.get('flag')
        if cloth and flag:
            cloth.location.x = flag.location.x
        cam, target, dist, h = C.setup_preview(target=(1, 0, 0.6), distance=9, height=4, size=1024)
        C.render_views('props', cam, target, dist, h, angles=(20,))
