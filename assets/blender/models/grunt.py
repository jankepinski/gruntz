"""The grunt: hero character. Built from metaballs (clay-like blending), remeshed,
rigged with an armature and animated. Exports apps/client/public/models/grunt.glb.

Blender axes: Z up, the grunt faces -Y (becomes +Z in glTF / three.js).
"""

import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'lib'))
import common as C  # noqa: E402

SKIN = C.hex_color(0xece6dc)  # neutral clay: tinted with the team colour in game
CLOTH = C.hex_color(0x6b4424)
BELT = C.hex_color(0x3e2616)
EYE_WHITE = C.hex_color(0xfbf6ea)
PUPIL = C.hex_color(0x17110d)
TOOTH = C.hex_color(0xf4ecd6)
MOUTH = C.hex_color(0x3a1510)
NAIL = C.hex_color(0xb8aa98)


def mirror(fn):
    """Call fn(side) for side in (-1, +1)."""
    for side in (-1, 1):
        fn(side)


# --- body (metaballs) --------------------------------------------------------------------

def build_body():
    mb = bpy.data.metaballs.new('grunt_mb')
    mb.resolution = 0.012
    mb.render_resolution = 0.008
    mb.threshold = 0.6
    obj = bpy.data.objects.new('grunt_mb', mb)
    bpy.context.collection.objects.link(obj)

    # Radii below are the *visible* sizes. A metaball's surface sits well inside its
    # field radius, so convert: the field falls off as (1 - (d/R)^2)^3 * stiffness and
    # the surface is where it equals the threshold.
    def field(r, stiff):
        k = (mb.threshold / stiff) ** (1 / 3)
        return r / math.sqrt(max(1e-4, 1 - k))

    def ball(co, r, stiff=2.0, neg=False):
        e = mb.elements.new(type='BALL')
        e.co = co
        e.radius = field(r, stiff)
        e.stiffness = stiff
        e.use_negative = neg
        return e

    def ellipsoid(co, size, r=1.0, rot=(0, 0, 0), stiff=2.0, neg=False):
        e = mb.elements.new(type='ELLIPSOID')
        e.co = co
        e.radius = field(r, stiff)
        e.size_x, e.size_y, e.size_z = size
        e.rotation = Euler(rot).to_quaternion()
        e.stiffness = stiff
        e.use_negative = neg
        return e

    def capsule(a, b, r, stiff=2.0):
        a = Vector(a)
        b = Vector(b)
        mid = (a + b) / 2
        d = b - a
        e = mb.elements.new(type='CAPSULE')
        e.co = mid
        e.radius = field(r, stiff)
        e.size_x = d.length / 2
        # capsule axis is local X
        e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
        e.stiffness = stiff
        return e

    # torso: pot belly, narrow shoulders. Big masses blend softly (low stiffness),
    # details stay crisp (high stiffness).
    ellipsoid((0, 0.01, 0.29), (0.95, 0.85, 1.05), r=0.155, stiff=3.0)
    ball((0, -0.055, 0.25), 0.118, stiff=3.5)  # belly
    ball((0, -0.168, 0.25), 0.012, stiff=8.0, neg=True)  # belly button
    ellipsoid((0, 0.0, 0.18), (1.0, 0.9, 0.6), r=0.135, stiff=3.5)  # hips
    ball((0, 0.02, 0.425), 0.075, stiff=3.0)  # neck/upper chest

    # head: big round skull with a heavy muzzle
    ellipsoid((0, 0.0, 0.63), (1.08, 0.98, 0.95), r=0.2, stiff=4.0)
    ball((0, 0.04, 0.70), 0.15, stiff=4.0)  # back of skull
    ellipsoid((0, -0.11, 0.555), (1.25, 0.9, 0.7), r=0.115, stiff=4.0)  # muzzle/jaw
    ellipsoid((0, -0.215, 0.622), (0.9, 1.05, 1.05), r=0.066, stiff=6.0)  # bulbous nose
    ball((0, -0.258, 0.592), 0.043, stiff=6.0)  # nose tip, drooping
    mirror(lambda s: ball((s * 0.03, -0.245, 0.586), 0.024, stiff=7.0))  # nostril wings
    mirror(lambda s: ball((s * 0.017, -0.262, 0.566), 0.012, stiff=8.0, neg=True))  # nostrils
    capsule((-0.105, -0.175, 0.712), (0.105, -0.175, 0.712), 0.04, stiff=5.0)  # brow ridge
    mirror(lambda s: ball((s * 0.075, -0.18, 0.724), 0.035, stiff=6.0))  # brow bumps
    ball((0, -0.165, 0.49), 0.045, stiff=5.0)  # chin
    capsule((-0.055, -0.19, 0.5), (0.055, -0.19, 0.5), 0.018, stiff=7.0)  # lower lip
    mirror(lambda s: ball((s * 0.115, -0.135, 0.585), 0.058, stiff=5.0))  # cheeks
    mirror(lambda s: ball((s * 0.13, -0.06, 0.505), 0.048, stiff=4.5))  # jowls

    # ears: long, pointed, sticking out sideways and slightly up/back
    def ear(s):
        steps = 11
        for i in range(steps):
            t = i / (steps - 1)
            x = s * (0.17 + 0.33 * t)
            y = 0.02 + 0.07 * t
            z = 0.645 + 0.12 * t * t
            thick = 0.03 - 0.02 * t
            height = 0.085 * (1 - t) ** 0.85 + 0.008
            ellipsoid((x, y, z), (0.8, thick / 0.06, height / 0.06), r=0.06, stiff=5.0)
        # inner-ear hollow facing forward
        for i in range(2, steps - 3):
            t = i / (steps - 1)
            x = s * (0.17 + 0.33 * t)
            y = 0.02 + 0.07 * t - 0.022
            z = 0.645 + 0.12 * t * t
            height = 0.055 * (1 - t) ** 0.85
            ellipsoid((x, y, z), (0.7, 0.012 / 0.06, height / 0.06), r=0.06, stiff=6.0, neg=True)

    mirror(ear)

    # arms: long, hanging, big hands with stubby fingers
    def arm(s):
        shoulder = Vector((s * 0.155, 0.01, 0.395))
        elbow = Vector((s * 0.25, -0.005, 0.27))
        wrist = Vector((s * 0.28, -0.04, 0.155))
        capsule(shoulder, elbow, 0.043, stiff=4.0)
        capsule(elbow, wrist, 0.039, stiff=4.5)
        ellipsoid(wrist + Vector((s * 0.005, -0.02, -0.04)), (0.9, 1.1, 1.0), r=0.05, stiff=5.0)  # palm
        for j, (fx, fy) in enumerate(((-0.024, -0.045), (0.0, -0.052), (0.024, -0.045))):
            base = wrist + Vector((s * (0.005 + fx), fy, -0.075))
            capsule(base, base + Vector((0, -0.012, -0.035)), 0.016, stiff=7.0)
        thumb = wrist + Vector((s * -0.035, -0.05, -0.035))
        capsule(thumb, thumb + Vector((s * -0.01, -0.03, -0.012)), 0.017, stiff=7.0)

    mirror(arm)

    # legs: short and stocky, big flat feet
    def leg(s):
        hip = Vector((s * 0.08, 0.0, 0.15))
        knee = Vector((s * 0.095, -0.01, 0.09))
        ankle = Vector((s * 0.1, 0.0, 0.045))
        capsule(hip, knee, 0.05, stiff=4.0)
        capsule(knee, ankle, 0.044, stiff=4.5)
        ellipsoid((s * 0.105, -0.045, 0.028), (0.75, 1.35, 0.5), r=0.065, stiff=5.0)  # foot
        for fx in (-0.026, 0.0, 0.026):
            ball((s * 0.105 + fx, -0.12, 0.024), 0.019, stiff=7.0)  # toes

    mirror(leg)

    # carve eye sockets and the mouth
    mirror(lambda s: ball((s * 0.07, -0.18, 0.665), 0.034, stiff=6.0, neg=True))
    ellipsoid((0, -0.2, 0.525), (1.0, 0.35, 0.22), r=0.085, stiff=6.0, neg=True)

    C.select_only(obj)
    bpy.ops.object.convert(target='MESH')
    body = bpy.context.view_layer.objects.active
    body.name = 'grunt_body'
    C.voxel_remesh(body, voxel=0.0085, smooth_iterations=4)
    C.decimate(body, 7000)
    C.shade_smooth(body)
    return body


