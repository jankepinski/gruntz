import * as THREE from 'three';
import { clayMaterial } from './materials.ts';
import { models } from './models.ts';

/** Item modelled in Blender (items.glb), cloned; undefined if not available. */
function itemModel(item: string): THREE.Object3D | undefined {
  const gltf = models.get('items');
  const node = gltf?.scene.getObjectByName(item);
  if (!node) return undefined;
  const clone = node.clone(true);
  clone.position.set(0, 0, 0);
  clone.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = false;
    }
  });
  return clone;
}

/*
 * Procedural stand-ins for the Blender models. They keep the proportions and pivots the
 * real models use (grunt ~0.8 tiles tall, faces +z, tool held in the right hand), so the
 * GLB models can replace them one by one.
 */

const materialCache = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: number, rough = 0.85, metal = 0): THREE.MeshStandardMaterial {
  const key = `${color}-${rough}-${metal}`;
  let m = materialCache.get(key);
  if (!m) {
    m = clayMaterial(color, { rough, metal });
    materialCache.set(key, m);
  }
  return m;
}

function mesh(geo: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export interface GruntRig {
  root: THREE.Group;
  body: THREE.Group;
  torso: THREE.Mesh;
  head: THREE.Group;
  earL: THREE.Mesh;
  earR: THREE.Mesh;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  hand: THREE.Group;
  skin: THREE.MeshStandardMaterial;
}

/** A chunky little clay grunt. `color` is the skin colour (team / AI type). */
export function buildGrunt(color: number): GruntRig {
  const skin = clayMaterial(color, { rough: 0.8 });
  const dark = mat(0x3a2418);
  const white = mat(0xfaf6ec, 0.6);
  const black = mat(0x141010, 0.4);
  const cloth = mat(0x6b4a2a, 0.95);

  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torsoGeo = new THREE.SphereGeometry(0.2, 20, 14);
  torsoGeo.scale(1, 1.1, 0.9);
  const torso = mesh(torsoGeo, skin, 0, 0.3, 0);
  body.add(torso);
  const belly = mesh(new THREE.SphereGeometry(0.14, 16, 10), skin, 0, 0.27, 0.07);
  belly.scale.set(1, 1, 0.7);
  body.add(belly);
  const loin = mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.09, 16), cloth, 0, 0.19, 0);
  body.add(loin);

  const head = new THREE.Group();
  head.position.set(0, 0.6, 0.02);
  body.add(head);
  const skullGeo = new THREE.SphereGeometry(0.21, 22, 16);
  skullGeo.scale(1.1, 0.95, 1);
  head.add(mesh(skullGeo, skin));
  const brow = mesh(new THREE.CapsuleGeometry(0.035, 0.22, 4, 8), skin, 0, 0.06, 0.16);
  brow.rotation.z = Math.PI / 2;
  head.add(brow);
  for (const side of [-1, 1]) {
    const eye = mesh(new THREE.SphereGeometry(0.055, 14, 10), white, side * 0.075, 0.02, 0.17);
    head.add(eye);
    const pupil = mesh(new THREE.SphereGeometry(0.026, 10, 8), black, side * 0.075, 0.015, 0.22);
    head.add(pupil);
  }
  const nose = mesh(new THREE.SphereGeometry(0.05, 12, 10), skin, 0, -0.04, 0.21);
  nose.scale.set(1, 0.8, 0.9);
  head.add(nose);
  const mouth = mesh(new THREE.CapsuleGeometry(0.018, 0.1, 4, 8), dark, 0, -0.11, 0.17);
  mouth.rotation.z = Math.PI / 2;
  head.add(mouth);
  for (const side of [-1, 1]) {
    const tooth = mesh(new THREE.ConeGeometry(0.018, 0.04, 6), white, side * 0.035, -0.09, 0.185);
    tooth.rotation.x = Math.PI;
    head.add(tooth);
  }
  const earGeo = new THREE.ConeGeometry(0.075, 0.3, 10);
  earGeo.translate(0, 0.15, 0);
  const earL = mesh(earGeo, skin, -0.2, 0.05, -0.02);
  earL.rotation.z = Math.PI / 2 - 0.35;
  const earR = mesh(earGeo, skin, 0.2, 0.05, -0.02);
  earR.rotation.z = -Math.PI / 2 + 0.35;
  head.add(earL, earR);

  const armGeo = new THREE.CapsuleGeometry(0.045, 0.16, 4, 8);
  armGeo.translate(0, -0.1, 0);
  const armL = new THREE.Group();
  armL.position.set(-0.2, 0.38, 0);
  armL.add(mesh(armGeo, skin));
  armL.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), skin, 0, -0.22, 0));
  const armR = new THREE.Group();
  armR.position.set(0.2, 0.38, 0);
  armR.add(mesh(armGeo, skin));
  armR.add(mesh(new THREE.SphereGeometry(0.055, 10, 8), skin, 0, -0.22, 0));
  const hand = new THREE.Group();
  hand.position.set(0, -0.22, 0.02);
  armR.add(hand);
  body.add(armL, armR);

  const legGeo = new THREE.CapsuleGeometry(0.055, 0.08, 4, 8);
  legGeo.translate(0, -0.06, 0);
  const legL = mesh(legGeo, skin, -0.09, 0.16, 0);
  const legR = mesh(legGeo, skin, 0.09, 0.16, 0);
  for (const leg of [legL, legR]) {
    const foot = mesh(new THREE.SphereGeometry(0.065, 10, 8), skin, 0, -0.13, 0.03);
    foot.scale.set(1, 0.6, 1.4);
    leg.add(foot);
  }
  body.add(legL, legR);

  return { root, body, torso, head, earL, earR, armL, armR, legL, legR, hand, skin };
}

