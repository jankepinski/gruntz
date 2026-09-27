"""World hazards: lava geyser, candle, trapdoor, electric outlet, firework mortar, bird and
toy plane (with separate wings / propeller for animation), dropped coconut and candy bomb,
storm cloud and UFO. Exports apps/client/public/models/hazards.glb.

Objects whose name contains a dot-free suffix like 'birdWingL' keep their origin at the
joint so the game can rotate them.
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
from items import box, cyl, join, m, sphere, torus, steel, gold  # noqa: E402
from props import rock_mesh  # noqa: E402

HAZARDS = []


def hazard(name):
    def deco(fn):
        HAZARDS.append((name, fn))
        return fn
    return deco


def set_origin(obj, point):
    """Move the object's origin to a joint (the mesh stays where it is)."""
    C.select_only(obj)
    bpy.context.scene.cursor.location = point
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    bpy.context.scene.cursor.location = (0, 0, 0)


def lava():
    return m('Lava', 0xff6a1a, 0.4, emit=2.2)


def basalt():
    return m('Basalt', 0x3a3230, 0.95)


@hazard('geyser')
def geyser():
    rng = random.Random(4)
    parts = []
    # a ring of dark rocks around a glowing vent
    for i in range(9):
        a = i / 9 * math.tau + rng.uniform(-0.15, 0.15)
        r = 0.36 + rng.uniform(-0.03, 0.04)
        parts.append(rock_mesh(f'gy{i}', rng.uniform(0.12, 0.17), (math.cos(a) * r, math.sin(a) * r, 0), (1.2, 1.0, 1.1), seed=100 + i, subdiv=1, amp=0.25, mat=basalt()))
    cone = cyl(0.42, 0.14, (0, 0, 0.05), verts=18, mat=basalt(), r2=0.26)
    parts.append(cone)
    parts.append(cyl(0.24, 0.04, (0, 0, 0.1), verts=24, mat=lava()))
    # crusty dark islands on the lava
    for i in range(4):
        a = rng.uniform(0, math.tau)
        parts.append(sphere(rng.uniform(0.03, 0.05), (math.cos(a) * 0.12, math.sin(a) * 0.12, 0.12), (1, 1, 0.4), basalt(), seg=8, rings=5))
    return join(parts, 'geyser')


@hazard('candle')
def candle():
    wax = m('Wax', 0xfff2ea, 0.5)
    stripe = m('WaxStripe', 0xf27aa8, 0.5)
    parts = [cyl(0.24, 0.8, (0, 0, 0.42), verts=24, mat=wax, bev=0.02)]
    # candy-cane spiral stripe
    for i in range(14):
        a = i / 14 * math.tau * 2
        parts.append(box((0.07, 0.03, 0.06), (math.cos(a) * 0.245, math.sin(a) * 0.245, 0.06 + i * 0.052), rot=(0.4, 0, a + math.pi / 2), mat=stripe, bev=0.01))
    # wax drips
    rng = random.Random(9)
    for i in range(6):
        a = rng.uniform(0, math.tau)
        z = 0.82 - rng.uniform(0.02, 0.3)
        parts.append(sphere(0.045, (math.cos(a) * 0.235, math.sin(a) * 0.235, z), (1, 1, 2.2), wax, seg=10, rings=6))
    parts.append(torus(0.2, 0.04, (0, 0, 0.82), mat=wax))
    parts.append(cyl(0.015, 0.1, (0, 0, 0.88), mat=m('Wick', 0x2a2420, 0.9)))
    # holder dish
    parts.append(cyl(0.36, 0.05, (0, 0, 0.025), verts=24, mat=gold(), bev=0.01))
    parts.append(torus(0.34, 0.03, (0, 0, 0.05), mat=gold()))
    return join(parts, 'candle')