# --- detail parts -------------------------------------------------------------------------

def uv_sphere(name, loc, r, segs=20, rings=14, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segs, ring_count=rings, radius=r, location=loc)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    C.apply_transform(o)
    C.shade_smooth(o)
    return o


def build_eyes(mats):
    parts = []
    for s in (-1, 1):
        center = Vector((s * 0.07, -0.19, 0.665))
        eye = uv_sphere(f'eye_{s}', center, 0.036, scale=(1.0, 0.85, 1.05))
        C.set_material(eye, mats['eye'])
        pupil = uv_sphere(f'pupil_{s}', center + Vector((s * -0.004, -0.03, -0.002)), 0.0135, 12, 8)
        C.set_material(pupil, mats['pupil'])
        # heavy upper lid: gives the grunt its grumpy look
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.041, location=center)
        lid = bpy.context.active_object
        lid.name = f'lid_{s}'
        me = lid.data
        bm = bmesh.new()
        bm.from_mesh(me)
        cut = [v for v in bm.verts if v.co.z < 0.004]
        bmesh.ops.delete(bm, geom=cut, context='VERTS')
        bm.to_mesh(me)
        bm.free()
        lid.rotation_euler = Euler((math.radians(-24), math.radians(s * -8), 0))
        mod = lid.modifiers.new('solid', 'SOLIDIFY')
        mod.thickness = 0.006
        C.apply_modifiers(lid)
        C.apply_transform(lid)
        C.shade_smooth(lid)
        C.set_material(lid, mats['skin'])
        parts += [eye, pupil, lid]
    return parts