// --- items -------------------------------------------------------------------------

type ItemBuilder = () => THREE.Object3D;

const metalMat = () => mat(0xb8c0cc, 0.35, 0.7);
const woodMat = () => mat(0x8f5f36);

const ITEMS: Record<string, ItemBuilder> = {
  GAUNTLETZ: () => {
    const g = new THREE.Group();
    const glove = mesh(new THREE.SphereGeometry(0.11, 12, 10), mat(0x9098a8, 0.4, 0.6));
    glove.scale.set(1, 0.8, 1.2);
    g.add(glove);
    for (let i = -1; i <= 1; i++) g.add(mesh(new THREE.SphereGeometry(0.035, 8, 6), mat(0x707888, 0.4, 0.6), i * 0.05, 0.05, 0.09));
    return g;
  },
  SHOVEL: () => {
    const g = new THREE.Group();
    const handle = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.45, 8), woodMat(), 0, 0.1, 0);
    const blade = mesh(new THREE.BoxGeometry(0.14, 0.16, 0.02), metalMat(), 0, -0.18, 0);
    g.add(handle, blade);
    return g;
  },
  CLUB: () => {
    const c = mesh(new THREE.CylinderGeometry(0.07, 0.03, 0.4, 10), mat(0x7a4a26), 0, 0.12, 0);
    return c;
  },
  SWORD: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.42, 0.015), metalMat(), 0, 0.28, 0));
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.03, 0.04), mat(0xd8b040, 0.4, 0.6), 0, 0.06, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), mat(0x5a3a20), 0, 0, 0));
    return g;
  },
  GLOVEZ: () => mesh(new THREE.SphereGeometry(0.1, 12, 10), mat(0xd83030, 0.5)),
  SPRING: () => {
    const coil = mesh(new THREE.TorusKnotGeometry(0.06, 0.012, 48, 6, 1, 6), metalMat());
    coil.scale.set(1, 2.2, 1);
    return coil;
  },
  TOOB: () => {
    const t = mesh(new THREE.TorusGeometry(0.2, 0.07, 10, 20), mat(0xf2cf2a, 0.5));
    t.rotation.x = Math.PI / 2;
    return t;
  },
  WINGZ: () => {
    const g = new THREE.Group();
    for (const side of [-1, 1]) {
      const wing = mesh(new THREE.ConeGeometry(0.1, 0.35, 4), mat(0xf4f4f8, 0.7), side * 0.15, 0.05, 0);
      wing.rotation.z = side * 1.2;
      g.add(wing);
    }
    return g;
  },
  GRAVITYBOOTZ: () => mesh(new THREE.BoxGeometry(0.14, 0.12, 0.2), mat(0x404a70, 0.4, 0.5)),
  BOOMERANG: () => {
    const b = mesh(new THREE.TorusGeometry(0.14, 0.025, 6, 12, Math.PI * 0.7), mat(0xc88a3a));
    b.rotation.x = Math.PI / 2;
    return b;
  },
  ROCK: () => mesh(new THREE.DodecahedronGeometry(0.09), mat(0x8a8078)),
  NERFGUN: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.08, 0.25), mat(0x3aa84a, 0.5), 0, 0, 0.05));
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.12, 0.05), mat(0xf2cf2a, 0.5), 0, -0.07, -0.02));
    return g;
  },
  GUNHAT: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.12, 14), mat(0x5a6a4a, 0.6, 0.3)));
    const barrel = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.25, 10), metalMat(), 0, 0.05, 0.12);
    barrel.rotation.x = Math.PI / 2;
    g.add(barrel);
    return g;
  },
  WELDER: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 10), mat(0xe86a2a, 0.5, 0.3)));
    g.add(mesh(new THREE.ConeGeometry(0.04, 0.12, 8), metalMat(), 0, 0.15, 0));
    return g;
  },
  SHIELD: () => {
    const s = mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 18), mat(0x9aa4b8, 0.4, 0.6));
    s.rotation.x = Math.PI / 2;
    return s;
  },
  BRICK: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.02, 0.16), metalMat(), 0, 0, 0.06));
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), woodMat(), 0, 0.06, 0));
    return g;
  },
  TIMEBOMB: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.SphereGeometry(0.11, 14, 10), mat(0x202028, 0.4, 0.2)));
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6), mat(0xc8a060), 0, 0.12, 0));
    return g;
  },
  BOMB: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.SphereGeometry(0.13, 14, 10), mat(0x202028, 0.4, 0.2)));
    g.add(mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 6), mat(0xc8a060), 0, 0.14, 0));
    return g;
  },
  GOOBER: () => {
    const s = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), mat(0xf25a9a, 0.4), 0, 0.12, 0);
    s.rotation.z = 0.3;
    return s;
  },
  SPY: () => {
    const g = new THREE.Group();
    for (const side of [-1, 1]) {
      const lens = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.1, 10), mat(0x202030, 0.3, 0.5), side * 0.05, 0, 0);
      lens.rotation.x = Math.PI / 2;
      g.add(lens);
    }
    return g;
  },
  WAND: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 8), mat(0x2a2a30), 0, 0.12, 0));
    g.add(mesh(new THREE.OctahedronGeometry(0.05), mat(0xff4a6a, 0.2), 0, 0.31, 0));
    return g;
  },
  WARPSTONE: () => mesh(new THREE.OctahedronGeometry(0.14), mat(0x6af0ff, 0.15, 0.2)),
  // toys
  BABYWALKER: () => mesh(new THREE.TorusGeometry(0.16, 0.04, 8, 16), mat(0x7ad0f0, 0.6)),
  BEACHBALL: () => mesh(new THREE.SphereGeometry(0.16, 16, 12), mat(0xf25a4a, 0.5)),
  BIGWHEEL: () => {
    const w = mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 18), mat(0xe03a2a, 0.5));
    w.rotation.y = Math.PI / 2;
    return w;
  },
  GOKART: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.08, 0.4), mat(0xe03a2a, 0.5)));
    for (const [x, z] of [[-0.16, -0.14], [0.16, -0.14], [-0.16, 0.14], [0.16, 0.14]]) {
      const wheel = mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 10), mat(0x202020), x!, -0.04, z!);
      wheel.rotation.z = Math.PI / 2;
      g.add(wheel);
    }
    return g;
  },
  JACKINTHEBOX: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat(0x3a7fe8, 0.5)));
    g.add(mesh(new THREE.SphereGeometry(0.06, 10, 8), mat(0xf2cf2a, 0.5), 0, 0.16, 0));
    return g;
  },
  JUMPROPE: () => mesh(new THREE.TorusGeometry(0.15, 0.01, 6, 24), mat(0xf25a9a, 0.6)),
  POGOSTICK: () => mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 8), mat(0x3ac04a, 0.5)),
  SCROLL: () => {
    const s = mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.22, 10), mat(0xf4e8c8, 0.8));
    s.rotation.z = Math.PI / 2;
    return s;
  },
  SQUEAKTOY: () => mesh(new THREE.SphereGeometry(0.09, 12, 10), mat(0xf2cf2a, 0.5)),
  YOYO: () => {
    const y = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.05, 14), mat(0x9b4de0, 0.5));
    y.rotation.x = Math.PI / 2;
    return y;
  },
  TOYBOX: () => {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.22, 0.3), mat(0xf2902a, 0.6), 0, 0.11, 0));
    g.add(mesh(new THREE.BoxGeometry(0.32, 0.05, 0.32), mat(0xe03a2a, 0.6), 0, 0.24, 0));
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.24, 0.32), mat(0xf2cf2a, 0.5), 0, 0.12, 0));
    return g;
  },
  // utilities & powerups
  MEGAPHONE: () => {
    const m = mesh(new THREE.ConeGeometry(0.1, 0.22, 12, 1, true), mat(0xe0e0e8, 0.4, 0.4));
    m.rotation.z = Math.PI / 2;
    return m;
  },
  HEALTH1: () => mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 12), mat(0xe03a3a, 0.35, 0.5)),
  HEALTH2: () => mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.24, 12), mat(0xe03a3a, 0.3, 0.3)),
  HEALTH3: () => mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.24, 14), mat(0x9a6a3a, 0.7)),
  STOPWATCH: () => mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.03, 18), mat(0xd8d8e0, 0.3, 0.6)),
  COIN: () => {
    const c = mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 18), mat(0xf2c83a, 0.3, 0.8));
    c.rotation.x = Math.PI / 2;
    return c;
  },
};