@hazard('trapdoor')
def trapdoor():
    frame = m('TrapFrame', 0x6a6a74, 0.5, 0.5)
    parts = []
    for x, y, w, h in [(0, 0.45, 0.96, 0.06), (0, -0.45, 0.96, 0.06), (0.45, 0, 0.06, 0.96), (-0.45, 0, 0.06, 0.96)]:
        parts.append(box((w, h, 0.05), (x, y, 0.0), mat=frame, bev=0.01))
    parts.append(box((0.84, 0.84, 0.02), (0, 0, -0.3), mat=m('Pit', 0x0a0808, 1.0), bev=0))
    for k in range(4):
        z = -0.02 - k * 0.07
        for x, y, w, h in [(0, 0.42, 0.84, 0.02), (0, -0.42, 0.84, 0.02), (0.42, 0, 0.02, 0.84), (-0.42, 0, 0.02, 0.84)]:
            parts.append(box((w, h, 0.07), (x, y, z), mat=m('PitWall', 0x2a2426, 0.9), bev=0))
    base = join(parts, 'trapdoor')
    doors = []
    for side, name in ((-1, 'trapdoorL'), (1, 'trapdoorR')):
        d = [box((0.42, 0.86, 0.04), (side * 0.21, 0, 0.02), mat=m('TrapDoor', 0xa0402a, 0.6), bev=0.01)]
        # stars on the doors (a show stage trapdoor)
        d.append(cyl(0.09, 0.012, (side * 0.21, 0, 0.045), verts=5, mat=gold()))
        for yy in (-0.3, 0.3):
            d.append(box((0.36, 0.05, 0.012), (side * 0.21, yy, 0.045), mat=gold(), bev=0.004))
        door = join(d, name)
        set_origin(door, (side * 0.42, 0, 0.02))
        doors.append(door)
    return [base] + doors


@hazard('outlet')
def outlet():
    plastic = m('Plastic', 0xf4f1ea, 0.35)
    slot = m('Slot', 0x141212, 0.9)
    parts = [box((0.78, 0.78, 0.08), (0, 0, 0.04), mat=plastic, bev=0.04, seg=3)]
    parts.append(box((0.6, 0.6, 0.03), (0, 0, 0.09), mat=plastic, bev=0.02))
    for x in (-0.12, 0.12):
        parts.append(box((0.06, 0.16, 0.04), (x, 0.05, 0.1), mat=slot, bev=0.005))
    parts.append(cyl(0.05, 0.04, (0, -0.15, 0.1), verts=12, mat=slot))
    parts.append(cyl(0.035, 0.02, (0, 0.3, 0.1), verts=12, mat=steel()))
    parts.append(box((0.05, 0.008, 0.01), (0, 0.3, 0.112), mat=slot, bev=0))
    return join(parts, 'outlet')


@hazard('mortar')
def mortar():
    red = m('Card', 0xd8402a, 0.8)
    yellow = m('CardStripe', 0xf2c230, 0.8)
    parts = [cyl(0.22, 0.6, (0, 0, 0.32), verts=18, mat=red)]
    for z in (0.12, 0.32, 0.52):
        parts.append(cyl(0.225, 0.07, (0, 0, z), verts=18, mat=yellow))
    parts.append(torus(0.19, 0.03, (0, 0, 0.62), mat=m('CardDark', 0x6a1a14, 0.9)))
    parts.append(box((0.62, 0.62, 0.06), (0, 0, 0.03), mat=m('Crate', 0x9a6a3a, 0.8), bev=0.02))
    fuse = cyl(0.012, 0.3, (0.24, 0, 0.3), (0, 0.6, 0), mat=m('Fuse', 0x3a2a1a, 0.9))
    parts.append(fuse)
    return join(parts, 'mortar')