def build_teeth(mats):
    parts = []
    # a crooked row of teeth along the upper lip, plus two lower fangs
    upper = [(-0.058, 0.9), (-0.03, 1.1), (0.0, 0.8), (0.03, 1.15), (0.058, 0.85)]
    for i, (x, h) in enumerate(upper):
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.013, radius2=0.004, depth=0.03 * h,
                                        location=(x, -0.214 + abs(x) * 0.35, 0.533))
        t = bpy.context.active_object
        t.rotation_euler = Euler((math.radians(180 + (i - 2) * 3), math.radians((i - 2) * 6), 0))
        t.name = f'tooth_{i}'
        C.apply_transform(t)
        C.set_material(t, mats['tooth'])
        parts.append(t)
    for s in (-1, 1):
        bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.014, radius2=0.003, depth=0.04,
                                        location=(s * 0.07, -0.2, 0.51))
        t = bpy.context.active_object
        t.rotation_euler = Euler((math.radians(-8), math.radians(s * 10), 0))
        t.name = f'fang_{s}'
        C.apply_transform(t)
        C.set_material(t, mats['tooth'])
        parts.append(t)
    # dark mouth interior so the carved slit reads as a mouth
    mouth = uv_sphere('mouth', (0, -0.185, 0.522), 0.07, 16, 10, scale=(1.1, 0.35, 0.25))
    C.set_material(mouth, mats['mouth'])
    parts.append(mouth)
    return parts


def build_loincloth(mats):
    parts = []
    # waist band
    bpy.ops.mesh.primitive_torus_add(major_radius=0.14, minor_radius=0.02, major_segments=40, minor_segments=8,
                                     location=(0, -0.005, 0.2))
    belt = bpy.context.active_object
    belt.name = 'belt'
    belt.scale = (1.0, 0.92, 1.0)
    C.apply_transform(belt)
    C.shade_smooth(belt)
    C.set_material(belt, mats['belt'])
    parts.append(belt)
    # front and back flaps (slightly curved, ragged bottom edge)
    for name, y, tilt in (('flap_front', -0.13, 8), ('flap_back', 0.125, -8)):
        bm = bmesh.new()
        w, h = 0.13, 0.11
        cols, rows = 6, 4
        verts = []
        for r in range(rows + 1):
            row = []
            for c in range(cols + 1):
                u = c / cols - 0.5
                v = r / rows
                rag = 0.012 * math.sin(c * 2.7) if r == rows else 0
                x = u * w * (1 + 0.25 * v)
                z = -v * h - rag
                yy = 0.02 * (u * 2) ** 2 * (1 if y < 0 else -1)
                row.append(bm.verts.new((x, yy, z)))
            verts.append(row)
        for r in range(rows):
            for c in range(cols):
                bm.faces.new((verts[r][c], verts[r][c + 1], verts[r + 1][c + 1], verts[r + 1][c]))
        o = C.mesh_from_bmesh(name, bm)
        o.location = (0, y, 0.2)
        o.rotation_euler = Euler((math.radians(tilt), 0, 0))
        mod = o.modifiers.new('solid', 'SOLIDIFY')
        mod.thickness = 0.012
        sub = o.modifiers.new('sub', 'SUBSURF')
        sub.levels = 1
        C.apply_modifiers(o)
        C.apply_transform(o)
        C.shade_smooth(o)
        C.set_material(o, mats['cloth'])
        parts.append(o)
    return parts


def build_nails(mats):
    parts = []
    return parts


def materials():
    return {
        'skin': C.clay_material('Skin', SKIN, roughness=0.78, bump=0.3),
        'eye': C.clay_material('Eye', EYE_WHITE, roughness=0.25, bump=0),
        'pupil': C.clay_material('Pupil', PUPIL, roughness=0.2, bump=0),
        'tooth': C.clay_material('Tooth', TOOTH, roughness=0.4, bump=0),
        'mouth': C.clay_material('Mouth', MOUTH, roughness=0.9, bump=0),
        'cloth': C.clay_material('Cloth', CLOTH, roughness=0.95, bump=0.5),
        'belt': C.clay_material('Belt', BELT, roughness=0.85, bump=0.2),
    }