const POWERUP_COLORS: Record<string, number> = {
  GHOST: 0xc8c8d8,
  SUPERSPEED: 0x3ad8f2,
  INVULNERABILITY: 0xf2d83a,
  CONVERSION: 0xf29a3a,
  DEATHTOUCH: 0x2a2a2a,
  ROIDZ: 0x3af25a,
  REACTIVEARMOR: 0x9aa4b8,
};

const CURSE_COLOR = 0x6a2a8a;

export function buildItem(item: string): THREE.Object3D {
  const modelled = itemModel(item);
  if (modelled) return modelled;
  const builder = ITEMS[item];
  if (builder) return builder();
  if (item.startsWith('SECRET_')) {
    const letter = mesh(new THREE.BoxGeometry(0.14, 0.18, 0.04), mat(0xf2c83a, 0.3, 0.8));
    return letter;
  }
  const color = POWERUP_COLORS[item] ?? CURSE_COLOR;
  const orb = mesh(new THREE.IcosahedronGeometry(0.12, 1), mat(color, 0.3, 0.2));
  return orb;
}

export function isPowerupItem(item: string): boolean {
  return item in POWERUP_COLORS;
}

export const TEAM_COLORS = [0xe8823a, 0x3a86e8, 0xd84a9a, 0x5ab84a, 0x9a9a9a];

export const AI_COLORS: Record<string, number> = {
  Chaser: 0x8fe07a,
  PostGuard: 0x6a3a8a,
  SmartChaser: 0x2f7a3a,
  HitAndRun: 0xf0d040,
  Defender: 0x4a6ad0,
  ObjectGuard: 0x9a6a3a,
  ToolThief: 0x2c2c30,
  Toyer: 0xf4f4f0,
  Bomber: 0xe03a2a,
  TimeBomber: 0x8a1a1a,
  BrickLayer: 0xb09070,
  Digger: 0x7a5030,
  RockBreaker: 0x9898a8,
  GooSucker: 0x60c0a0,
};

export const BRICK_COLORS: Record<string, number> = {
  brown: 0x9a5a36,
  gold: 0xf2c040,
  red: 0xd83a2a,
  blue: 0x3a6ad8,
  black: 0x2a2a2e,
};