@hazard('bird')
def bird():
    red = m('Feather', 0xe8342a, 0.6)
    blue = m('FeatherBlue', 0x2a6ad8, 0.6)
    yellow = m('FeatherYellow', 0xf2c230, 0.6)
    beak = m('Beak', 0x2a2420, 0.4)
    eye = m('BirdEye', 0x101010, 0.2)
    white = m('BirdWhite', 0xf8f8f8, 0.5)
    parts = [sphere(0.22, (0, 0, 0), (0.8, 1.45, 0.8), red, seg=18, rings=12)]
    parts.append(sphere(0.15, (0, 0.3, 0.08), mat=red, seg=16, rings=10))
    parts.append(cyl(0.05, 0.14, (0, 0.46, 0.05), (math.pi / 2 + 0.5, 0, 0), verts=10, mat=beak, r2=0.005))
    for sx in (-1, 1):
        parts.append(sphere(0.045, (sx * 0.1, 0.36, 0.13), mat=white, seg=10, rings=6))
        parts.append(sphere(0.022, (sx * 0.125, 0.39, 0.14), mat=eye, seg=8, rings=5))
    # long tail feathers
    for i, (mat, a) in enumerate(((blue, -0.2), (yellow, 0.0), (blue, 0.2))):
        parts.append(box((0.08, 0.5, 0.02), (a * 0.4, -0.52, -0.02), rot=(0.25, 0, a), mat=mat, bev=0.01))
    body = join(parts, 'bird')
    wings = []
    for sx, name in ((-1, 'birdWingL'), (1, 'birdWingR')):
        w = []
        for k, (mat, length) in enumerate(((red, 0.42), (yellow, 0.36), (blue, 0.3))):
            w.append(box((length, 0.13 - k * 0.02, 0.025), (sx * (0.14 + length / 2), 0.05 - k * 0.1, 0.02), rot=(0, 0, sx * -0.12 * k), mat=mat, bev=0.01))
        wing = join(w, name)
        set_origin(wing, (sx * 0.14, 0.0, 0.02))
        wings.append(wing)
    return [body] + wings


@hazard('plane')
def plane():
    body_mat = m('PlaneBody', 0xf2c230, 0.4)
    wing_mat = m('PlaneWing', 0xd8402a, 0.4)
    parts = [cyl(0.12, 0.8, (0, 0, 0), (math.pi / 2, 0, 0), verts=14, mat=body_mat, r2=0.07)]
    parts.append(sphere(0.12, (0, 0.4, 0), (1, 0.6, 1), body_mat, seg=14, rings=8))
    for z in (-0.1, 0.16):
        parts.append(box((1.2, 0.22, 0.03), (0, 0.12, z), mat=wing_mat, bev=0.01))
    for x in (-0.45, 0.45):
        parts.append(box((0.02, 0.02, 0.26), (x, 0.12, 0.03), mat=steel(), bev=0))
    parts.append(box((0.4, 0.12, 0.02), (0, -0.38, 0.0), mat=wing_mat, bev=0.01))
    parts.append(box((0.02, 0.14, 0.18), (0, -0.4, 0.08), mat=wing_mat, bev=0.005))
    parts.append(sphere(0.08, (0, 0.05, 0.13), (1, 1.3, 0.8), m('Cockpit', 0x6ad8ff, 0.1, 0.2), seg=12, rings=8))
    body = join(parts, 'plane')
    prop = join([box((0.5, 0.02, 0.05), (0, 0.49, 0), mat=m('Prop', 0x3a2a1a, 0.6), bev=0.01), sphere(0.04, (0, 0.5, 0), mat=gold(), seg=10, rings=6)], 'planeProp')
    set_origin(prop, (0, 0.49, 0))
    return [body, prop]


@hazard('coconut')
def coconut():
    rng = random.Random(3)
    shell = m('Coconut', 0x6a4020, 0.95)
    parts = [sphere(0.16, (0, 0, 0.16), (1, 1, 0.92), shell, seg=16, rings=10)]
    for i in range(18):
        a = rng.uniform(0, math.tau)
        e = rng.uniform(-0.6, 0.9)
        p = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e))) * 0.16
        parts.append(box((0.08, 0.012, 0.012), (p.x, p.y, p.z + 0.16), rot=(rng.uniform(0, 3), rng.uniform(0, 3), a), mat=m('CoconutHair', 0x8a6040, 1.0), bev=0))
    for i in range(3):
        a = i / 3 * math.tau
        parts.append(sphere(0.02, (math.cos(a) * 0.05, math.sin(a) * 0.05, 0.3), mat=m('CoconutEye', 0x2a1a10, 0.9), seg=8, rings=5))
    return join(parts, 'coconut')