def build():
    C.reset_scene()
    mats = materials()
    body = build_body()
    C.set_material(body, mats['skin'])
    parts = build_eyes(mats) + build_teeth(mats) + build_loincloth(mats)
    return body, parts, mats


# --- rig ---------------------------------------------------------------------------------

BONES = [
    # name, head, tail, parent, deform
    ('root', (0, 0, 0), (0, 0, 0.08), None, False),
    ('pelvis', (0, 0, 0.16), (0, 0, 0.25), 'root', True),
    ('spine', (0, 0, 0.25), (0, 0, 0.40), 'pelvis', True),
    ('neck', (0, 0, 0.40), (0, 0, 0.48), 'spine', True),
    ('head', (0, 0, 0.48), (0, 0, 0.84), 'neck', True),
]
for side, sx in (('L', 1), ('R', -1)):
    BONES += [
        (f'ear.{side}', (sx * 0.17, 0.02, 0.645), (sx * 0.33, 0.055, 0.68), 'head', True),
        (f'ear_tip.{side}', (sx * 0.33, 0.055, 0.68), (sx * 0.5, 0.09, 0.765), f'ear.{side}', True),
        (f'upper_arm.{side}', (sx * 0.155, 0.01, 0.395), (sx * 0.25, -0.005, 0.27), 'spine', True),
        (f'forearm.{side}', (sx * 0.25, -0.005, 0.27), (sx * 0.28, -0.04, 0.155), f'upper_arm.{side}', True),
        (f'hand.{side}', (sx * 0.28, -0.04, 0.155), (sx * 0.285, -0.065, 0.075), f'forearm.{side}', True),
        (f'thigh.{side}', (sx * 0.08, 0.0, 0.15), (sx * 0.095, -0.01, 0.09), 'pelvis', True),
        (f'shin.{side}', (sx * 0.095, -0.01, 0.09), (sx * 0.1, 0.0, 0.045), f'thigh.{side}', True),
        (f'foot.{side}', (sx * 0.1, 0.0, 0.045), (sx * 0.105, -0.12, 0.02), f'shin.{side}', True),
    ]
# Where tools are held: in the right hand, pointing forward.
BONES.append(('socket_tool', (-0.285, -0.065, 0.075), (-0.285, -0.14, 0.075), 'hand.R', False))


def build_armature():
    arm = bpy.data.armatures.new('grunt_rig')
    obj = bpy.data.objects.new('grunt_rig', arm)
    bpy.context.collection.objects.link(obj)
    C.select_only(obj)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, head, tail, parent, deform in BONES:
        b = arm.edit_bones.new(name)
        b.head = head
        b.tail = tail
        b.roll = 0
        b.use_deform = deform
        if parent:
            b.parent = arm.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def bind(body, parts, rig):
    # Skin the body with automatic (heat) weights.
    C.select_only(body, rig, active=rig)
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    # Rigid parts follow a single bone.
    for part in parts:
        n = part.name
        bone = 'head' if n.startswith(('eye', 'pupil', 'lid', 'tooth', 'fang', 'mouth')) else 'pelvis'
        vg = part.vertex_groups.new(name=bone)
        vg.add([v.index for v in part.data.vertices], 1.0, 'REPLACE')
    C.select_only(body, *parts, active=body)
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = 'grunt'
    body.data.name = 'grunt'
    return body


# --- animation -----------------------------------------------------------------------------

class Poser:
    """Author poses with rotations about *global* axes (degrees) and global offsets."""

    def __init__(self, rig):
        self.rig = rig
        for pb in rig.pose.bones:
            pb.rotation_mode = 'QUATERNION'

    def _rest(self, bone):
        return self.rig.data.bones[bone].matrix_local.to_3x3()

    def pose(self, frame, rots=None, locs=None):
        rots = rots or {}
        locs = locs or {}
        for pb in self.rig.pose.bones:
            name = pb.name
            B = self._rest(name)
            rx, ry, rz = rots.get(name, (0, 0, 0))
            g = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_matrix()
            local = B.inverted() @ g @ B
            pb.rotation_quaternion = local.to_quaternion()
            pb.keyframe_insert('rotation_quaternion', frame=frame)
            off = Vector(locs.get(name, (0, 0, 0)))
            pb.location = B.inverted() @ off
            pb.keyframe_insert('location', frame=frame)


