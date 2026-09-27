"""Terrain kit: modular tile pieces for all themes (recoloured in game). Exports
apps/client/public/models/terrain.glb, one object per piece, named by piece key.

Conventions: 1 tile = 1 unit, piece origin at the tile centre on the ground plane
(z = 0 is the walkable surface), Z up, "north" is +Y in Blender (-Z in three.js).
Materials are named by role (Grass, Rock, Dirt, Sand, Wood, Metal, Stone, Accent,
Bark, Leaf) and recoloured per theme; ambient occlusion is baked to vertex colours.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector, noise

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as C  # noqa: E402

MATS = {}


def mat(role):
    if role not in MATS and role.startswith('Fix_'):
        # Fixed colour decorations (candy, dice...): the game keeps their colour as is.
        MATS[role] = C.clay_material(role, C.hex_color(int(role[4:], 16)), roughness=0.6, bump=0)
    if role not in MATS:
        base = {
            'Grass': 0x8fbf5a,
            'Rock': 0x9c7a64,
            'Dirt': 0x7d5234,
            'Sand': 0xe0c894,
            'Crust': 0xc9a171,
            'Wood': 0x8f5f36,
            'Metal': 0x9aa3b0,
            'Stone': 0xb8b0a4,
            'Accent': 0xffffff,
            'Bark': 0x6a4428,
            'Leaf': 0x5fa040,
            'Dark': 0x1a120c,
            'Rope': 0xc8a878,
            'Ground': 0xc9a171,
            'Bed': 0xd8c08a,
            'Chasm': 0x9c5a3c,
        }[role]
        rough = 0.35 if role == 'Metal' else 0.9
        metal = 0.6 if role == 'Metal' else 0.0
        MATS[role] = C.clay_material(role, C.hex_color(base), roughness=rough, metallic=metal, bump=0)
    return MATS[role]


PIECES = []


def piece(name):
    def deco(fn):
        PIECES.append((name, fn))
        return fn
    return deco


# --- helpers -----------------------------------------------------------------------------

def new_obj(name, bm):
    o = C.mesh_from_bmesh(name, bm)
    return o


def cube(name, size, loc=(0, 0, 0), segments=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    if segments > 1:
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=segments - 1, use_grid_fill=True)
    return new_obj(name, bm)


def displace(obj, amount, scale=3.0, seed=0, mask=None, axis_mask=(1, 1, 1)):
    """Push vertices along their normals by fractal noise (rocky / lumpy surfaces)."""
    me = obj.data
    me.calc_normals_split() if hasattr(me, 'calc_normals_split') else None
    off = Vector((seed * 13.1, seed * 7.7, seed * 3.3))
    for v in me.vertices:
        if mask and not mask(v.co):
            continue
        n = noise.fractal((v.co + off) * scale, 0.6, 2.2, 4, noise_basis='PERLIN_ORIGINAL')
        d = v.normal * n * amount
        v.co += Vector((d.x * axis_mask[0], d.y * axis_mask[1], d.z * axis_mask[2]))


def subsurf(obj, levels=2, apply=True):
    m = obj.modifiers.new('sub', 'SUBSURF')
    m.levels = levels
    m.render_levels = levels
    if apply:
        C.apply_modifiers(obj)


def bevel(obj, width=0.02, segments=2):
    m = obj.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    C.apply_modifiers(obj)


def assign(obj, role):
    C.set_material(obj, mat(role))


def finish(obj, name, smooth=True):
    obj.name = name
    obj.data.name = name
    if smooth:
        C.shade_smooth(obj)
    return obj


def merge(objs, name):
    o = C.join(objs, name)
    return o


# --- ground-level pieces ------------------------------------------------------------------

@piece('rock')
def rock():
    return boulder('rock', 11, 0.42)


@piece('rockAlt')
def rock_alt():
    return boulder('rockAlt', 23, 0.4)


def boulder(name, seed, r):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=r, location=(0, 0, r * 0.72))
    o = bpy.context.active_object
    o.scale = (1.0, 0.9, 0.78)
    C.apply_transform(o)
    rng = random.Random(seed)
    # chunky facets + fine noise
    for v in o.data.vertices:
        n = noise.fractal(v.co * 3.2 + Vector((seed, seed * 2, 0)), 0.55, 2.0, 3)
        v.co += v.co.normalized() * n * 0.1
        if v.co.z < 0.02:
            v.co.z = max(v.co.z, -0.02)
    # flatten a couple of big facets for a chiselled look
    for _ in range(3):
        axis = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(0.2, 1))).normalized()
        cut = r * rng.uniform(0.55, 0.7)
        for v in o.data.vertices:
            d = (v.co - Vector((0, 0, r * 0.6))).dot(axis)
            if d > cut:
                v.co -= axis * (d - cut) * 0.85
    assign(o, 'Rock')
    # pebbles around the base
    parts = [o]
    for i in range(4):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.33, 0.45)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=rng.uniform(0.03, 0.06), location=(math.cos(a) * d, math.sin(a) * d, 0.01))
        p = bpy.context.active_object
        p.scale = (1, 1, 0.6)
        C.apply_transform(p)
        assign(p, 'Rock')
        parts.append(p)
    o = merge(parts, name)
    return finish(o, name)


@piece('mound')
def mound():
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.42, location=(0, 0, -0.06))
    o = bpy.context.active_object
    o.scale = (1, 1, 0.55)
    C.apply_transform(o)
    for v in o.data.vertices:
        if v.co.z < 0:
            v.co.z = 0
        v.co += v.normal * noise.fractal(v.co * 6, 0.6, 2, 3) * 0.03
    assign(o, 'Dirt')
    # scattered clods
    rng = random.Random(4)
    parts = [o]
    for i in range(6):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.3, 0.46)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=rng.uniform(0.025, 0.045), location=(math.cos(a) * d, math.sin(a) * d, 0.015))
        c = bpy.context.active_object
        assign(c, 'Dirt')
        parts.append(c)
    return finish(merge(parts, 'mound'), 'mound')


@piece('hole')
def hole():
    # crater: a ring of dirt around a dark pit
    bm = bmesh.new()
    rings = 5
    seg = 32
    radii = [0.43, 0.38, 0.31, 0.24, 0.1]
    heights = [0.0, 0.05, 0.02, -0.08, -0.5]
    verts = []
    for r, h in zip(radii, heights):
        row = []
        for i in range(seg):
            a = i / seg * math.tau
            jitter = 1 + 0.06 * noise.noise(Vector((math.cos(a) * 3, math.sin(a) * 3, r * 5)))
            row.append(bm.verts.new((math.cos(a) * r * jitter, math.sin(a) * r * jitter, h)))
        verts.append(row)
    for k in range(rings - 1):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((verts[k][i], verts[k][j], verts[k + 1][j], verts[k + 1][i]))
    bottom = bm.faces.new(list(reversed(verts[-1])))
    o = new_obj('hole', bm)
    o.data.materials.append(mat('Dirt'))
    o.data.materials.append(mat('Dark'))
    for p in o.data.polygons:
        p.material_index = 1 if min(o.data.vertices[v].co.z for v in p.vertices) < -0.07 else 0
    return finish(o, 'hole')


@piece('spikes')
def spikes():
    parts = []
    base = cube('spike_base', (0.86, 0.86, 0.05), (0, 0, 0.025))
    bevel(base, 0.012, 2)
    assign(base, 'Metal')
    parts.append(base)
    for x in (-0.28, 0.0, 0.28):
        for y in (-0.28, 0.0, 0.28):
            if (x == 0) != (y == 0) and abs(x) + abs(y) > 0:
                continue
            bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.075, radius2=0.004, depth=0.32, location=(x, y, 0.21))
            sp = bpy.context.active_object
            assign(sp, 'Metal')
            parts.append(sp)
    return finish(merge(parts, 'spikes'), 'spikes', smooth=False)


@piece('pad')
def pad():
    base = cube('pad_plate', (0.9, 0.9, 0.06), (0, 0, 0.03))
    bevel(base, 0.015, 2)
    assign(base, 'Metal')
    parts = [base]
    for x in (-0.37, 0.37):
        for y in (-0.37, 0.37):
            bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=6, radius=0.025, location=(x, y, 0.06))
            r = bpy.context.active_object
            assign(r, 'Metal')
            parts.append(r)
    # cross grooves
    for rot in (0, math.pi / 2):
        g = cube('groove', (0.7, 0.03, 0.01), (0, 0, 0.061))
        g.rotation_euler = Euler((0, 0, rot))
        C.apply_transform(g)
        assign(g, 'Dark')
        parts.append(g)
    return finish(merge(parts, 'pad'), 'pad', smooth=False)


@piece('brick')
def brick():
    # one layer of a brick stack (0.3 high), coloured per layer in game
    parts = []
    rows = 2
    for r in range(rows):
        z = 0.075 + r * 0.15
        offset = 0.0 if r % 2 == 0 else 0.22
        xs = [-0.33 + offset, 0.11 + offset] if r % 2 == 0 else [-0.44 + 0.22, 0.0 + 0.22 - 0.22]
        for i, x in enumerate((-0.22, 0.22) if r % 2 == 0 else (-0.33, 0.0, 0.33)):
            w = 0.43 if r % 2 == 0 else (0.22 if i != 1 else 0.43)
            b = cube('b', (w - 0.02, 0.86, 0.14), (x if r % 2 == 0 else x, 0, z))
            bevel(b, 0.018, 2)
            assign(b, 'Accent')
            parts.append(b)
    return finish(merge(parts, 'brick'), 'brick')


@piece('crumble')
def crumble():
    """Crumbling ground: a cracked, dried-out crust sitting on a rocky chunk that hangs
    down (it reads as a stone ledge when it spans an abyss)."""
    rng = random.Random(7)
    parts = []
    # the crust is broken into a few plates with small gaps between them
    plates = [(-0.26, -0.2, 0.42, 0.54), (0.2, -0.26, 0.5, 0.42), (-0.2, 0.28, 0.54, 0.38), (0.28, 0.2, 0.38, 0.54)]
    for i, (x, y, w, h) in enumerate(plates):
        p = cube('plate', (w, h, 0.09), (x, y, -0.03), segments=3)
        displace(p, 0.012, 7, seed=10 + i)
        for v in p.data.vertices:
            if v.co.z > 0:
                v.co.z += rng.uniform(-0.012, 0.01)
        bevel(p, 0.015, 1)
        assign(p, 'Crust')
        parts.append(p)
    # rocky underside hanging below the crust
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=8, radius1=0.5, radius2=0.12, depth=0.9)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Euler((math.pi, 0, math.pi / 8)).to_matrix())
    bmesh.ops.translate(bm, vec=Vector((0, 0, -0.52)), verts=bm.verts)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=2, use_grid_fill=True)
    chunk = new_obj('chunk', bm)
    for v in chunk.data.vertices:
        v.co.x *= 1.35
        v.co.y *= 1.35
    displace(chunk, 0.12, 3.5, seed=21)
    assign(chunk, 'Rock')
    parts.append(chunk)
    # dark cracks along the plate gaps
    for x0, y0, x1, y1 in [(-0.48, 0.0, 0.48, 0.0), (0.0, -0.48, 0.0, 0.48)]:
        steps = 5
        for k in range(steps):
            ax = x0 + (x1 - x0) * k / steps
            ay = y0 + (y1 - y0) * k / steps
            bx = x0 + (x1 - x0) * (k + 1) / steps
            by = y0 + (y1 - y0) * (k + 1) / steps
            jx, jy = rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03)
            length = math.hypot(bx - ax, by - ay)
            c = cube('crack', (length + 0.02, 0.035, 0.03), ((ax + bx) / 2 + jx, (ay + by) / 2 + jy, 0.0))
            c.rotation_euler = Euler((0, 0, math.atan2(by - ay, bx - ax)))
            C.apply_transform(c)
            assign(c, 'Dark')
            parts.append(c)
    return finish(merge(parts, 'crumble'), 'crumble', smooth=False)


@piece('bridge')
def bridge():
    parts = []
    for i in range(6):
        x = -0.42 + i * 0.168
        p = cube('plank', (0.15, 0.96, 0.07), (x, 0, -0.04))
        bevel(p, 0.012, 1)
        for v in p.data.vertices:
            v.co.z += math.sin(i * 1.7) * 0.008
        assign(p, 'Wood')
        parts.append(p)
    for y in (-0.44, 0.44):
        beam = cube('beam', (1.0, 0.06, 0.06), (0, y, -0.1))
        assign(beam, 'Wood')
        parts.append(beam)
    return finish(merge(parts, 'bridge'), 'bridge', smooth=False)


@piece('arrow')
def arrow():
    return arrow_piece('arrow', False)


@piece('arrow2')
def arrow2():
    return arrow_piece('arrow2', True)


def arrow_piece(name, two_way):
    plate = cube('plate', (0.9, 0.9, 0.05), (0, 0, 0.0))
    bevel(plate, 0.02, 2)
    assign(plate, 'Stone')
    bm = bmesh.new()
    pts = [(0, 0.36), (0.26, 0.06), (0.11, 0.06), (0.11, -0.32), (-0.11, -0.32), (-0.11, 0.06), (-0.26, 0.06)]
    vs = [bm.verts.new((x, y, 0.03)) for x, y in pts]
    f = bm.faces.new(vs)
    bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [v for v in bm.verts if v not in vs]
    for v in top:
        v.co.z = 0.055
    o = new_obj('arrow_shape', bm)
    assign(o, 'Accent')
    parts = [plate, o]
    if two_way:
        bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.06, depth=0.03, location=(0, -0.24, 0.06))
        d = bpy.context.active_object
        assign(d, 'Accent')
        parts.append(d)
    # north = +Y in Blender = arrow tip direction
    return finish(merge(parts, name), name, smooth=False)


@piece('switchBase')
def switch_base():
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.4, depth=0.07, location=(0, 0, 0.035))
    o = bpy.context.active_object
    bevel(o, 0.015, 2)
    assign(o, 'Stone')
    return finish(o, 'switchBase')


@piece('switchButton')
def switch_button():
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.28, depth=0.08, location=(0, 0, 0.1))
    o = bpy.context.active_object
    bevel(o, 0.025, 3)
    assign(o, 'Accent')
    return finish(o, 'switchButton')


@piece('pyramid')
def pyramid():
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.62, radius2=0.04, depth=0.95, location=(0, 0, 0.475))
    o = bpy.context.active_object
    o.rotation_euler = Euler((0, 0, math.pi / 4))
    C.apply_transform(o)
    bevel(o, 0.03, 3)
    assign(o, 'Accent')
    # stone bands
    parts = [o]
    for z, s in ((0.18, 0.84), (0.48, 0.48)):
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.62 * s + 0.02, radius2=0.62 * s - 0.05, depth=0.08, location=(0, 0, z))
        b = bpy.context.active_object
        b.rotation_euler = Euler((0, 0, math.pi / 4))
        C.apply_transform(b)
        assign(b, 'Stone')
        parts.append(b)
    return finish(merge(parts, 'pyramid'), 'pyramid', smooth=False)


@piece('pyramidBase')
def pyramid_base():
    o = cube('pbase', (0.94, 0.94, 0.05), (0, 0, 0.0))
    bevel(o, 0.015, 2)
    assign(o, 'Stone')
    return finish(o, 'pyramidBase', smooth=False)


@piece('metal')
def metal_block():
    o = cube('metal', (1.0, 1.0, 0.7), (0, 0, 0.35))
    bevel(o, 0.04, 3)
    assign(o, 'Metal')
    parts = [o]
    for z in (0.18, 0.52):
        band = cube('band', (1.02, 1.02, 0.05), (0, 0, z))
        assign(band, 'Dark')
        parts.append(band)
    return finish(merge(parts, 'metal'), 'metal', smooth=False)


# --- dual-grid terrain ---------------------------------------------------------------------------
# Cliffs, water banks and chasms are built from pieces centred on tile CORNERS. A piece covers the
# four quarter tiles around its corner, so its shape depends only on which of those four tiles are
# "in" (cliff / water / chasm). Five shapes plus 90° rotations cover all 16 patterns:
#   convex   one quadrant high (NE), rounded     half   the north half high
#   concave  all but SW high (SW rounded)        saddle two opposite low corners (NW, SE)
#   full     everything high (flat)
# Walls always run along the tile boundaries (x = 0 / y = 0 inside the piece) and use one
# cross-section, faded to it at the piece edges, so neighbouring pieces meet without seams, and the
# top surface is part of the same mesh as the wall: no overhangs, no gaps.

H = 1.06  # cliff top height
CHASM_DEPTH = 4.0


def _sm(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def _line(a, b, n, step=0.07):
    """Samples from a to b (b excluded) with a constant normal."""
    ax, ay = a
    bx, by = b
    length = math.hypot(bx - ax, by - ay)
    if length < 1e-6:
        return []
    k = max(1, round(length / step))
    return [(ax + (bx - ax) * i / k, ay + (by - ay) * i / k, n[0], n[1]) for i in range(k)]


def _arc(c, r, a0, a1, outward, step=0.07):
    """Arc samples (end excluded); the normal points away from the centre when outward."""
    k = max(2, round(abs(a1 - a0) * r / step))
    s = 1.0 if outward else -1.0
    out = []
    for i in range(k):
        a = a0 + (a1 - a0) * i / k
        out.append((c[0] + r * math.cos(a), c[1] + r * math.sin(a), s * math.cos(a), s * math.sin(a)))
    return out


def path_convex(R):
    """High = NE quadrant with a rounded inner corner. Normals point high -> low."""
    pts = _line((0.5, 0.0), (R, 0.0), (0.0, -1.0))
    pts += _arc((R, R), R, -math.pi / 2, -math.pi, True)
    pts += _line((0.0, R), (0.0, 0.5), (-1.0, 0.0))
    pts.append((0.0, 0.5, -1.0, 0.0))
    return pts


def path_half():
    pts = _line((0.5, 0.0), (-0.5, 0.0), (0.0, -1.0))
    pts.append((-0.5, 0.0, 0.0, -1.0))
    return pts


def path_concave(r):
    """Low = SW quadrant, rounded (arc around the SW piece corner when r = 0.5)."""
    pts = _line((-0.5, 0.0), (-r, 0.0), (0.0, -1.0))
    pts += _arc((-r, -r), r, math.pi / 2, 0.0, False)
    pts += _line((0.0, -r), (0.0, -0.5), (-1.0, 0.0))
    pts.append((0.0, -0.5, -1.0, 0.0))
    return pts


def _rot(pts, quarter):
    """Rotate path samples by quarter * 90° counter-clockwise."""
    out = []
    for x, y, nx, ny in pts:
        for _ in range(quarter % 4):
            x, y, nx, ny = -y, x, -ny, nx
        out.append((x, y, nx, ny))
    return out


def _rotp(p, quarter):
    x, y = p
    for _ in range(quarter % 4):
        x, y = -y, x
    return (x, y)


# Cross-sections: (d, z, noise weight, material slot). d is measured along the normal, from the
# high side (negative) to the low side (positive). Slot 0 = top surface role, 1 = wall role.

def profile_cliff():
    p = [(-0.12, H, 0.15, 0), (-0.075, H - 0.006, 0.25, 0), (-0.035, H - 0.025, 0.35, 0), (0.0, H - 0.06, 0.45, 0),
         (0.018, H - 0.1, 0.55, 0), (0.012, H - 0.135, 0.6, 1)]
    # rock strata: every layer leans out a little towards its base, with a small ledge between
    layers = [H - 0.135, 0.82, 0.6, 0.4, 0.2, 0.0]
    for i in range(len(layers) - 1):
        top, bot = layers[i], layers[i + 1]
        for k in (1, 2, 3):
            t = k / 3.0
            z = top + (bot - top) * t
            fade = _sm(z / 0.16)
            d = (-0.012 + 0.055 * t ** 1.4) * fade
            w = 1.0 * fade
            p.append((d, z, w, 1))
        if bot > 0.01:
            p.append(((-0.012) * _sm(bot / 0.16), bot - 0.018, _sm(bot / 0.16), 1))
    p.append((0.0, -0.12, 0.0, 1))
    p.append((0.0, -0.35, 0.0, 1))
    return p


def profile_bank():
    return [(-0.05, 0.0, 0.0, 0), (-0.022, -0.008, 0.15, 0), (0.0, -0.032, 0.3, 1), (0.05, -0.1, 0.5, 1),
            (0.11, -0.2, 0.7, 1), (0.18, -0.33, 0.8, 1), (0.26, -0.47, 0.8, 1), (0.34, -0.58, 0.6, 1), (0.42, -0.64, 0.3, 1)]


def profile_chasm():
    p = [(-0.07, 0.0, 0.0, 0), (-0.04, -0.008, 0.15, 0), (-0.012, -0.032, 0.3, 0), (0.004, -0.075, 0.5, 1)]
    layers = [-0.075, -0.36, -0.7, -1.1, -1.6, -2.2, -2.9, -CHASM_DEPTH]
    for i in range(len(layers) - 1):
        top, bot = layers[i], layers[i + 1]
        for k in (1, 2, 3):
            t = k / 3.0
            z = top + (bot - top) * t
            lean = 0.08 * (-z)  # the walls close in a little with depth
            d = lean - 0.01 + 0.05 * t ** 1.4
            p.append((d, z, 1.0, 1))
        p.append((0.08 * (-bot) - 0.012, bot - 0.02, 1.0, 1))
    return p


def _wall_noise(s, z, seed, kind):
    if kind == 'bank':
        return noise.fractal(Vector((s * 3.0 + seed * 11.0, z * 2.0, seed * 3.1)), 0.6, 2.0, 3)
    # columnar rock: stretched vertically, plus finer chips
    a = noise.fractal(Vector((s * 2.8 + seed * 11.0, z * 0.9, seed * 3.1)), 0.55, 2.0, 3)
    b = noise.noise(Vector((s * 9.0 + seed, z * 7.0, seed * 1.7)))
    return a + 0.35 * b


def sweep(bm, path, profile, seed, amp, kind, fade_len=0.16):
    """Loft the cross-section along a boundary path. Returns rows of vertices (one per profile
    point) and the faces with their material slot."""
    lengths = [0.0]
    for i in range(1, len(path)):
        lengths.append(lengths[-1] + math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]))
    total = lengths[-1]
    rows = []
    for d, z, w, _slot in profile:
        row = []
        for (x, y, nx, ny), s in zip(path, lengths):
            fade = _sm(min(s, total - s) / fade_len)
            n = _wall_noise(s, z, seed, kind) * amp * w * fade
            dd = d + n
            row.append(bm.verts.new((x + nx * dd, y + ny * dd, z)))
        rows.append(row)
    faces = []
    for j in range(len(rows) - 1):
        slot = profile[j + 1][3] if profile[j][3] != profile[j + 1][3] else profile[j][3]
        for i in range(len(path) - 1):
            f = bm.faces.new((rows[j][i], rows[j + 1][i], rows[j + 1][i + 1], rows[j][i + 1]))
            f.material_index = slot
            faces.append(f)
    # make the wall face the low side
    bm.normal_update()
    mid = faces[len(faces) // 2]
    x, y, nx, ny = path[len(path) // 2]
    if mid.normal.x * nx + mid.normal.y * ny < 0:
        for f in faces:
            f.normal_flip()
    return rows


def cap(bm, loop, z_extra, slot):
    """Flat polygon from boundary vertices plus extra corner points; triangulated, facing up."""
    verts = list(loop)
    for p in z_extra:
        verts.append(bm.verts.new(p))
    f = bm.faces.new(verts)
    f.material_index = slot
    bm.normal_update()
    if f.normal.z < 0:
        f.normal_flip()
    res = bmesh.ops.triangulate(bm, faces=[f], quad_method='BEAUTY', ngon_method='BEAUTY')
    for t in res['faces']:
        t.material_index = slot
    return res['faces']


def dual_piece(name, shape, family, seed):
    """shape: convex | half | concave | saddle | full. family: cliff | bank | chasm."""
    prof = {'cliff': profile_cliff, 'bank': profile_bank, 'chasm': profile_chasm}[family]()
    top_z = prof[0][1]
    low_z = prof[-1][1]
    amp = {'cliff': 0.055, 'bank': 0.035, 'chasm': 0.06}[family]
    roles = {'cliff': ('Grass', 'Rock'), 'bank': ('Ground', 'Bed'), 'chasm': ('Ground', 'Chasm')}[family]
    fill_low = family == 'bank'
    bm = bmesh.new()
    if shape == 'full':
        if family == 'cliff':
            cap(bm, [], [(0.5, 0.5, top_z), (-0.5, 0.5, top_z), (-0.5, -0.5, top_z), (0.5, -0.5, top_z)], 0)
        else:
            cap(bm, [], [(0.5, 0.5, low_z), (-0.5, 0.5, low_z), (-0.5, -0.5, low_z), (0.5, -0.5, low_z)], 1)
    elif shape == 'convex':
        R = 0.3 if family == 'cliff' else 0.25
        rows = sweep(bm, path_convex(R), prof, seed, amp, family)
        cap(bm, rows[0], [(0.5, 0.5, top_z)], 0)
        if fill_low:
            cap(bm, rows[-1], [(-0.5, 0.5, low_z), (-0.5, -0.5, low_z), (0.5, -0.5, low_z)], 1)
    elif shape == 'half':
        rows = sweep(bm, path_half(), prof, seed, amp, family)
        cap(bm, rows[0], [(-0.5, 0.5, top_z), (0.5, 0.5, top_z)], 0)
        if fill_low:
            cap(bm, rows[-1], [(-0.5, -0.5, low_z), (0.5, -0.5, low_z)], 1)
    elif shape == 'concave':
        r = 0.2 if family == 'cliff' else 0.5
        rows = sweep(bm, path_concave(r), prof, seed, amp, family)
        cap(bm, rows[0], [(0.5, -0.5, top_z), (0.5, 0.5, top_z), (-0.5, 0.5, top_z)], 0)
        if fill_low:
            cap(bm, rows[-1], [(-0.5, -0.5, low_z)], 1)
    elif shape == 'saddle':
        # low corners NW and SE; the high ground joins diagonally between them
        a = sweep(bm, _rot(path_concave(0.5), 3), prof, seed, amp, family)
        b = sweep(bm, _rot(path_concave(0.5), 1), prof, seed + 5, amp, family)
        top = list(a[0]) + [bm.verts.new((-0.5, -0.5, top_z))] + list(b[0]) + [bm.verts.new((0.5, 0.5, top_z))]
        cap(bm, top, [], 0)
        if fill_low:
            cap(bm, a[-1], [_rotp((-0.5, -0.5), 3) + (low_z,)], 1)
            cap(bm, b[-1], [_rotp((-0.5, -0.5), 1) + (low_z,)], 1)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    o = new_obj(name, bm)
    o.data.materials.append(mat(roles[0]))
    o.data.materials.append(mat(roles[1]))
    return finish(o, name)


def _register_dual():
    shapes = {
        'cliff': [('convex', 2), ('half', 3), ('concave', 2), ('full', 1)],
        'bank': [('convex', 1), ('half', 2), ('concave', 1), ('saddle', 1), ('full', 1)],
        'chasm': [('convex', 1), ('half', 3), ('concave', 1), ('saddle', 1)],
    }
    for family, items in shapes.items():
        for shape, variants in items:
            for v in range(variants):
                name = f'{family}_{shape}_{v}'
                seed = sum(map(ord, family + shape)) % 97 + v * 17
                PIECES.append((name, (lambda n=name, s=shape, f=family, sd=seed: dual_piece(n, s, f, sd))))


_register_dual()


# --- decorations ---------------------------------------------------------------------------------

@piece('tuft')
def tuft():
    parts = []
    rng = random.Random(21)
    for i in range(7):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0, 0.05)
        h = rng.uniform(0.09, 0.16)
        bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=0.018, radius2=0.0, depth=h, location=(math.cos(a) * d, math.sin(a) * d, h / 2))
        b = bpy.context.active_object
        b.rotation_euler = Euler((rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), rng.uniform(0, math.pi)))
        C.apply_transform(b)
        assign(b, 'Grass')
        parts.append(b)
    return finish(merge(parts, 'tuft'), 'tuft', smooth=False)


@piece('flower')
def flower():
    bpy.ops.mesh.primitive_cylinder_add(vertices=5, radius=0.006, depth=0.12, location=(0, 0, 0.06))
    stem = bpy.context.active_object
    assign(stem, 'Grass')
    parts = [stem]
    for i in range(5):
        a = i / 5 * math.tau
        bpy.ops.mesh.primitive_uv_sphere_add(segments=6, ring_count=4, radius=0.022, location=(math.cos(a) * 0.022, math.sin(a) * 0.022, 0.125))
        p = bpy.context.active_object
        p.scale = (1, 1, 0.4)
        C.apply_transform(p)
        assign(p, 'Accent')
        parts.append(p)
    return finish(merge(parts, 'flower'), 'flower', smooth=False)


@piece('pebbles')
def pebbles():
    parts = []
    rng = random.Random(33)
    for i in range(4):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=rng.uniform(0.02, 0.045), location=(rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 0.01))
        p = bpy.context.active_object
        p.scale = (1, rng.uniform(0.7, 1), 0.55)
        C.apply_transform(p)
        assign(p, 'Stone')
        parts.append(p)
    return finish(merge(parts, 'pebbles'), 'pebbles', smooth=False)


@piece('bush')
def bush():
    parts = []
    rng = random.Random(44)
    for i in range(5):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0, 0.08)
        r = rng.uniform(0.09, 0.14)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=(math.cos(a) * d, math.sin(a) * d, r * 0.9))
        b = bpy.context.active_object
        for v in b.data.vertices:
            v.co += v.normal * noise.noise(v.co * 20) * 0.015
        assign(b, 'Leaf')
        parts.append(b)
    return finish(merge(parts, 'bush'), 'bush')


@piece('tree')
def tree():
    bpy.ops.mesh.primitive_cone_add(vertices=8, radius1=0.08, radius2=0.05, depth=0.7, location=(0, 0, 0.35))
    trunk = bpy.context.active_object
    for v in trunk.data.vertices:
        v.co.x += math.sin(v.co.z * 4) * 0.02
    assign(trunk, 'Bark')
    parts = [trunk]
    rng = random.Random(55)
    for i in range(7):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.05, 0.22)
        r = rng.uniform(0.18, 0.26)
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=r, location=(math.cos(a) * d, math.sin(a) * d, 0.8 + rng.uniform(-0.1, 0.15)))
        c = bpy.context.active_object
        for v in c.data.vertices:
            v.co += v.normal * noise.noise(v.co * 12) * 0.03
        assign(c, 'Leaf')
        parts.append(c)
    return finish(merge(parts, 'tree'), 'tree')



# --- themed decorations (one set per world) ---------------------------------------------------------

def _ico(r, loc, role, sub=2, scale=(1, 1, 1), jitter=0.0, seed=0):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    C.apply_transform(o)
    if jitter:
        off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
        for v in o.data.vertices:
            v.co += v.normal * noise.noise(v.co * (1.5 / max(r, 0.01)) + off) * jitter
    assign(o, role)
    return o


def _cone(r1, r2, depth, loc, role, verts=8, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    C.apply_transform(o)
    assign(o, role)
    return o


def _cyl(r, depth, loc, role, verts=12, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    C.apply_transform(o)
    assign(o, role)
    return o


def _box(size, loc, role, rot=(0, 0, 0), bev=0.0):
    o = cube('box', size, loc)
    o.rotation_euler = Euler(rot)
    C.apply_transform(o)
    if bev:
        bevel(o, bev, 2)
    assign(o, role)
    return o


# Rocky Roadz: desert
@piece('cactus')
def cactus():
    green = 'Fix_5f9a4a'
    parts = [_cyl(0.085, 0.72, (0, 0, 0.36), green, verts=10), _ico(0.085, (0, 0, 0.72), green, sub=2, scale=(1, 1, 0.8))]
    for side, h, L in ((1, 0.36, 0.2), (-1, 0.48, 0.16)):
        parts.append(_cyl(0.055, L, (side * 0.12, 0, h), green, verts=8, rot=(0, math.pi / 2, 0)))
        parts.append(_cyl(0.055, 0.22, (side * (0.12 + L / 2), 0, h + 0.1), green, verts=8))
        parts.append(_ico(0.055, (side * (0.12 + L / 2), 0, h + 0.21), green, sub=1))
    # ribs: darker stripes + a pink flower on top
    for i in range(6):
        a = i / 6 * math.tau
        parts.append(_box((0.012, 0.012, 0.6), (math.cos(a) * 0.084, math.sin(a) * 0.084, 0.38), 'Fix_4a7a3a'))
    for i in range(5):
        a = i / 5 * math.tau
        parts.append(_ico(0.025, (math.cos(a) * 0.03, math.sin(a) * 0.03, 0.8), 'Fix_f27aa8', sub=1, scale=(1, 1, 0.5)))
    return finish(merge(parts, 'cactus'), 'cactus', smooth=False)


@piece('dryBush')
def dry_bush():
    rng = random.Random(71)
    parts = []
    for i in range(16):
        a = rng.uniform(0, math.tau)
        tilt = rng.uniform(0.3, 1.0)
        L = rng.uniform(0.18, 0.3)
        parts.append(_cyl(0.008, L, (math.cos(a) * L * 0.35, math.sin(a) * L * 0.35, L * 0.45), 'Fix_8a6a44', verts=4, rot=(math.cos(a + 1.57) * tilt, math.sin(a + 1.57) * tilt, 0)))
    for i in range(6):
        a = rng.uniform(0, math.tau)
        parts.append(_ico(0.05, (math.cos(a) * 0.1, math.sin(a) * 0.1, rng.uniform(0.12, 0.22)), 'Fix_9a8a4a', sub=1, jitter=0.01, seed=i))
    return finish(merge(parts, 'dryBush'), 'dryBush', smooth=False)


@piece('dryTuft')
def dry_tuft():
    rng = random.Random(72)
    parts = []
    for i in range(6):
        a = rng.uniform(0, math.tau)
        h = rng.uniform(0.08, 0.14)
        b = _cone(0.014, 0.0, h, (math.cos(a) * 0.03, math.sin(a) * 0.03, h / 2), 'Fix_b89a5a', verts=3,
                  rot=(rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), rng.uniform(0, 3)))
        parts.append(b)
    return finish(merge(parts, 'dryTuft'), 'dryTuft', smooth=False)


@piece('skull')
def skull():
    bone = 'Fix_efe6d2'
    parts = [_ico(0.05, (0, 0, 0.04), bone, sub=2, scale=(1, 1.2, 0.8)), _box((0.05, 0.04, 0.03), (0, 0.055, 0.02), bone, bev=0.008)]
    for sx in (-1, 1):
        parts.append(_ico(0.014, (sx * 0.02, 0.045, 0.05), 'Dark', sub=1))
        parts.append(_cone(0.012, 0.0, 0.09, (sx * 0.06, -0.01, 0.07), bone, verts=6, rot=(0, sx * -1.1, 0)))
    return finish(merge(parts, 'skull'), 'skull', smooth=False)


# Gruntziclez: snow and ice
@piece('pine')
def pine():
    parts = [_cyl(0.05, 0.3, (0, 0, 0.15), 'Bark', verts=7)]
    for i, (r, z) in enumerate(((0.3, 0.3), (0.24, 0.5), (0.17, 0.68), (0.1, 0.84))):
        parts.append(_cone(r, 0.0, 0.3, (0, 0, z + 0.1), 'Fix_2f6a4a', verts=9))
        parts.append(_cone(r * 0.75, 0.0, 0.13, (0, 0, z + 0.18), 'Fix_f4fbff', verts=9))
    return finish(merge(parts, 'pine'), 'pine', smooth=False)


@piece('iceBush')
def ice_bush():
    rng = random.Random(81)
    parts = []
    for i in range(7):
        a = rng.uniform(0, math.tau)
        tilt = rng.uniform(0.0, 0.7)
        h = rng.uniform(0.14, 0.32)
        parts.append(_cone(0.04, 0.0, h, (math.cos(a) * 0.05, math.sin(a) * 0.05, h / 2), 'Fix_9ee6ff', verts=5,
                           rot=(math.cos(a + 1.57) * tilt, math.sin(a + 1.57) * tilt, 0)))
    parts.append(_ico(0.09, (0, 0, 0.02), 'Fix_f4fbff', sub=2, scale=(1.3, 1.3, 0.5), jitter=0.01))
    return finish(merge(parts, 'iceBush'), 'iceBush', smooth=False)


@piece('snowTuft')
def snow_tuft():
    parts = [_ico(0.06, (0, 0, 0.0), 'Fix_f4fbff', sub=2, scale=(1.4, 1.1, 0.6), jitter=0.008)]
    rng = random.Random(82)
    for i in range(4):
        a = rng.uniform(0, math.tau)
        parts.append(_cone(0.01, 0.0, 0.1, (math.cos(a) * 0.04, math.sin(a) * 0.04, 0.06), 'Fix_6a8a5a', verts=3, rot=(rng.uniform(-0.4, 0.4), rng.uniform(-0.4, 0.4), 0)))
    return finish(merge(parts, 'snowTuft'), 'snowTuft', smooth=False)


@piece('iceCrystal')
def ice_crystal():
    parts = []
    for i, (a, t, h) in enumerate(((0, 0.0, 0.16), (2.1, 0.5, 0.1), (4.2, 0.45, 0.12))):
        parts.append(_cone(0.022, 0.0, h, (math.cos(a) * 0.02, math.sin(a) * 0.02, h / 2), 'Fix_bff2ff', verts=6, rot=(math.cos(a + 1.57) * t, math.sin(a + 1.57) * t, 0)))
    return finish(merge(parts, 'iceCrystal'), 'iceCrystal', smooth=False)


# Trouble in the Tropicz
def _frond(length, base, heading, pitch, droop, leaflets, width, rib, cols, seed, rib_r=0.01):
    """Palm / fern frond: a drooping rib with pairs of leaflets hanging from it in a V."""
    rng = random.Random(seed)
    N = 8
    dirh = Vector((math.cos(heading), math.sin(heading), 0))
    pts = []
    for i in range(N + 1):
        t = i / N
        pts.append(Vector(base) + dirh * (length * t * math.cos(pitch)) + Vector((0, 0, length * t * math.sin(pitch) - droop * t * t)))
    parts = _tube([tuple(p) for p in pts], rib_r, rib_r * 0.35, rib, verts=4)
    side = Vector((-dirh.y, dirh.x, 0))
    bm = bmesh.new()
    faces_col = []
    for k in range(leaflets):
        t = 0.1 + 0.88 * k / max(1, leaflets - 1)
        f = t * N
        i0 = min(int(f), N - 1)
        p = pts[i0].lerp(pts[i0 + 1], f - i0)
        tangent = (pts[i0 + 1] - pts[i0]).normalized()
        L = width * (0.35 + 0.65 * math.sin(min(1.0, t * 1.05) * math.pi)) * rng.uniform(0.85, 1.1)
        for s in (-1, 1):
            d = (side * s * 0.8 + tangent * 0.5 + Vector((0, 0, -0.45))).normalized()
            w = tangent * (L * 0.16)
            b = bm.verts.new(p)
            m1 = bm.verts.new(p + d * (L * 0.4) + w)
            m2 = bm.verts.new(p + d * (L * 0.4) - w)
            tip = bm.verts.new(p + d * L + Vector((0, 0, -L * 0.15)))
            col = rng.randrange(len(cols))
            faces_col.append((bm.faces.new((b, m1, tip)), col))
            faces_col.append((bm.faces.new((b, tip, m2)), col))
    o = new_obj('leaflets', bm)
    for c in cols:
        o.data.materials.append(mat(c))
    for poly, (_, col) in zip(o.data.polygons, faces_col):
        poly.material_index = col
    parts.append(o)
    return parts


@piece('palm')
def palm():
    rng = random.Random(91)
    parts = []
    # gently curved, tapering trunk with growth rings
    pts = [(0.14 * math.sin(i / 9 * 1.3) ** 2, 0.02 * math.sin(i), i * 0.105) for i in range(10)]
    trunk = merge(_tube(pts, 0.075, 0.048, 'Fix_8a6a44', verts=10), 'palm_trunk')
    C.shade_smooth(trunk)
    parts.append(trunk)
    for i in range(1, 9):
        x, y, z = pts[i]
        parts.append(_torus(0.072 - i * 0.003, 0.012, (x, y, z), 'Fix_6a4a2a', major=10, minor=4))
    top = Vector(pts[-1]) + Vector((0, 0, 0.03))
    for i in range(8):
        a = i / 8 * math.tau + rng.uniform(-0.2, 0.2)
        parts += _frond(rng.uniform(0.55, 0.72), top, a, rng.uniform(0.25, 0.55), rng.uniform(0.35, 0.5), 11, 0.2, 'Fix_6a8a3a', ('Fix_3f8a36', 'Fix_4f9a3a', 'Fix_5aa845'), seed=900 + i)
    for i in range(3):
        a = i / 3 * math.tau + 0.5
        parts += _frond(0.3, top, a, 1.1, 0.1, 8, 0.12, 'Fix_6a8a3a', ('Fix_6ab84a',), seed=950 + i)
    for i in range(4):
        a = i / 4 * math.tau + 0.3
        parts.append(_ico(0.045, (top.x + math.cos(a) * 0.06, top.y + math.sin(a) * 0.06, top.z - 0.07), 'Fix_6a4020', sub=2))
    return finish(merge(parts, 'palm'), 'palm', smooth=False)


@piece('fern')
def fern():
    rng = random.Random(92)
    parts = []
    for i in range(9):
        a = i / 9 * math.tau + rng.uniform(-0.25, 0.25)
        parts += _frond(rng.uniform(0.26, 0.36), (0, 0, 0.01), a, rng.uniform(0.7, 1.0), rng.uniform(0.25, 0.35), 10, 0.085, 'Fix_4a7a2a', ('Fix_2f7a2e', 'Fix_3f8a36', 'Fix_4f9a3a'), seed=960 + i, rib_r=0.006)
    return finish(merge(parts, 'fern'), 'fern', smooth=False)


@piece('hibiscus')
def hibiscus():
    parts = [_cyl(0.006, 0.12, (0, 0, 0.06), 'Fix_3f8a3a', verts=5)]
    for i in range(5):
        a = i / 5 * math.tau
        parts.append(_ico(0.03, (math.cos(a) * 0.03, math.sin(a) * 0.03, 0.125), 'Fix_ff4a5a', sub=1, scale=(1, 0.6, 0.3)))
    parts.append(_ico(0.012, (0, 0, 0.14), 'Fix_ffd23a', sub=1))
    return finish(merge(parts, 'hibiscus'), 'hibiscus', smooth=False)


@piece('lavaRocks')
def lava_rocks():
    parts = []
    rng = random.Random(93)
    for i in range(4):
        parts.append(_ico(rng.uniform(0.03, 0.05), (rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 0.01), 'Fix_3a3230', sub=1, scale=(1, 1, 0.6)))
    return finish(merge(parts, 'lavaRocks'), 'lavaRocks', smooth=False)


# High on Sweetz
@piece('lollipop')
def lollipop():
    parts = [_cyl(0.022, 0.7, (0, 0, 0.35), 'Fix_fff6ee', verts=8)]
    # the candy disc leans back so it reads from the top-down camera too
    for i, col in enumerate(('Fix_ff4a8a', 'Fix_fff6ee', 'Fix_6ad8ff', 'Fix_fff6ee', 'Fix_ffd23a')):
        parts.append(_cyl(0.3 - i * 0.058, 0.07 + i * 0.004, (0, 0.0, 0.9), col, verts=24, rot=(0.55, 0, 0)))
    return finish(merge(parts, 'lollipop'), 'lollipop', smooth=False)


@piece('gumdrops')
def gumdrops():
    rng = random.Random(101)
    cols = ('Fix_ff4a5a', 'Fix_4ad84a', 'Fix_ffd23a', 'Fix_9a4ad8', 'Fix_ff8a2a')
    parts = []
    for i in range(6):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.0, 0.12)
        r = rng.uniform(0.05, 0.08)
        parts.append(_cone(r, r * 0.4, r * 1.3, (math.cos(a) * d, math.sin(a) * d, r * 0.65), cols[i % len(cols)], verts=12))
        parts.append(_ico(r * 0.42, (math.cos(a) * d, math.sin(a) * d, r * 1.3), cols[i % len(cols)], sub=1))
    return finish(merge(parts, 'gumdrops'), 'gumdrops', smooth=False)


@piece('candyCane')
def candy_cane():
    parts = []
    for i in range(8):
        parts.append(_cyl(0.012, 0.022, (0, 0, 0.011 + i * 0.022), 'Fix_ff3a4a' if i % 2 else 'Fix_fff6ee', verts=8))
    for i in range(6):
        a = i / 6 * math.pi
        parts.append(_ico(0.013, (0.03 - math.cos(a) * 0.03, 0, 0.18 + math.sin(a) * 0.03), 'Fix_ff3a4a' if i % 2 else 'Fix_fff6ee', sub=1))
    return finish(merge(parts, 'candyCane'), 'candyCane', smooth=False)


@piece('sprinkles')
def sprinkles():
    rng = random.Random(103)
    cols = ('Fix_ff4a8a', 'Fix_6ad8ff', 'Fix_ffd23a', 'Fix_9aff6a', 'Fix_ffffff')
    parts = []
    for i in range(10):
        parts.append(_box((0.035, 0.009, 0.009), (rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), 0.006), cols[i % len(cols)], rot=(0, 0, rng.uniform(0, 3))))
    return finish(merge(parts, 'sprinkles'), 'sprinkles', smooth=False)


# High Rollerz: casino
@piece('diceStack')
def dice_stack():
    parts = []
    for i, (s, rz) in enumerate(((0.3, 0.2), (0.24, 0.9), (0.18, 0.4))):
        z = sum((0.3, 0.24, 0.18)[:i]) + s / 2
        d = _box((s, s, s), (0, 0, z), 'Fix_fff6ee' if i != 1 else 'Fix_e8342a', rot=(0, 0, rz), bev=s * 0.12)
        parts.append(d)
        for k in range(3):
            ox = (k - 1) * s * 0.28
            pip = _ico(s * 0.07, (0, 0, 0), 'Dark' if i != 1 else 'Fix_fff6ee', sub=1)
            pip.location = (math.cos(rz) * ox, math.sin(rz) * ox, z + s / 2)
            C.apply_transform(pip)
            parts.append(pip)
    return finish(merge(parts, 'diceStack'), 'diceStack', smooth=False)


@piece('chips')
def chips():
    cols = ('Fix_e8342a', 'Fix_2a6ad8', 'Fix_1a1a1a', 'Fix_2aa84a')
    parts = []
    for s, (x, y, n) in enumerate(((0, 0, 5), (0.13, 0.05, 3), (-0.08, 0.12, 4))):
        for i in range(n):
            parts.append(_cyl(0.07, 0.022, (x, y, 0.011 + i * 0.024), cols[(s + i) % len(cols)], verts=16))
            parts.append(_cyl(0.071, 0.008, (x, y, 0.011 + i * 0.024), 'Fix_fff6ee', verts=16))
    return finish(merge(parts, 'chips'), 'chips', smooth=False)


@piece('card')
def card():
    parts = [_box((0.12, 0.17, 0.005), (0, 0, 0.003), 'Fix_fff6ee', rot=(0, 0, 0.4))]
    parts.append(_ico(0.02, (0, 0, 0.007), 'Fix_e8342a', sub=1, scale=(1, 1, 0.3)))
    return finish(merge(parts, 'card'), 'card', smooth=False)


# Honey, I Shrunk the Gruntz: a giant garden
@piece('daisy')
def daisy():
    parts = [_cyl(0.035, 0.9, (0, 0, 0.45), 'Fix_4a9a3a', verts=8)]
    for i in range(12):
        a = i / 12 * math.tau
        parts.append(_ico(0.09, (math.cos(a) * 0.14, math.sin(a) * 0.14, 0.92), 'Fix_fffcf4', sub=1, scale=(1.6, 0.6, 0.2)))
    parts.append(_ico(0.08, (0, 0, 0.94), 'Fix_ffc23a', sub=2, scale=(1, 1, 0.5)))
    leaf = _ico(0.1, (0.1, 0, 0.3), 'Fix_4a9a3a', sub=1, scale=(1.6, 0.6, 0.2))
    parts.append(leaf)
    return finish(merge(parts, 'daisy'), 'daisy', smooth=False)


@piece('sugarCubes')
def sugar_cubes():
    parts = []
    for i, (x, y, z, r) in enumerate(((0, 0, 0.06, 0.2), (0.13, 0.04, 0.06, 0.9), (0.05, 0.06, 0.18, 0.5))):
        parts.append(_box((0.12, 0.12, 0.12), (x, y, z), 'Fix_fbfaf6', rot=(0, 0, r), bev=0.01))
    return finish(merge(parts, 'sugarCubes'), 'sugarCubes', smooth=False)


@piece('bladez')
def bladez():
    rng = random.Random(121)
    parts = []
    for i in range(5):
        a = rng.uniform(0, math.tau)
        h = rng.uniform(0.18, 0.3)
        parts.append(_cone(0.03, 0.0, h, (math.cos(a) * 0.04, math.sin(a) * 0.04, h / 2), 'Fix_5aa83a', verts=3, rot=(rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), a)))
    return finish(merge(parts, 'bladez'), 'bladez', smooth=False)


@piece('crumbs')
def crumbs():
    rng = random.Random(122)
    parts = []
    for i in range(5):
        parts.append(_ico(rng.uniform(0.015, 0.03), (rng.uniform(-0.09, 0.09), rng.uniform(-0.09, 0.09), 0.01), 'Fix_c89a5a', sub=1, scale=(1, 0.8, 0.6)))
    return finish(merge(parts, 'crumbs'), 'crumbs', smooth=False)


# The Miniature Masterz: a model railway landscape
@piece('modelTree')
def model_tree():
    parts = [_cyl(0.1, 0.03, (0, 0, 0.015), 'Fix_6a6a6a', verts=12), _cyl(0.025, 0.3, (0, 0, 0.18), 'Fix_8a5a34', verts=8)]
    parts.append(_cone(0.22, 0.0, 0.55, (0, 0, 0.55), 'Fix_3a8a3a', verts=10))
    parts.append(_cone(0.17, 0.0, 0.4, (0, 0, 0.78), 'Fix_4aa04a', verts=10))
    return finish(merge(parts, 'modelTree'), 'modelTree', smooth=False)


@piece('hedge')
def hedge():
    parts = [_box((0.3, 0.14, 0.14), (0, 0, 0.07), 'Fix_3f8a3a', bev=0.03)]
    parts.append(_box((0.1, 0.1, 0.02), (0.18, 0.05, 0.01), 'Fix_6a6a6a'))
    return finish(merge(parts, 'hedge'), 'hedge', smooth=False)


@piece('golfFlag')
def golf_flag():
    parts = [_cyl(0.004, 0.2, (0, 0, 0.1), 'Fix_fff6ee', verts=5), _box((0.06, 0.004, 0.035), (0.03, 0, 0.18), 'Fix_e8342a')]
    parts.append(_ico(0.018, (0.05, 0.04, 0.018), 'Fix_fffffa', sub=2))
    return finish(merge(parts, 'golfFlag'), 'golfFlag', smooth=False)


# Gruntz in Space
@piece('crystalSpire')
def crystal_spire():
    rng = random.Random(141)
    parts = []
    for i in range(5):
        a = rng.uniform(0, math.tau)
        tilt = rng.uniform(0.0, 0.5)
        h = rng.uniform(0.35, 0.8)
        parts.append(_cone(rng.uniform(0.05, 0.09), 0.0, h, (math.cos(a) * 0.08, math.sin(a) * 0.08, h / 2), 'Fix_b86aff' if i % 2 else 'Fix_6ad8ff', verts=6,
                           rot=(math.cos(a + 1.57) * tilt, math.sin(a + 1.57) * tilt, 0)))
    return finish(merge(parts, 'crystalSpire'), 'crystalSpire', smooth=False)


@piece('moonRock')
def moon_rock():
    parts = [_ico(0.14, (0, 0, 0.06), 'Fix_8a8aa0', sub=2, scale=(1.2, 1, 0.7), jitter=0.03, seed=3)]
    parts.append(_ico(0.07, (0.14, 0.05, 0.03), 'Fix_6a6a80', sub=1, jitter=0.02, seed=4))
    return finish(merge(parts, 'moonRock'), 'moonRock', smooth=False)


@piece('alienSprout')
def alien_sprout():
    parts = []
    for i in range(3):
        a = i / 3 * math.tau
        parts.append(_cyl(0.008, 0.14, (math.cos(a) * 0.02, math.sin(a) * 0.02, 0.07), 'Fix_6ad84a', verts=5, rot=(math.cos(a + 1.57) * 0.3, math.sin(a + 1.57) * 0.3, 0)))
        parts.append(_ico(0.02, (math.cos(a) * 0.045, math.sin(a) * 0.045, 0.14), 'Fix_d8ff4a', sub=1))
    return finish(merge(parts, 'alienSprout'), 'alienSprout', smooth=False)


@piece('craterPebbles')
def crater_pebbles():
    rng = random.Random(143)
    parts = []
    for i in range(4):
        parts.append(_ico(rng.uniform(0.02, 0.04), (rng.uniform(-0.08, 0.08), rng.uniform(-0.08, 0.08), 0.01), 'Fix_5a5a70', sub=1, scale=(1, 1, 0.6)))
    return finish(merge(parts, 'craterPebbles'), 'craterPebbles', smooth=False)


# --- set dressing: themed props for cliff tops, the land around the map and wall feet -----------

def _torus(R, r, loc, role, rot=(0, 0, 0), major=18, minor=8):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=major, minor_segments=minor, location=loc, rotation=rot)
    o = bpy.context.active_object
    C.apply_transform(o)
    assign(o, role)
    return o


def _lathe(profile, loc, role, segs=16):
    """Surface of revolution around Z from (radius, z) points, bottom to top."""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((verts[i], verts[i + 1])) for i in range(len(verts) - 1)]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=math.tau, steps=segs, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    o = new_obj('lathe', bm)
    o.location = loc
    C.apply_transform(o)
    C.shade_smooth(o)
    assign(o, role)
    return o


def _rock(r, loc, role='Rock', seed=0, scale=(1, 1, 0.8)):
    return _ico(r, loc, role, sub=2, scale=scale, jitter=r * 0.25, seed=seed)


# universal: rubble at the foot of cliff walls and rock piles on the plateaus
@piece('scree')
def scree():
    rng = random.Random(201)
    parts = []
    for i in range(7):
        a = rng.uniform(-1.2, 1.2)
        d = rng.uniform(0.0, 0.18)
        r = rng.uniform(0.03, 0.075) * (1.3 if i < 2 else 1)
        parts.append(_rock(r, (math.sin(a) * 0.3, math.cos(a) * d, r * 0.5), seed=i, scale=(1.1, 1, 0.7)))
    return finish(merge(parts, 'scree'), 'scree', smooth=False)


@piece('rockPile')
def rock_pile():
    rng = random.Random(202)
    parts = [_rock(0.2, (0, 0, 0.12), seed=1, scale=(1.2, 1, 0.85)), _rock(0.13, (0.2, 0.08, 0.08), seed=2), _rock(0.1, (-0.16, 0.12, 0.06), seed=3)]
    for i in range(5):
        a = rng.uniform(0, math.tau)
        parts.append(_rock(rng.uniform(0.03, 0.05), (math.cos(a) * 0.3, math.sin(a) * 0.3, 0.02), seed=10 + i))
    return finish(merge(parts, 'rockPile'), 'rockPile', smooth=False)


# Training meadow
@piece('stump')
def stump():
    parts = [_lathe([(0, 0), (0.19, 0), (0.17, 0.06), (0.15, 0.2), (0.15, 0.24), (0, 0.245)], (0, 0, 0), 'Bark', segs=14)]
    parts.append(_cyl(0.135, 0.012, (0, 0, 0.246), 'Fix_d8b07a', verts=14))
    for r in (0.09, 0.05):
        parts.append(_torus(r, 0.006, (0, 0, 0.253), 'Fix_b08a58', major=16, minor=4))
    for a in (0.3, 2.3, 4.2):
        parts.append(_cone(0.05, 0.02, 0.22, (math.cos(a) * 0.19, math.sin(a) * 0.19, 0.03), 'Bark', verts=6, rot=(math.sin(a) * 1.3, -math.cos(a) * 1.3, 0)))
    for i, (x, y) in enumerate(((0.1, -0.2), (0.17, -0.16))):
        parts.append(_cyl(0.012, 0.05, (x, y, 0.025), 'Fix_f0e8d8', verts=6))
        parts.append(_ico(0.035, (x, y, 0.06), 'Fix_e84a3a', sub=2, scale=(1, 1, 0.55)))
    return finish(merge(parts, 'stump'), 'stump', smooth=False)


@piece('logPile')
def log_pile():
    parts = []
    for i, (x, z) in enumerate(((-0.13, 0.07), (0.0, 0.07), (0.13, 0.07), (-0.065, 0.18), (0.065, 0.18), (0.0, 0.29))):
        parts.append(_cyl(0.068, 0.5, (x, 0, z), 'Bark', verts=10, rot=(math.pi / 2, 0, 0)))
        for s in (-1, 1):
            parts.append(_cyl(0.056, 0.01, (x, s * 0.251, z), 'Fix_d8b07a', verts=10, rot=(math.pi / 2, 0, 0)))
    return finish(merge(parts, 'logPile'), 'logPile', smooth=False)


@piece('mushrooms')
def mushrooms():
    parts = []
    for i, (x, y, s) in enumerate(((0, 0, 1.0), (0.09, 0.05, 0.7), (-0.06, 0.08, 0.55))):
        parts.append(_cyl(0.018 * s, 0.09 * s, (x, y, 0.045 * s), 'Fix_f4ecdc', verts=8))
        parts.append(_ico(0.06 * s, (x, y, 0.095 * s), 'Fix_e0402e', sub=2, scale=(1, 1, 0.55)))
        for k in range(4):
            a = k / 4 * math.tau + i
            parts.append(_ico(0.01 * s, (x + math.cos(a) * 0.035 * s, y + math.sin(a) * 0.035 * s, 0.118 * s), 'Fix_ffffff', sub=1))
    return finish(merge(parts, 'mushrooms'), 'mushrooms', smooth=False)


@piece('signpost')
def signpost():
    parts = [_box((0.05, 0.05, 0.6), (0, 0, 0.3), 'Wood', bev=0.01)]
    parts.append(_box((0.34, 0.03, 0.12), (0.12, 0, 0.5), 'Wood', rot=(0, 0.08, 0), bev=0.01))
    parts.append(_cone(0.07, 0.0, 0.1, (0.33, 0, 0.51), 'Wood', verts=3, rot=(0, math.pi / 2, 0)))
    parts.append(_box((0.28, 0.03, 0.1), (-0.1, 0, 0.35), 'Wood', rot=(0, -0.1, 0), bev=0.01))
    return finish(merge(parts, 'signpost'), 'signpost', smooth=False)


# Rocky Roadz: wild west desert
@piece('mesa')
def mesa():
    rng = random.Random(211)
    parts = []
    z = 0.0
    r = 0.42
    for i in range(5):
        h = rng.uniform(0.2, 0.32)
        parts.append(_ico(r, (rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), z + h / 2), 'Rock', sub=2, scale=(1.1, 1.0, h / r * 0.55), jitter=0.04, seed=i))
        z += h * 0.9
        r *= 0.82
    parts.append(_ico(0.2, (0.02, 0, z + 0.05), 'Rock', sub=2, scale=(1.3, 1.1, 0.5), jitter=0.03, seed=9))
    return finish(merge(parts, 'mesa'), 'mesa', smooth=True)


@piece('wagonWheel')
def wagon_wheel():
    parts = [_torus(0.24, 0.025, (0, 0, 0.23), 'Wood', rot=(math.pi / 2 - 0.35, 0, 0), major=20, minor=6)]
    parts.append(_cyl(0.05, 0.08, (0, 0, 0.23), 'Metal', verts=10, rot=(math.pi / 2 - 0.35, 0, 0)))
    for i in range(8):
        a = i / 8 * math.tau
        spoke = _box((0.44, 0.02, 0.02), (0, 0, 0), 'Wood')
        spoke.data.transform(Matrix.Rotation(a, 4, 'Z'))
        spoke.data.transform(Matrix.Rotation(math.pi / 2 - 0.35, 4, 'X'))
        spoke.data.transform(Matrix.Translation((0, 0, 0.23)))
        parts.append(spoke)
    return finish(merge(parts, 'wagonWheel'), 'wagonWheel', smooth=False)


@piece('barrel')
def barrel():
    parts = [_lathe([(0, 0), (0.13, 0), (0.155, 0.12), (0.16, 0.18), (0.155, 0.24), (0.13, 0.36), (0, 0.36)], (0, 0, 0), 'Wood', segs=16)]
    for z, r in ((0.05, 0.14), (0.31, 0.14), (0.14, 0.16), (0.22, 0.16)):
        parts.append(_torus(r, 0.008, (0, 0, z), 'Metal', major=20, minor=4))
    return finish(merge(parts, 'barrel'), 'barrel', smooth=False)


@piece('deadTree')
def dead_tree():
    parts = []
    rng = random.Random(214)

    def branch(p, d, length, r, depth):
        end = p + d * length
        mid = (p + end) / 2
        c = _cyl(r, length, (0, 0, 0), 'Fix_7a5a40', verts=6)
        c.data.transform(d.to_track_quat('Z', 'Y').to_matrix().to_4x4())
        c.data.transform(Matrix.Translation(mid))
        parts.append(c)
        if depth == 0:
            return
        for k in range(2):
            nd = (d + Vector((rng.uniform(-0.9, 0.9), rng.uniform(-0.9, 0.9), rng.uniform(0.1, 0.6)))).normalized()
            branch(end, nd, length * 0.62, r * 0.62, depth - 1)

    branch(Vector((0, 0, 0)), Vector((0.1, 0, 1)).normalized(), 0.42, 0.045, 3)
    return finish(merge(parts, 'deadTree'), 'deadTree', smooth=False)


# Gruntziclez: snow and ice
@piece('snowman')
def snowman():
    parts = [_ico(0.17, (0, 0, 0.15), 'Fix_f6fbff', sub=3), _ico(0.12, (0, 0, 0.37), 'Fix_f6fbff', sub=3), _ico(0.085, (0, 0, 0.53), 'Fix_f6fbff', sub=3)]
    parts.append(_cone(0.02, 0.0, 0.1, (0, -0.12, 0.53), 'Fix_f28a2a', verts=8, rot=(math.pi / 2, 0, 0)))
    for x in (-0.03, 0.03):
        parts.append(_ico(0.012, (x, -0.075, 0.56), 'Fix_1a1a1a', sub=1))
    for z in (0.33, 0.4):
        parts.append(_ico(0.014, (0, -0.118, z), 'Fix_1a1a1a', sub=1))
    parts.append(_cyl(0.07, 0.012, (0, 0, 0.605), 'Fix_2a2a30', verts=12))
    parts.append(_cyl(0.05, 0.09, (0, 0, 0.65), 'Fix_2a2a30', verts=12))
    parts.append(_torus(0.095, 0.022, (0, 0, 0.45), 'Fix_d83a3a', major=16, minor=6))
    for s in (-1, 1):
        parts.append(_cyl(0.008, 0.22, (s * 0.18, 0, 0.42), 'Fix_6a4428', verts=4, rot=(0, s * 1.0, 0)))
    return finish(merge(parts, 'snowman'), 'snowman', smooth=True)


@piece('igloo')
def igloo():
    prof = [(0.42 * math.cos(a), 0.4 * math.sin(a)) for a in [i / 10 * math.pi / 2 for i in range(11)]]
    prof = [(0, 0)] + prof
    parts = [_lathe(prof, (0, 0, 0), 'Fix_f2f8ff', segs=20)]
    for k in range(1, 5):
        a = k / 5 * math.pi / 2
        parts.append(_torus(0.42 * math.cos(a) + 0.004, 0.006, (0, 0, 0.4 * math.sin(a)), 'Fix_cfe0ee', major=24, minor=4))
    # entrance tunnel
    tunnel = _lathe([(0, 0), (0.15, 0), (0.15, 0.16), (0.1, 0.24), (0, 0.25)], (0, 0, 0), 'Fix_f2f8ff', segs=12)
    tunnel.rotation_euler = Euler((math.pi / 2, 0, 0))
    tunnel.location = (0, -0.34, 0.0)
    C.apply_transform(tunnel)
    for v in tunnel.data.vertices:
        v.co.z = max(v.co.z, 0.0)
    parts.append(tunnel)
    parts.append(_box((0.16, 0.02, 0.14), (0, -0.59, 0.07), 'Fix_2a3440'))
    return finish(merge(parts, 'igloo'), 'igloo', smooth=True)


@piece('iceShards')
def ice_shards():
    rng = random.Random(223)
    parts = []
    for i in range(6):
        a = rng.uniform(0, math.tau)
        h = rng.uniform(0.2, 0.55)
        tilt = rng.uniform(0.0, 0.45)
        parts.append(_cone(rng.uniform(0.05, 0.09), 0.0, h, (math.cos(a) * 0.1, math.sin(a) * 0.1, h / 2), 'Fix_a8e0ff' if i % 2 else 'Fix_d8f2ff', verts=5,
                           rot=(math.cos(a + 1.57) * tilt, math.sin(a + 1.57) * tilt, rng.uniform(0, 3))))
    return finish(merge(parts, 'iceShards'), 'iceShards', smooth=False)


@piece('snowRocks')
def snow_rocks():
    parts = [_rock(0.18, (0, 0, 0.1), seed=31), _rock(0.11, (0.18, 0.1, 0.06), seed=32)]
    parts.append(_ico(0.17, (0, 0, 0.17), 'Fix_f4faff', sub=2, scale=(1.05, 1.0, 0.35), jitter=0.02, seed=33))
    parts.append(_ico(0.1, (0.18, 0.1, 0.11), 'Fix_f4faff', sub=2, scale=(1.05, 1.0, 0.35), jitter=0.02, seed=34))
    return finish(merge(parts, 'snowRocks'), 'snowRocks', smooth=False)


# Trouble in the Tropicz
@piece('tiki')
def tiki():
    parts = [_cyl(0.13, 0.62, (0, 0, 0.31), 'Fix_8a5a34', verts=10)]
    parts.append(_box((0.3, 0.2, 0.06), (0, 0, 0.64), 'Fix_6a4020', bev=0.01))
    for x in (-0.05, 0.05):
        parts.append(_ico(0.035, (x, -0.12, 0.47), 'Fix_f2e0b0', sub=1, scale=(1, 0.5, 1)))
        parts.append(_ico(0.018, (x, -0.135, 0.47), 'Fix_1a1a1a', sub=1))
    parts.append(_box((0.14, 0.05, 0.05), (0, -0.12, 0.33), 'Fix_c83a2a', bev=0.01))
    parts.append(_cone(0.04, 0.0, 0.08, (0, -0.15, 0.4), 'Fix_6a4020', verts=4, rot=(math.pi / 2, 0, 0)))
    for i in range(5):
        a = i / 5 * math.pi - math.pi
        parts.append(_cone(0.03, 0.0, 0.14, (math.cos(a) * 0.12, 0.02, 0.72 + math.sin(-a) * 0.02), 'Fix_3f9a3a', verts=4, rot=(0, math.cos(a) * 0.6, 0)))
    return finish(merge(parts, 'tiki'), 'tiki', smooth=False)


@piece('hut')
def hut():
    parts = [_cyl(0.3, 0.34, (0, 0, 0.17), 'Fix_c8a070', verts=12)]
    parts.append(_cone(0.48, 0.02, 0.4, (0, 0, 0.54), 'Fix_d8b870', verts=12))
    parts.append(_torus(0.44, 0.03, (0, 0, 0.37), 'Fix_b89850', major=16, minor=5))
    parts.append(_box((0.16, 0.02, 0.24), (0, -0.3, 0.12), 'Fix_4a2a18'))
    for i in range(12):
        a = i / 12 * math.tau
        parts.append(_box((0.02, 0.02, 0.34), (math.cos(a) * 0.305, math.sin(a) * 0.305, 0.17), 'Fix_9a7048'))
    return finish(merge(parts, 'hut'), 'hut', smooth=False)


@piece('bigLeaves')
def big_leaves():
    rng = random.Random(233)
    parts = []
    for i in range(6):
        a = i / 6 * math.tau + rng.uniform(-0.2, 0.2)
        parts.append(_leaf(0.34, 0.16, (0, 0, 0.04), a, 0.18, 'Fix_2f8a3a' if i % 2 else 'Fix_4aa84a', tilt=0.55, segments=5))
    return finish(merge(parts, 'bigLeaves'), 'bigLeaves', smooth=False)


# High on Sweetz
@piece('cupcake')
def cupcake():
    parts = [_lathe([(0, 0), (0.2, 0), (0.26, 0.22), (0, 0.22)], (0, 0, 0), 'Fix_f2a0c8', segs=16)]
    for i in range(16):
        a = i / 16 * math.tau
        parts.append(_box((0.02, 0.012, 0.2), (math.cos(a) * 0.235, math.sin(a) * 0.235, 0.11), 'Fix_e088b0', rot=(math.sin(a) * 0.26, -math.cos(a) * 0.26, a)))
    parts.append(_lathe([(0, 0.2), (0.3, 0.2), (0.3, 0.26), (0.24, 0.34), (0.18, 0.38), (0.2, 0.42), (0.12, 0.5), (0.05, 0.56), (0, 0.58)], (0, 0, 0), 'Fix_fff4f8', segs=18))
    parts.append(_ico(0.06, (0, 0, 0.62), 'Fix_e8283a', sub=2))
    rng = random.Random(241)
    for i in range(18):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0.05, 0.24)
        z = 0.56 - rr * 0.8
        parts.append(_box((0.035, 0.012, 0.012), (math.cos(a) * rr, math.sin(a) * rr, z), ['Fix_ffd84a', 'Fix_6ad8ff', 'Fix_7ae86a', 'Fix_ff6aa8'][i % 4], rot=(0, 0, rng.uniform(0, 3))))
    return finish(merge(parts, 'cupcake'), 'cupcake', smooth=False)


@piece('donut')
def donut():
    parts = [_torus(0.16, 0.08, (0, 0.0, 0.08), 'Fix_d8a060', major=20, minor=10)]
    icing = _torus(0.16, 0.082, (0, 0, 0.09), 'Fix_ff8ac8', major=20, minor=10)
    for v in icing.data.vertices:
        if v.co.z < 0.09:
            v.co.z = 0.09 + (v.co.z - 0.09) * 0.2
    parts.append(icing)
    rng = random.Random(242)
    for i in range(14):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0.11, 0.21)
        parts.append(_box((0.03, 0.01, 0.01), (math.cos(a) * rr, math.sin(a) * rr, 0.17), ['Fix_ffffff', 'Fix_6ad8ff', 'Fix_ffd84a'][i % 3], rot=(0, 0, rng.uniform(0, 3))))
    return finish(merge(parts, 'donut'), 'donut', smooth=False)


@piece('wrappedCandy')
def wrapped_candy():
    parts = [_ico(0.07, (0, 0, 0.06), 'Fix_ff4a6a', sub=2, scale=(1.4, 1, 1))]
    for s in (-1, 1):
        parts.append(_cone(0.05, 0.0, 0.08, (s * 0.12, 0, 0.06), 'Fix_ff8aa8', verts=6, rot=(0, -s * math.pi / 2, 0)))
    parts.append(_torus(0.06, 0.008, (0, 0, 0.06), 'Fix_ffffff', rot=(0, math.pi / 2, 0), major=12, minor=4))
    return finish(merge(parts, 'wrappedCandy'), 'wrappedCandy', smooth=False)


@piece('iceCream')
def ice_cream():
    parts = [_cone(0.1, 0.02, 0.3, (0, 0, 0.15), 'Fix_d8a060', verts=10, rot=(math.pi, 0, 0))]
    parts.append(_ico(0.12, (0, 0, 0.35), 'Fix_fff0e0', sub=2, jitter=0.01, seed=5))
    parts.append(_ico(0.1, (0.02, 0, 0.47), 'Fix_ff9ac8', sub=2, jitter=0.01, seed=6))
    parts.append(_ico(0.03, (0.03, 0, 0.57), 'Fix_e8283a', sub=1))
    return finish(merge(parts, 'iceCream'), 'iceCream', smooth=False)


# High Rollerz: casino
@piece('chipTower')
def chip_tower():
    parts = []
    for i in range(9):
        parts.append(_cyl(0.13, 0.034, (math.sin(i * 1.3) * 0.01, math.cos(i * 1.7) * 0.01, 0.018 + i * 0.036), ['Fix_d83a3a', 'Fix_f2f2f2', 'Fix_2a6ad8'][i % 3], verts=18))
    return finish(merge(parts, 'chipTower'), 'chipTower', smooth=False)


@piece('slotMachine')
def slot_machine():
    parts = [_box((0.44, 0.34, 0.6), (0, 0, 0.3), 'Fix_c82a2a', bev=0.03)]
    parts.append(_box((0.46, 0.36, 0.1), (0, 0, 0.65), 'Fix_f2c83a', bev=0.02))
    parts.append(_box((0.34, 0.02, 0.14), (0, -0.17, 0.42), 'Fix_fff8e8'))
    for i, c in enumerate(('Fix_e8283a', 'Fix_3cc45a', 'Fix_2a6ad8')):
        parts.append(_ico(0.03, (-0.1 + i * 0.1, -0.185, 0.42), c, sub=1))
    parts.append(_cyl(0.015, 0.25, (0.25, 0, 0.5), 'Metal', verts=8))
    parts.append(_ico(0.04, (0.25, 0, 0.63), 'Fix_e8283a', sub=2))
    return finish(merge(parts, 'slotMachine'), 'slotMachine', smooth=False)


@piece('cardHouse')
def card_house():
    parts = []
    for x in (-0.09, 0.09):
        for s in (-1, 1):
            parts.append(_box((0.005, 0.12, 0.17), (x + s * 0.035, 0, 0.08), 'Fix_fbf6ee', rot=(0, s * 0.35, 0)))
    parts.append(_box((0.3, 0.13, 0.005), (0, 0, 0.165), 'Fix_fbf6ee'))
    for s in (-1, 1):
        parts.append(_box((0.005, 0.12, 0.17), (s * 0.035, 0, 0.25), 'Fix_fbf6ee', rot=(0, s * 0.35, 0)))
    parts.append(_box((0.05, 0.004, 0.05), (0.09, -0.066, 0.1), 'Fix_d83a3a', rot=(0, 0, 0)))
    return finish(merge(parts, 'cardHouse'), 'cardHouse', smooth=False)


# Honey, I Shrunk the Gruntz: giant kitchen table
@piece('teacup')
def teacup():
    parts = [_lathe([(0, 0), (0.18, 0), (0.24, 0.08), (0.3, 0.3), (0.285, 0.3), (0.225, 0.09), (0, 0.09)], (0, 0, 0), 'Fix_f4f0ea', segs=20)]
    parts.append(_cyl(0.27, 0.01, (0, 0, 0.26), 'Fix_8a5a34', verts=20))
    parts.append(_torus(0.09, 0.025, (0.33, 0, 0.18), 'Fix_f4f0ea', rot=(math.pi / 2, 0, 0), major=14, minor=6))
    parts.append(_torus(0.3, 0.012, (0, 0, 0.26), 'Fix_4a8ad8', major=24, minor=4))
    return finish(merge(parts, 'teacup'), 'teacup', smooth=False)


@piece('spoon')
def spoon():
    parts = [_box((0.7, 0.05, 0.02), (-0.15, 0, 0.03), 'Metal', rot=(0, -0.05, 0), bev=0.008)]
    parts.append(_ico(0.12, (0.3, 0, 0.04), 'Metal', sub=2, scale=(1.4, 0.95, 0.3)))
    return finish(merge(parts, 'spoon'), 'spoon', smooth=True)


@piece('pencil')
def pencil():
    parts = [_cyl(0.045, 0.7, (0, 0, 0.045), 'Fix_f2c83a', verts=6, rot=(0, math.pi / 2, 0))]
    parts.append(_cone(0.045, 0.0, 0.14, (0.42, 0, 0.045), 'Fix_e8c8a0', verts=6, rot=(0, math.pi / 2, 0)))
    parts.append(_cone(0.015, 0.0, 0.045, (0.47, 0, 0.045), 'Fix_2a2a2a', verts=6, rot=(0, math.pi / 2, 0)))
    parts.append(_cyl(0.047, 0.06, (-0.38, 0, 0.045), 'Metal', verts=10, rot=(0, math.pi / 2, 0)))
    parts.append(_cyl(0.045, 0.08, (-0.44, 0, 0.045), 'Fix_f28aa8', verts=10, rot=(0, math.pi / 2, 0)))
    return finish(merge(parts, 'pencil'), 'pencil', smooth=False)


@piece('button')
def button():
    parts = [_cyl(0.12, 0.03, (0, 0, 0.015), 'Fix_3a8ad8', verts=18), _torus(0.1, 0.012, (0, 0, 0.03), 'Fix_2a6ab8', major=18, minor=4)]
    for x, y in ((-0.03, -0.03), (0.03, -0.03), (-0.03, 0.03), (0.03, 0.03)):
        parts.append(_cyl(0.012, 0.034, (x, y, 0.016), 'Fix_1a3a68', verts=8))
    return finish(merge(parts, 'button'), 'button', smooth=False)


# The Miniature Masterz: model railway scenery
@piece('modelHouse')
def model_house():
    parts = [_box((0.46, 0.36, 0.3), (0, 0, 0.15), 'Fix_f2e8d0', bev=0.01)]
    roof = bmesh.new()
    pts = [(-0.27, -0.21, 0.3), (0.27, -0.21, 0.3), (0.27, 0.21, 0.3), (-0.27, 0.21, 0.3), (-0.27, 0, 0.52), (0.27, 0, 0.52)]
    v = [roof.verts.new(p) for p in pts]
    for f in ((0, 1, 5, 4), (3, 4, 5, 2), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)):
        roof.faces.new([v[i] for i in f])
    bmesh.ops.recalc_face_normals(roof, faces=roof.faces[:])
    r = new_obj('roof', roof)
    assign(r, 'Fix_c84a3a')
    parts.append(r)
    parts.append(_box((0.06, 0.06, 0.16), (0.14, 0.08, 0.5), 'Fix_a85a4a'))
    for x in (-0.13, 0.13):
        parts.append(_box((0.08, 0.01, 0.08), (x, -0.181, 0.19), 'Fix_6ab8e8'))
    parts.append(_box((0.08, 0.01, 0.14), (0, -0.181, 0.07), 'Fix_6a4428'))
    return finish(merge(parts, 'modelHouse'), 'modelHouse', smooth=False)


@piece('fence')
def fence():
    parts = []
    for x in (-0.36, -0.12, 0.12, 0.36):
        parts.append(_box((0.035, 0.035, 0.2), (x, 0, 0.1), 'Fix_f4f0e8'))
        parts.append(_cone(0.026, 0.0, 0.04, (x, 0, 0.22), 'Fix_f4f0e8', verts=4))
    for z in (0.07, 0.15):
        parts.append(_box((0.8, 0.015, 0.03), (0, 0.02, z), 'Fix_f4f0e8'))
    return finish(merge(parts, 'fence'), 'fence', smooth=False)


@piece('lamppost')
def lamppost():
    parts = [_cyl(0.05, 0.04, (0, 0, 0.02), 'Fix_2a2a30', verts=10), _cyl(0.018, 0.5, (0, 0, 0.27), 'Fix_2a2a30', verts=8)]
    parts.append(_cone(0.05, 0.03, 0.08, (0, 0, 0.55), 'Fix_2a2a30', verts=6))
    parts.append(_ico(0.035, (0, 0, 0.52), 'Fix_fff0b0', sub=2))
    return finish(merge(parts, 'lamppost'), 'lamppost', smooth=False)


# Gruntz in Space
@piece('satellite')
def satellite():
    dish = _lathe([(0, 0.0), (0.12, 0.02), (0.22, 0.07), (0.3, 0.15), (0.29, 0.155), (0.21, 0.08), (0.11, 0.03), (0, 0.012)], (0, 0, 0), 'Fix_dfe4ee', segs=20)
    dish.rotation_euler = Euler((0.7, 0, 0.4))
    dish.location = (0, 0, 0.42)
    C.apply_transform(dish)
    parts = [dish, _cyl(0.035, 0.42, (0, 0, 0.21), 'Metal', verts=8), _box((0.2, 0.2, 0.06), (0, 0, 0.03), 'Metal', bev=0.01)]
    parts.append(_cyl(0.008, 0.2, (0, -0.06, 0.55), 'Metal', verts=4, rot=(0.7, 0, 0.4)))
    parts.append(_ico(0.02, (0.03, -0.12, 0.62), 'Fix_ff3a3a', sub=1))
    return finish(merge(parts, 'satellite'), 'satellite', smooth=False)


@piece('rocket')
def rocket():
    parts = [_lathe([(0, 0.12), (0.12, 0.12), (0.14, 0.3), (0.13, 0.55), (0.08, 0.75), (0, 0.86)], (0, 0, 0), 'Fix_f2f4f8', segs=16)]
    parts.append(_lathe([(0.12, 0.72), (0.089, 0.745), (0.05, 0.8), (0, 0.86), (0, 0.72)], (0, 0, 0.001), 'Fix_e8343a', segs=16))
    for i in range(3):
        a = i / 3 * math.tau
        fin = _box((0.012, 0.12, 0.2), (math.cos(a) * 0.15, math.sin(a) * 0.15, 0.2), 'Fix_e8343a', rot=(0, 0, a + math.pi / 2))
        parts.append(fin)
    parts.append(_cyl(0.05, 0.012, (0, -0.132, 0.5), 'Fix_6ad8ff', verts=12, rot=(math.pi / 2, 0, 0)))
    parts.append(_cone(0.1, 0.07, 0.1, (0, 0, 0.08), 'Fix_4a4a58', verts=12))
    return finish(merge(parts, 'rocket'), 'rocket', smooth=False)


@piece('moonCrater')
def moon_crater():
    parts = [_torus(0.26, 0.06, (0, 0, 0.0), 'Fix_8a8aa6', major=20, minor=8)]
    for v in parts[0].data.vertices:
        v.co.z = max(v.co.z, -0.005) * 0.7
    parts.append(_cyl(0.24, 0.01, (0, 0, 0.003), 'Fix_6a6a86', verts=20))
    return finish(merge(parts, 'moonCrater'), 'moonCrater', smooth=True)


# --- jungle, landmarks and wall dressing ---------------------------------------------------------

def _tube(points, r0, r1, role, verts=8):
    """A tapering tube through a list of points (trunks, vines, branches)."""
    parts = []
    n = len(points) - 1
    for i in range(n):
        a, b = Vector(points[i]), Vector(points[i + 1])
        d = b - a
        r = r0 + (r1 - r0) * (i + 0.5) / n
        c = _cyl(r, d.length * 1.08, (0, 0, 0), role, verts=verts)
        c.data.transform(d.normalized().to_track_quat('Z', 'Y').to_matrix().to_4x4())
        c.data.transform(Matrix.Translation((a + b) / 2))
        parts.append(c)
    return parts


def _leaf(length, width, loc, heading, droop, role, tilt=0.35, segments=6):
    """A long curved leaf blade from its base: rises, then droops at the tip. A thin closed
    strip subdivided only along its length (cheap, but still solid from any side)."""
    bm = bmesh.new()
    n = segments
    top, bot = [], []
    for i in range(n + 1):
        t = i / n
        x = length * t
        z = math.sin(t * math.pi * 0.8) * length * 0.18 - t * t * droop
        half = width * 0.5 * (math.sin(min(1.0, t * 1.15 + 0.08) * math.pi) * 0.9 + 0.1)
        row_t, row_b = [], []
        for y in (-half, 0.0, half):
            lift = 0.012 * (1 - abs(y) / max(half, 1e-4)) if half > 1e-4 else 0
            row_t.append(bm.verts.new((x, y, z + 0.004 + lift)))
            row_b.append(bm.verts.new((x, y, z - 0.004 + lift * 0.5)))
        top.append(row_t)
        bot.append(row_b)
    # windings chosen so every face points outwards (top up, bottom down, edges sideways)
    for i in range(n):
        for j in range(2):
            bm.faces.new((top[i][j], top[i + 1][j], top[i + 1][j + 1], top[i][j + 1]))
            bm.faces.new((bot[i][j], bot[i][j + 1], bot[i + 1][j + 1], bot[i + 1][j]))
        bm.faces.new((top[i][0], bot[i][0], bot[i + 1][0], top[i + 1][0]))
        bm.faces.new((top[i][2], top[i + 1][2], bot[i + 1][2], bot[i][2]))
    leaf = new_obj('leaf', bm)
    leaf.data.transform(Matrix.Rotation(-tilt, 4, 'Y'))
    leaf.data.transform(Matrix.Rotation(heading, 4, 'Z'))
    leaf.data.transform(Matrix.Translation(loc))
    assign(leaf, role)
    return leaf


@piece('jungleTree')
def jungle_tree():
    """Rainforest giant: buttress roots and trunk as one smooth piece, a lumpy cloud-like crown
    (dark underneath, sunlit on top) with leaf sprays growing out of it, a few lianas."""
    rng = random.Random(301)
    tparts = _tube([(0, 0, -0.02), (0.03, 0.01, 0.35), (0.0, 0.03, 0.7), (-0.03, 0.0, 1.0), (-0.02, -0.01, 1.12)], 0.1, 0.06, 'Fix_7a5a3e', verts=10)
    for i in range(5):
        a = i / 5 * math.tau + rng.uniform(-0.3, 0.3)
        r = rng.uniform(0.28, 0.36)
        c, s_ = math.cos(a), math.sin(a)
        # hugging the ground, thick at the trunk
        tparts += _tube([(c * r, s_ * r, -0.01), (c * r * 0.6, s_ * r * 0.6, 0.02), (c * 0.12, s_ * 0.12, 0.12), (c * 0.03, s_ * 0.03, 0.34)], 0.025, 0.075, 'Fix_7a5a3e', verts=8)
    for i in range(3):
        a = i / 3 * math.tau + 0.6
        tparts += _tube([(-0.02, 0.0, 0.95), (math.cos(a) * 0.3, math.sin(a) * 0.3, 1.2)], 0.045, 0.028, 'Fix_7a5a3e', verts=8)
    trunk = merge(tparts, 'jt_trunk')
    C.voxel_remesh(trunk, voxel=0.018, smooth_iterations=3)
    for v in trunk.data.vertices:
        if v.co.z < 0:
            v.co.z = 0.0
    C.decimate(trunk, 520)
    C.set_material(trunk, mat('Fix_7a5a3e'))
    C.shade_smooth(trunk)
    # crown: distinct puffs, only lightly melted together so the lumps stay readable
    cparts = []
    puffs = []
    for i in range(11):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.1, 0.46) if i else 0.0
        r = rng.uniform(0.17, 0.3) if i else 0.3
        z = 1.3 + rng.uniform(-0.02, 0.14) - d * 0.28 + (0.1 if i == 0 else 0)
        puffs.append((Vector((math.cos(a) * d, math.sin(a) * d, z)), r))
        cparts.append(_ico(r, (math.cos(a) * d, math.sin(a) * d, z), 'Fix_3f8a36', sub=3, scale=(1.1, 1.1, 0.8)))
    crown = merge(cparts, 'jt_crown')
    C.voxel_remesh(crown, voxel=0.03, smooth_iterations=2)
    C.decimate(crown, 760)
    for v in crown.data.vertices:
        v.co += v.normal * noise.noise(v.co * 7.0 + Vector((3.0, 1.0, 7.0))) * 0.018
    C.set_material(crown, mat('Fix_3f8a36'))
    C.shade_smooth(crown)
    parts = [trunk, crown]
    # leaf sprays growing out of the crown's surface near its rim
    for i in range(12):
        centre, r = puffs[rng.randrange(1, len(puffs))]
        a = math.atan2(centre.y, centre.x) + rng.uniform(-0.8, 0.8)
        base = centre + Vector((math.cos(a) * r * 0.92, math.sin(a) * r * 0.92, rng.uniform(-0.08, 0.02)))
        parts.append(_leaf(rng.uniform(0.14, 0.2), rng.uniform(0.07, 0.1), tuple(base), a, 0.08, rng.choice(('Fix_2f6a2a', 'Fix_3f8a36', 'Fix_4f9a3a', 'Fix_5aa845')), tilt=-0.1, segments=3))
    for i in range(4):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.28, 0.42)
        x, y = math.cos(a) * d, math.sin(a) * d
        L = rng.uniform(0.4, 0.7)
        liana = merge(_tube([(x, y, 1.18), (x + 0.03, y, 1.18 - L * 0.5), (x - 0.01, y + 0.02, 1.18 - L)], 0.012, 0.009, 'Fix_4a6a2a', verts=5), 'liana')
        C.shade_smooth(liana)
        parts.append(liana)
    return finish(merge(parts, 'jungleTree'), 'jungleTree', smooth=False)


@piece('banana')
def banana():
    rng = random.Random(302)
    parts = _tube([(0, 0, 0), (0.01, 0, 0.22), (0.0, 0.01, 0.42)], 0.05, 0.035, 'Fix_7a9a4a', verts=8)
    for i in range(7):
        a = i / 7 * math.tau + rng.uniform(-0.2, 0.2)
        parts.append(_leaf(rng.uniform(0.42, 0.55), 0.13, (0, 0, 0.4 + rng.uniform(-0.04, 0.04)), a, 0.28, 'Fix_4a9a3a' if i % 2 else 'Fix_5aa845', tilt=0.5))
    for i in range(5):
        a = i / 5 * math.tau
        parts.append(_cone(0.018, 0.008, 0.09, (0.08 + math.cos(a) * 0.03, math.sin(a) * 0.03, 0.3), 'Fix_e8d04a', verts=5, rot=(0, 0.6, a)))
    return finish(merge(parts, 'banana'), 'banana', smooth=False)


@piece('mossRock')
def moss_rock():
    parts = [_rock(0.2, (0, 0, 0.12), seed=41, scale=(1.25, 1.0, 0.8)), _rock(0.11, (0.2, 0.1, 0.07), seed=42)]
    parts.append(_ico(0.19, (0.0, 0.02, 0.2), 'Fix_4a8a34', sub=2, scale=(1.2, 1.0, 0.38), jitter=0.03, seed=43))
    parts.append(_ico(0.09, (0.2, 0.11, 0.12), 'Fix_5a9a3a', sub=2, scale=(1.1, 1.0, 0.4), jitter=0.02, seed=44))
    rng = random.Random(303)
    for i in range(4):
        a = rng.uniform(0, math.tau)
        parts.append(_leaf(0.16, 0.05, (math.cos(a) * 0.22, math.sin(a) * 0.22, 0.01), a, 0.05, 'Fix_3f8a36', tilt=0.6, segments=4))
    return finish(merge(parts, 'mossRock'), 'mossRock', smooth=False)


@piece('stiltHut')
def stilt_hut():
    """Jungle house on stilts (2x2 tiles): bamboo walls, deep thatch, porch and ladder."""
    parts = []
    bamboo = 'Fix_c8b070'
    for x in (-0.55, 0.0, 0.55):
        for y in (-0.45, 0.45):
            parts += _tube([(x, y, 0), (x, y, 0.5)], 0.035, 0.03, 'Fix_8a6a40', verts=7)
    parts.append(_box((1.36, 1.12, 0.06), (0, -0.08, 0.52), 'Fix_9a6a3a', bev=0.01))
    for i in range(12):
        parts.append(_box((0.1, 1.1, 0.012), (-0.62 + i * 0.113, -0.08, 0.556), 'Fix_a8784a'))
    # bamboo walls
    for i in range(22):
        t = i / 21
        parts.append(_cyl(0.022, 0.46, (-0.45 + t * 0.9, 0.36, 0.78), bamboo, verts=6))
        if not (0.38 < t < 0.62):
            parts.append(_cyl(0.022, 0.46, (-0.45 + t * 0.9, -0.3, 0.78), bamboo, verts=6))
    for i in range(14):
        t = i / 13
        for x in (-0.46, 0.46):
            parts.append(_cyl(0.022, 0.46, (x, -0.3 + t * 0.66, 0.78), bamboo, verts=6))
    parts.append(_box((0.22, 0.02, 0.36), (0, -0.29, 0.74), 'Fix_2a1a10'))
    parts.append(_box((0.94, 0.68, 0.04), (0, 0.03, 1.0), 'Fix_8a6a40'))
    # round, layered thatch with a shaggy fringe
    rng2 = random.Random(307)
    for k, (r, h, z, col) in enumerate(((1.0, 0.5, 1.2, 'Fix_a88a4a'), (0.82, 0.44, 1.33, 'Fix_c0a060'), (0.58, 0.38, 1.47, 'Fix_d4b46a'))):
        bm = bmesh.new()
        ring = 20
        rim = []
        for i in range(ring):
            a = i / ring * math.tau
            rr = r * (1 + rng2.uniform(-0.05, 0.05))
            rim.append(bm.verts.new((math.cos(a) * rr, 0.03 + math.sin(a) * rr * 0.9, z - h / 2 + rng2.uniform(-0.05, 0.02))))
        apex = bm.verts.new((0, 0.03, z + h / 2))
        for i in range(ring):
            bm.faces.new((rim[i], rim[(i + 1) % ring], apex))
        bm.faces.new(list(reversed(rim)))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        roof = new_obj('thatch', bm)
        assign(roof, col)
        parts.append(roof)
    parts += _tube([(0, 0.03, 1.64), (0.03, 0.05, 1.8)], 0.035, 0.02, 'Fix_8a6a40', verts=6)
    # porch railing and ladder
    for i in range(7):
        x = -0.6 + i * 0.2
        parts.append(_cyl(0.015, 0.2, (x, -0.62, 0.65), bamboo, verts=5))
    parts.append(_cyl(0.018, 1.25, (0.0, -0.62, 0.75), bamboo, verts=5, rot=(0, math.pi / 2, 0)))
    for s in (-1, 1):
        parts += _tube([(0.72 + s * 0.09, -0.35, 0.0), (0.66 + s * 0.09, -0.35, 0.55)], 0.016, 0.014, 'Fix_8a6a40', verts=5)
    for i in range(5):
        z = 0.08 + i * 0.1
        parts.append(_cyl(0.011, 0.2, (0.72 - z * 0.1, -0.35, z), 'Fix_8a6a40', verts=5, rot=(0, math.pi / 2, 0)))
    # lantern by the door
    parts.append(_ico(0.05, (0.35, -0.55, 0.95), 'Fix_ffb050', sub=2))
    parts.append(_cyl(0.006, 0.12, (0.35, -0.55, 1.05), 'Fix_2a2a2a', verts=4))
    return finish(merge(parts, 'stiltHut'), 'stiltHut', smooth=False)


def vines_piece(name, seed):
    """Vines hanging over a cliff edge (the tile's south side, Blender -Y), irregular."""
    rng = random.Random(seed)
    parts = []
    count = rng.randint(3, 5)
    xs = sorted(rng.uniform(-0.42, 0.42) for _ in range(count))
    for x in xs:
        L = rng.uniform(0.25, 0.9)
        pts = [(x + rng.uniform(-0.05, 0.05), -0.25, H + 0.005), (x, -0.52, H - 0.03), (x + rng.uniform(-0.03, 0.03), -0.575, H - 0.18)]
        z = H - 0.18
        sway = rng.uniform(-0.06, 0.06)
        while z > H - L:
            z -= rng.uniform(0.1, 0.16)
            sway += rng.uniform(-0.03, 0.03)
            pts.append((x + sway, -0.58 - rng.uniform(0, 0.04), z))
        parts += _tube(pts, 0.011, 0.006, 'Fix_3a6a2a', verts=4)
        for k in range(1, len(pts)):
            if rng.random() < 0.35:
                continue
            p = pts[k]
            for j in range(rng.randint(1, 3)):
                a = rng.uniform(-1.2, 1.2)
                r = rng.uniform(0.028, 0.048)
                parts.append(_ico(r, (p[0] + math.sin(a) * r * 0.9, p[1] - 0.015, p[2] + math.cos(a) * r * 0.5), rng.choice(('Fix_3f8a36', 'Fix_4a9a3a', 'Fix_5aa845', 'Fix_2f6a2a')), sub=1, scale=(1.2, 0.45, 0.9)))
    # leafy tuft on the lip where they hang from
    for x in xs:
        parts.append(_ico(0.06, (x, -0.42, H + 0.02), 'Fix_3f8a36', sub=1, scale=(1.4, 1.0, 0.5), jitter=0.01, seed=int(x * 100)))
    return finish(merge(parts, name), name, smooth=False)


@piece('vines')
def vines():
    return vines_piece('vines', 305)


@piece('vinesB')
def vines_b():
    return vines_piece('vinesB', 311)


@piece('icicles')
def icicles():
    rng = random.Random(306)
    parts = [_box((0.9, 0.08, 0.05), (0, -0.53, H - 0.02), 'Fix_eef6ff', bev=0.02)]
    for i in range(9):
        x = -0.4 + i * 0.1 + rng.uniform(-0.02, 0.02)
        L = rng.uniform(0.08, 0.28)
        parts.append(_cone(0.022, 0.0, L, (x, -0.565, H - 0.04 - L / 2), 'Fix_cfe8ff', verts=6, rot=(math.pi, 0, 0)))
    return finish(merge(parts, 'icicles'), 'icicles', smooth=False)


@piece('cottage')
def cottage():
    """Meadow cottage (2x2 tiles): stone footing, timber walls, steep roof, chimney."""
    parts = [_box((1.3, 1.0, 0.14), (0, 0, 0.07), 'Fix_9a948a', bev=0.03)]
    parts.append(_box((1.2, 0.9, 0.62), (0, 0, 0.45), 'Fix_f0e2c4', bev=0.02))
    for x in (-0.6, -0.2, 0.2, 0.6):
        parts.append(_box((0.06, 0.93, 0.64), (x, 0, 0.45), 'Fix_7a5236'))
    parts.append(_box((1.23, 0.93, 0.06), (0, 0, 0.74), 'Fix_7a5236'))
    roof = bmesh.new()
    pts = [(-0.75, -0.6, 0.76), (0.75, -0.6, 0.76), (0.75, 0.6, 0.76), (-0.75, 0.6, 0.76), (-0.75, 0, 1.3), (0.75, 0, 1.3)]
    vv = [roof.verts.new(p) for p in pts]
    for f in ((0, 1, 5, 4), (3, 4, 5, 2), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)):
        roof.faces.new([vv[i] for i in f])
    bmesh.ops.recalc_face_normals(roof, faces=roof.faces[:])
    r = new_obj('roof', roof)
    assign(r, 'Fix_c8583a')
    parts.append(r)
    for k in range(5):
        z = 0.82 + k * 0.1
        w = 0.6 * (1 - (z - 0.76) / 0.54)
        for s in (-1, 1):
            parts.append(_box((1.52, 0.02, 0.02), (0, s * (w + 0.005), z), 'Fix_a8442a'))
    parts.append(_box((0.16, 0.16, 0.4), (0.4, 0.2, 1.22), 'Fix_9a948a', bev=0.02))
    parts.append(_box((0.2, 0.2, 0.05), (0.4, 0.2, 1.43), 'Fix_7a746a'))
    parts.append(_box((0.24, 0.03, 0.4), (0.0, -0.46, 0.34), 'Fix_6a4428', bev=0.01))
    parts.append(_ico(0.02, (0.07, -0.49, 0.34), 'Fix_e8c84a', sub=1))
    for x in (-0.38, 0.38):
        parts.append(_box((0.2, 0.03, 0.18), (x, -0.46, 0.5), 'Fix_8ac8e8'))
        parts.append(_box((0.24, 0.07, 0.05), (x, -0.49, 0.39), 'Fix_7a5236'))
        for k in range(4):
            parts.append(_ico(0.028, (x - 0.08 + k * 0.055, -0.5, 0.43), ['Fix_ff6a8a', 'Fix_ffd84a', 'Fix_ffffff', 'Fix_9a7aff'][k], sub=1))
    return finish(merge(parts, 'cottage'), 'cottage', smooth=False)