@hazard('candybomb')
def candy_bomb():
    wrap = m('CandyWrap', 0x7a3ad8, 0.3)
    stripe = m('CandyStripe', 0xfff2f6, 0.3)
    parts = [sphere(0.16, (0, 0, 0.16), mat=wrap, seg=18, rings=12)]
    for i in range(4):
        a = i / 4 * math.pi
        parts.append(torus(0.16, 0.018, (0, 0, 0.16), (math.pi / 2, 0, a), mat=stripe, maj=24, mino=6))
    for sx in (-1, 1):
        parts.append(cyl(0.1, 0.12, (sx * 0.2, 0, 0.16), (0, math.pi / 2, 0), verts=8, mat=wrap, r2=0.02))
    return join(parts, 'candybomb')


@hazard('cloud')
def cloud():
    rng = random.Random(12)
    grey = m('Storm', 0x5a5e6a, 0.95)
    dark = m('StormDark', 0x3a3e4a, 0.95)
    parts = []
    for i in range(11):
        a = rng.uniform(0, math.tau)
        d = rng.uniform(0.0, 0.55)
        r = rng.uniform(0.28, 0.42)
        parts.append(sphere(r, (math.cos(a) * d, math.sin(a) * d * 0.8, rng.uniform(-0.05, 0.18)), (1.1, 1.0, 0.8), grey if i % 3 else dark, seg=14, rings=9))
    # flat, darker belly
    parts.append(sphere(0.7, (0, 0, -0.12), (1.1, 0.9, 0.22), dark, seg=18, rings=8))
    return join(parts, 'cloud')


@hazard('ufo')
def ufo():
    hull = m('UfoHull', 0xb8c0cc, 0.25, 0.8)
    rim = m('UfoRim', 0x6a7080, 0.3, 0.7)
    glass = m('UfoGlass', 0x8ae8ff, 0.05, 0.1)
    light = m('UfoLight', 0x9aff6a, 0.3, emit=2.5)
    alien = m('Alien', 0x6ad84a, 0.6)
    parts = [sphere(0.6, (0, 0, 0), (1, 1, 0.22), hull, seg=32, rings=14)]
    parts.append(torus(0.58, 0.05, (0, 0, 0), mat=rim, maj=40, mino=8))
    parts.append(sphere(0.26, (0, 0, 0.1), (1, 1, 0.85), glass, seg=24, rings=12))
    parts.append(sphere(0.1, (0, 0, 0.14), mat=alien, seg=14, rings=9))
    for sx in (-1, 1):
        parts.append(sphere(0.035, (sx * 0.04, 0.08, 0.18), mat=m('AlienEye', 0x101010, 0.1), seg=8, rings=5))
    for i in range(10):
        a = i / 10 * math.tau
        parts.append(sphere(0.045, (math.cos(a) * 0.5, math.sin(a) * 0.5, -0.03), mat=light, seg=8, rings=5))
    parts.append(cyl(0.2, 0.08, (0, 0, -0.13), verts=20, mat=rim))
    return join(parts, 'ufo')


if __name__ == '__main__':
    C.reset_scene()
    objs = []
    for name, fn in HAZARDS:
        o = fn()
        objs += o if isinstance(o, list) else [o]
    print('HAZARDS', len(objs), sum(C.tri_count(o) for o in objs))
    path = C.export_glb('hazards', objects=objs)
    print('EXPORTED', path)
    if C.arg('preview'):
        roots = [o for o in objs if not any(k in o.name for k in ('Wing', 'Prop', 'trapdoorL', 'trapdoorR'))]
        for i, o in enumerate(roots):
            dx = (i % 6) * 1.6 - 4
            dy = (i // 6) * 1.8
            for other in objs:
                if other is o or other.name.startswith(o.name) and other.name != o.name:
                    other.location.x += dx
                    other.location.y += dy
            if o.name in ('bird', 'plane', 'cloud', 'ufo'):
                for other in objs:
                    if other is o or other.name.startswith(o.name) and other.name != o.name:
                        other.location.z += 0.8
        cam, target, dist, h = C.setup_preview(target=(0, 1.0, 0.4), distance=9.5, height=5, size=1100)
        C.render_views('hazards', cam, target, dist, h, angles=(15,))