def sym(rots, name, rx=0, ry=0, rz=0, mirror_y=True):
    """Set the same (mirrored) rotation on the .L and .R bones."""
    rots[f'{name}.L'] = (rx, ry, rz)
    rots[f'{name}.R'] = (rx, -ry if mirror_y else ry, -rz)


def make_action(rig, name, frames, pose_fn, step=2, loop=True):
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = action
    poser = Poser(rig)
    last = frames if loop else frames
    f = 0
    while f <= last:
        t = f / frames
        rots, locs = pose_fn(t)
        poser.pose(f + 1, rots, locs)
        f += step
    if (last % step) != 0:
        rots, locs = pose_fn(1.0)
        poser.pose(last + 1, rots, locs)
    for fc in action.fcurves if hasattr(action, 'fcurves') else []:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
    return action


TAU = math.pi * 2


def ears(t, amp=6, speed=1):
    r = {}
    flap = math.sin(t * TAU * speed) * amp
    r['ear.L'] = (0, flap, 4)
    r['ear.R'] = (0, -flap, -4)
    r['ear_tip.L'] = (0, flap * 1.4, 6)
    r['ear_tip.R'] = (0, -flap * 1.4, -6)
    return r


def a_idle(t):
    """Breathing, a slow weight shift from foot to foot, a look around and an ear twitch."""
    p = t * TAU
    breath = math.sin(p * 2)
    shift = math.sin(p)
    r = ears(t, 3, 2)
    # ear twitches: a quick flick of one ear, later the other
    for side, at, sign in (('L', 0.32, 1), ('R', 0.78, -1)):
        k = max(0.0, 1 - abs(t - at) / 0.05)
        r[f'ear.{side}'] = (0, sign * (3 * math.sin(p * 2) + 22 * k), sign * 4)
        r[f'ear_tip.{side}'] = (0, sign * (4 * math.sin(p * 2 - 0.6) + 30 * k), sign * 6)
    r['spine'] = (4 + 2 * breath, 0, 0)
    look = math.sin(p) * 0.6 + math.sin(p * 2 + 1.1) * 0.4
    r['head'] = (-2 * breath - 3, 0, 14 * look)
    r['neck'] = (0, 0, 6 * look)
    sym(r, 'upper_arm', rx=2 * breath, ry=8, rz=0)
    sym(r, 'forearm', rx=-12 - 3 * breath, ry=0)
    # weight shift: the pelvis slides over one foot, the knees follow
    r['thigh.L'] = (-4 * shift, 0, 0)
    r['thigh.R'] = (4 * shift, 0, 0)
    r['shin.L'] = (6 + 4 * max(0.0, -shift), 0, 0)
    r['shin.R'] = (6 + 4 * max(0.0, shift), 0, 0)
    return r, {'pelvis': (0.012 * shift, 0, -0.006 + 0.003 * breath)}


def walk_cycle(t, lean=12, stride=30, knee=58, arm=28, forearm=-24, bounce=0.022, sway=0.014, yaw=9, run=False):
    """One cycle = two steps (left foot plants at t = 0, right at t = 0.5)."""
    p = t * TAU
    r = {}
    for side, ph, sx in (('L', 0.0, 1), ('R', math.pi, -1)):
        q = p + ph
        swing = max(0.0, -math.sin(q))  # 0..1 while this foot travels forward
        load = max(0.0, math.sin(q)) * (1 - math.sin(q))  # soft knee just after the plant
        r[f'thigh.{side}'] = (-stride * math.cos(q) - (8 if run else 4) * swing, 0, 0)
        r[f'shin.{side}'] = (knee * swing ** 1.2 + 10 * load + (8 if run else 4), 0, 0)
        # heel strike (toes up) -> flat -> toe off (toes down)
        heel = max(0.0, math.cos(q)) * (1 - swing)
        toe = max(0.0, -math.cos(q)) * max(0.0, math.sin(q + 0.6))
        r[f'foot.{side}'] = (-14 * heel + 30 * toe - 10 * swing, 0, 0)
        # arms swing against the legs and trail a little behind
        r[f'upper_arm.{side}'] = (arm * math.cos(q - 0.35), sx * 10, sx * -6)
        r[f'forearm.{side}'] = (forearm - 12 * max(0.0, math.cos(q - 0.9)), 0, 0)
    step = math.cos(2 * p)  # +1 at each foot plant
    r['pelvis'] = (0, 3 * math.sin(p), -yaw * math.cos(p))
    r['spine'] = (lean + 2 * step, -2 * math.sin(p), yaw * 1.3 * math.cos(p))
    r['neck'] = (0, 0, -yaw * 0.5 * math.cos(p))
    r['head'] = (-lean * 0.6 - 3 * step, 0, -yaw * 0.5 * math.cos(p))
    # ears flop with every step, lagging behind the bounce
    flop = math.sin(2 * p - 1.2)
    flop2 = math.sin(2 * p - 2.0)
    amp = 16 if run else 10
    r['ear.L'] = (0, amp * flop, 4)
    r['ear.R'] = (0, -amp * flop, -4)
    r['ear_tip.L'] = (0, amp * 1.5 * flop2, 6)
    r['ear_tip.R'] = (0, -amp * 1.5 * flop2, -6)
    up = bounce * (1 - abs(math.cos(p))) if not run else bounce * max(0.0, math.sin(2 * p - 0.4))
    return r, {'pelvis': (sway * math.sin(p), 0, up - (0.012 if run else 0.004))}