@piece('waterTower')
def water_tower():
    """Wild-west water tower (2x2 tiles) on four timber legs."""
    parts = []
    for x in (-0.42, 0.42):
        for y in (-0.42, 0.42):
            parts += _tube([(x, y, 0), (x * 0.8, y * 0.8, 1.0)], 0.05, 0.045, 'Fix_7a5236', verts=6)
    for z in (0.3, 0.65):
        k = 1 - z * 0.2
        for s in (-1, 1):
            parts.append(_box((0.86 * k, 0.04, 0.05), (0, s * 0.42 * k, z), 'Fix_6a4428'))
            parts.append(_box((0.04, 0.86 * k, 0.05), (s * 0.42 * k, 0, z), 'Fix_6a4428'))
    parts.append(_box((0.9, 0.9, 0.05), (0, 0, 1.02), 'Fix_6a4428'))
    parts.append(_lathe([(0, 1.04), (0.46, 1.04), (0.46, 1.5), (0, 1.5)], (0, 0, 0), 'Fix_9a6a3e', segs=18))
    for z in (1.12, 1.27, 1.42):
        parts.append(_torus(0.465, 0.012, (0, 0, z), 'Fix_3a3a40', major=24, minor=4))
    parts.append(_cone(0.52, 0.03, 0.34, (0, 0, 1.66), 'Fix_7a4a30', verts=18))
    parts += _tube([(0.3, -0.35, 1.1), (0.45, -0.55, 0.9), (0.46, -0.6, 0.75)], 0.03, 0.03, 'Fix_3a3a40', verts=6)
    for i in range(10):
        z = 0.1 + i * 0.1
        parts.append(_box((0.16, 0.02, 0.015), (-0.5, -0.36, z), 'Fix_8a6a44'))
    for s in (-1, 1):
        parts.append(_box((0.02, 0.02, 1.02), (-0.5 + s * 0.08, -0.36, 0.51), 'Fix_8a6a44'))
    return finish(merge(parts, 'waterTower'), 'waterTower', smooth=False)