def a_walk(t):
    return walk_cycle(t)


def a_run(t):
    return walk_cycle(t, lean=26, stride=46, knee=95, arm=48, forearm=-75, bounce=0.05, sway=0.008, yaw=12, run=True)


def a_fidget(t):
    """Scratches his head with the right hand, then shakes it off."""
    reach = min(1.0, t / 0.2) if t < 0.75 else max(0.0, 1 - (t - 0.75) / 0.2)
    reach = reach * reach * (3 - 2 * reach)
    scratch = math.sin(t * TAU * 7) * (1 if 0.2 < t < 0.75 else 0)
    r = ears(t, 4, 2)
    r['upper_arm.R'] = (-150 * reach, 0, -35 * reach + 6 * scratch)
    r['forearm.R'] = (-80 * reach + 12 * scratch, 0, 0)
    sym(r, 'upper_arm', rx=4, ry=8)
    r['upper_arm.R'] = (-150 * reach, 0, -35 * reach + 6 * scratch)
    r['forearm.L'] = (-12, 0, 0)
    r['head'] = (6 * reach, 0, -18 * reach + 4 * scratch)
    r['spine'] = (4, 0, -6 * reach)
    r['ear.R'] = (0, -10 * reach - 6 * scratch, -4)
    r['ear_tip.R'] = (0, -14 * reach - 10 * scratch, -6)
    return r, {'pelvis': (0, 0, -0.004)}


def a_attack(t):
    # wind up (0-0.4), strike (0.4-0.6), recover
    if t < 0.4:
        k = t / 0.4
        wind = k
        strike = 0
    elif t < 0.6:
        wind = 1 - (t - 0.4) / 0.2
        strike = (t - 0.4) / 0.2
    else:
        wind = 0
        strike = 1 - (t - 0.6) / 0.4
    r = ears(t, 10, 2)
    r['spine'] = (-8 * wind + 18 * strike, 25 * wind - 20 * strike, 0)
    r['upper_arm.R'] = (-110 * wind + 70 * strike, 0, -20 * wind)
    r['forearm.R'] = (-40 * wind + 10 * strike, 0, 0)
    r['upper_arm.L'] = (20 * wind - 10 * strike, 10, 0)
    r['head'] = (-6 * wind + 8 * strike, 0, 0)
    sym(r, 'thigh', rx=8 * strike)
    return r, {'pelvis': (0, -0.03 * strike, -0.01 * strike)}


def a_attack2(t):
    # overhead two-handed smash
    up = math.sin(min(1, t / 0.45) * math.pi / 2) if t < 0.45 else 1 - (t - 0.45) / 0.15 if t < 0.6 else 0
    down = 0 if t < 0.45 else min(1, (t - 0.45) / 0.15) if t < 0.6 else 1 - (t - 0.6) / 0.4
    r = ears(t, 12, 2)
    r['spine'] = (-14 * up + 28 * down, 0, 0)
    sym(r, 'upper_arm', rx=-150 * up + 60 * down, ry=0)
    sym(r, 'forearm', rx=-20 * up)
    r['head'] = (-10 * up + 10 * down, 0, 0)
    return r, {'pelvis': (0, 0, -0.02 * down)}


def a_throw(t):
    back = math.sin(min(1, t / 0.5) * math.pi / 2) if t < 0.5 else 0
    fwd = 0 if t < 0.5 else math.sin(min(1, (t - 0.5) / 0.2) * math.pi / 2) * (1 - max(0, (t - 0.7) / 0.3))
    r = ears(t, 8, 2)
    r['spine'] = (-6 * back + 14 * fwd, 30 * back - 25 * fwd, 0)
    r['upper_arm.R'] = (-150 * back + 60 * fwd, 0, -30 * back)
    r['forearm.R'] = (-60 * back, 0, 0)
    r['upper_arm.L'] = (30 * back - 20 * fwd, 10, 20 * back)
    return r, {}


def a_dig(t):
    k = math.sin(t * TAU * 2)
    r = ears(t, 6, 2)
    r['spine'] = (32 + 8 * k, 0, 0)
    r['head'] = (-10, 0, 0)
    sym(r, 'upper_arm', rx=40 + 30 * k, ry=6)
    sym(r, 'forearm', rx=-30 + 10 * k)
    sym(r, 'thigh', rx=-18)
    sym(r, 'shin', rx=-24)
    return r, {'pelvis': (0, 0, -0.03)}


def a_smash(t):
    up = math.sin(min(1, t / 0.55) * math.pi / 2) if t < 0.55 else 0
    hit = 0 if t < 0.55 else (1 - max(0, (t - 0.7) / 0.3))
    r = ears(t, 10, 2)
    r['spine'] = (-10 * up + 30 * hit, 0, 0)
    r['upper_arm.R'] = (-160 * up + 70 * hit, 0, 0)
    r['forearm.R'] = (-30 * up, 0, 0)
    r['head'] = (-8 * up + 12 * hit, 0, 0)
    return r, {'pelvis': (0, 0, -0.02 * hit)}


def a_suck(t):
    k = math.sin(t * TAU * 3)
    r = ears(t, 4, 3)
    r['spine'] = (38, 0, 0)
    r['head'] = (10 + 4 * k, 0, 0)
    sym(r, 'upper_arm', rx=20, ry=10)
    sym(r, 'thigh', rx=-10)
    return r, {'pelvis': (0, 0, -0.01 + 0.004 * k)}


def a_spy(t):
    look = math.sin(t * TAU)
    r = ears(t, 12, 2)
    r['head'] = (6, 0, 50 * look)
    r['spine'] = (6, 0, 15 * look)
    sym(r, 'upper_arm', rx=-60, ry=10)
    sym(r, 'forearm', rx=-80)
    return r, {}


def a_cast(t):
    k = math.sin(min(1, t / 0.4) * math.pi / 2) if t < 0.8 else 1 - (t - 0.8) / 0.2
    r = ears(t, 14, 3)
    r['spine'] = (-18 * k, 0, 0)
    r['head'] = (-20 * k, 0, 0)
    sym(r, 'upper_arm', rx=-160 * k, ry=0, rz=20 * k)
    return r, {'pelvis': (0, 0, 0.03 * k)}


def a_struck(t):
    k = math.sin(t * math.pi)
    r = ears(t, 20, 3)
    r['spine'] = (-24 * k, 0, 8 * k)
    r['head'] = (-18 * k, 0, -12 * k)
    sym(r, 'upper_arm', rx=-40 * k, rz=30 * k)
    return r, {'pelvis': (0, 0.04 * k, 0)}


def a_combat(t):
    b = math.sin(t * TAU)
    r = ears(t, 4, 1)
    r['spine'] = (14, 0, 0)
    r['head'] = (-10, 0, 0)
    r['upper_arm.R'] = (-30 + 4 * b, 0, -10)
    r['forearm.R'] = (-60, 0, 0)
    r['upper_arm.L'] = (-20, 10, 10)
    r['forearm.L'] = (-60, 0, 0)
    sym(r, 'thigh', rx=-14)
    sym(r, 'shin', rx=-20)
    return r, {'pelvis': (0, 0, -0.018 + 0.005 * b)}


def a_swim(t):
    s = math.sin(t * TAU)
    r = ears(t, 6, 1)
    r['spine'] = (8, 0, 0)
    r['upper_arm.L'] = (-60 + 50 * s, 0, 30)
    r['upper_arm.R'] = (-60 - 50 * s, 0, -30)
    r['thigh.L'] = (30 * s, 0, 0)
    r['thigh.R'] = (-30 * s, 0, 0)
    return r, {'pelvis': (0, 0, 0.01 * s)}


def a_fly(t):
    s = math.sin(t * TAU)
    r = ears(t, 20, 2)
    r['spine'] = (20, 0, 0)
    sym(r, 'upper_arm', rx=-20, ry=0, rz=60 + 30 * s)
    sym(r, 'thigh', rx=20)
    sym(r, 'shin', rx=-30)
    return r, {'pelvis': (0, 0, 0.02 * s)}


def a_play(t):
    hop = abs(math.sin(t * TAU))
    r = ears(t, 16, 2)
    r['spine'] = (-6, 0, 10 * math.sin(t * TAU))
    r['head'] = (-12, 0, 8 * math.sin(t * TAU))
    sym(r, 'upper_arm', rx=-100 - 20 * hop, rz=20)
    sym(r, 'thigh', rx=-20 * hop)
    return r, {'pelvis': (0, 0, 0.06 * hop)}