# --- build & export ---------------------------------------------------------------------------------

def build():
    C.reset_scene()
    objs = []
    for name, fn in PIECES:
        o = fn()
        o.location = (0, 0, 0)
        objs.append(o)
    # spread them out so baking AO does not see neighbours (then put back)
    for i, o in enumerate(objs):
        o.location = ((i % 8) * 4.0, (i // 8) * 4.0, 0)
    # ground plane under ground-level pieces so AO darkens their base
    C.bake_vertex_ao(objs)
    for o in objs:
        o.location = (0, 0, 0)
    strata_tint(objs)
    crown_tint(objs)
    return objs


CROWNS = {'jungleTree': 'Fix_3f8a36', 'tree': 'Leaf', 'bush': 'Leaf'}


def crown_tint(objs):
    """Tree crowns: dark and cool underneath, sunlit on top (multiplied into the vertex colours)."""
    for o in objs:
        role = CROWNS.get(o.name)
        if not role:
            continue
        me = o.data
        col = me.color_attributes.get('Col')
        idx = {i for i, m in enumerate(me.materials) if m and m.name == role}
        if col is None or not idx:
            continue
        zs = [me.vertices[me.loops[li].vertex_index].co.z for poly in me.polygons if poly.material_index in idx for li in poly.loop_indices]
        lo, hi = min(zs), max(zs)
        for poly in me.polygons:
            if poly.material_index not in idx:
                continue
            for li in poly.loop_indices:
                t = (me.vertices[me.loops[li].vertex_index].co.z - lo) / max(1e-4, hi - lo)
                f = 0.62 + 0.5 * t * t * (3 - 2 * t)
                c = col.data[li].color
                col.data[li].color = (min(1, c[0] * f), min(1, c[1] * f), min(1, c[2] * f * 0.95), c[3])


def strata_tint(objs):
    """Rock walls get irregular horizontal bands of lighter and darker stone."""
    for o in objs:
        me = o.data
        col = me.color_attributes.get('Col')
        if col is None:
            continue
        rock = {i for i, m in enumerate(me.materials) if m and m.name in ('Rock', 'Chasm')}
        if not rock or not (o.name.startswith('cliff_') or o.name.startswith('chasm_')):
            continue
        for poly in me.polygons:
            if poly.material_index not in rock:
                continue
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                band = 0.93 + 0.09 * noise.noise(Vector((0.3, 0.7, co.z * 4.5))) + 0.035 * noise.noise(Vector((co.x * 4, co.y * 4, co.z * 11)))
                c = col.data[li].color
                col.data[li].color = (min(1, c[0] * band), min(1, c[1] * band), min(1, c[2] * band), c[3])


if __name__ == '__main__':
    objs = build()
    print('PIECES', len(objs), sum(C.tri_count(o) for o in objs))
    path = C.export_glb('terrain', objects=objs, vertex_colors=True)
    print('EXPORTED', path)
    if C.arg('preview'):
        only = C.arg('only')
        shown = [o for o in objs if not only or o.name in only.split(',')]
        for o in objs:
            if o not in shown:
                o.hide_render = True
        for i, o in enumerate(shown):
            o.location = ((i % 6) * 1.4 - 3.5, (i // 6) * 1.4 - 2.5, 0)
        cam, target, dist, h = C.setup_preview(target=(0, 0, 0.3), distance=9, height=6.5, size=1024)
        C.render_views('terrain', cam, target, dist, h, angles=(0,))