def a_pickup(t):
    k = math.sin(min(1, t / 0.5) * math.pi / 2)
    r = ears(t, 12, 2)
    r['spine'] = (-8 * k, 0, 0)
    r['head'] = (-18 * k, 0, 0)
    sym(r, 'upper_arm', rx=-165 * k, ry=0, rz=10 * k)
    sym(r, 'forearm', rx=-20 * k)
    return r, {'pelvis': (0, 0, 0.02 * k)}


def a_victory(t):
    hop = abs(math.sin(t * TAU))
    wave = math.sin(t * TAU * 2)
    r = ears(t, 20, 2)
    r['spine'] = (-10, 0, 0)
    r['head'] = (-20, 0, 10 * wave)
    sym(r, 'upper_arm', rx=-160, ry=0, rz=25 + 15 * wave)
    sym(r, 'thigh', rx=-25 * hop)
    sym(r, 'shin', rx=-40 * hop)
    return r, {'pelvis': (0, 0, 0.1 * hop)}


def a_die(t):
    k = min(1, t / 0.7)
    e = k * k * (3 - 2 * k)
    r = ears(t, 10 * (1 - e), 3)
    r['spine'] = (50 * e, 0, 10 * e)
    r['head'] = (30 * e, 0, 20 * e)
    sym(r, 'upper_arm', rx=30 * e, rz=40 * e)
    sym(r, 'thigh', rx=-70 * e)
    sym(r, 'shin', rx=-90 * e)
    r['ear.L'] = (0, -40 * e, 0)
    r['ear.R'] = (0, 40 * e, 0)
    return r, {'pelvis': (0, 0, -0.12 * e)}


ACTIONS = [
    ('idle', 90, a_idle, True),
    ('fidget', 48, a_fidget, False),
    ('walk', 18, a_walk, True),
    ('run', 10, a_run, True),
    ('attack', 18, a_attack, False),
    ('attack2', 20, a_attack2, False),
    ('throw', 18, a_throw, False),
    ('dig', 30, a_dig, True),
    ('smash', 24, a_smash, False),
    ('suck', 30, a_suck, True),
    ('spy', 40, a_spy, True),
    ('cast', 30, a_cast, False),
    ('struck', 12, a_struck, False),
    ('combat', 40, a_combat, True),
    ('swim', 30, a_swim, True),
    ('fly', 12, a_fly, True),
    ('play', 24, a_play, True),
    ('pickup', 30, a_pickup, False),
    ('victory', 30, a_victory, True),
    ('die', 30, a_die, False),
]


def build_animations(rig):
    for name, frames, fn, loop in ACTIONS:
        make_action(rig, name, frames, fn, step=1 if frames <= 12 else 2, loop=loop)
    rig.animation_data.action = bpy.data.actions['idle']


def bake_skin(body, mats):
    """Bake AO for the skin (darkens crevices; the albedo stays neutral for team tinting)."""
    C.smart_uv(body, margin=0.01)
    skin = mats['skin']
    # Only the skin material gets the AO texture; other materials keep flat colours.
    C.bake_ao_into_base(body, skin, size=1024, samples=32, strength=0.85, base=SKIN)


if __name__ == '__main__':
    body, parts, mats = build()
    print('GRUNT_TRIS', C.tri_count(body), sum(C.tri_count(p) for p in parts))
    rig = build_armature()
    grunt = bind(body, parts, rig)
    build_animations(rig)
    if not C.arg('nobake'):
        bake_skin(grunt, mats)
    if C.arg('export', True) and not C.arg('anim'):
        path = C.export_glb('grunt', objects=[grunt, rig], animations=True)
        print('EXPORTED', path)
    if C.arg('anim'):
        # render a few frames of one action to check the motion
        name = C.arg('anim')
        rig.animation_data.action = bpy.data.actions[name]
        cam, target, dist, h = C.setup_preview(target=(0, 0, 0.42), distance=2.3, height=0.9)
        frames = [int(f) for f in (C.arg('frames') or '1,5,9,13').split(',')]
        for f in frames:
            bpy.context.scene.frame_set(f)
            C.render_views(f'anim_{name}_{f:02d}', cam, target, dist, h, angles=(int(C.arg('angle') or 35),))
    if C.arg('preview'):
        # tint the skin like a player grunt for the preview
        mats['skin'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*C.hex_color(0xe8823a), 1)
        cam, target, dist, h = C.setup_preview(target=(0, 0, 0.42), distance=2.3, height=0.9)
        C.render_views('grunt', cam, target, dist, h, angles=(0, 35, 90, 180))
        C.render_views('grunt_face', cam, Vector((0, -0.05, 0.62)), 1.05, 0.12, angles=(20,))
