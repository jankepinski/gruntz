import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { applyClay } from './materials.ts';

/**
 * Models made in Blender (assets/blender). Loaded once, cloned per entity. Everything
 * falls back to the procedural placeholders if a model is missing.
 */
class ModelLibrary {
  private loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  private cache = new Map<string, Promise<GLTF | null>>();
  private loaded = new Map<string, GLTF>();

  load(name: string): Promise<GLTF | null> {
    let p = this.cache.get(name);
    if (!p) {
      p = this.loader
        .loadAsync(`/models/${name}.glb`)
        .then(gltf => {
          gltf.scene.traverse(o => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.castShadow = true;
              mesh.receiveShadow = true;
              const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
              for (const m of mats) applyClay(m as THREE.MeshStandardMaterial);
            }
          });
          this.loaded.set(name, gltf);
          return gltf;
        })
        .catch(() => null);
      this.cache.set(name, p);
    }
    return p;
  }

  get(name: string): GLTF | undefined {
    return this.loaded.get(name);
  }

  preload(names: string[]): Promise<unknown> {
    return Promise.all(names.map(n => this.load(n)));
  }
}

export const models = new ModelLibrary();

// --- the grunt -------------------------------------------------------------------------

export interface GruntModel {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  clips: Map<string, THREE.AnimationClip>;
  skin: THREE.MeshStandardMaterial;
  bones: Map<string, THREE.Object3D>;
  socket: THREE.Object3D;
}

const skinCache = new Map<number, THREE.MeshStandardMaterial>();

/** Team-coloured copy of the skin material (shared between gruntz of the same colour). */
function skinFor(base: THREE.MeshStandardMaterial, color: number): THREE.MeshStandardMaterial {
  let m = skinCache.get(color);
  if (!m) {
    m = base.clone();
    // The baked texture is a light neutral clay with AO; brighten slightly so the
    // multiplied team colour stays vivid.
    m.color.setHex(color).multiplyScalar(1.5);
    applyClay(m);
    skinCache.set(color, m);
  }
  return m;
}

export function createGrunt(color: number): GruntModel | null {
  const gltf = models.get('grunt');
  if (!gltf) return null;
  const root = SkeletonUtils.clone(gltf.scene);
  const bones = new Map<string, THREE.Object3D>();
  let skin: THREE.MeshStandardMaterial | null = null;
  root.traverse(o => {
    if ((o as THREE.Bone).isBone) bones.set(o.name.replace(/[.]/g, ''), o);
    const mesh = o as THREE.SkinnedMesh;
    if (mesh.isMesh) {
      mesh.frustumCulled = false;
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map(m => {
          if (m.name === 'Skin') {
            skin = skinFor(m as THREE.MeshStandardMaterial, color);
            return skin;
          }
          return m;
        });
      } else if (mesh.material.name === 'Skin') {
        skin = skinFor(mesh.material as THREE.MeshStandardMaterial, color);
        mesh.material = skin;
      }
    }
  });
  const clips = new Map(gltf.animations.map(c => [c.name, c]));
  const socket = bones.get('socket_tool') ?? bones.get('handR') ?? root;
  return {
    root,
    mixer: new THREE.AnimationMixer(root),
    clips,
    skin: skin ?? new THREE.MeshStandardMaterial({ color }),
    bones,
    socket,
  };
}

/** Plays clips with short cross-fades; one-shot clips are stretched to a duration. */
export class ClipPlayer {
  private current: THREE.AnimationAction | null = null;
  private currentKey = '';

  constructor(private model: GruntModel) {}

  play(
    name: string,
    opts: {
      loop?: boolean;
      duration?: number;
      speed?: number;
      key?: string;
      fade?: number;
      randomStart?: boolean;
    } = {},
  ): void {
    const key = opts.key ?? name;
    if (key === this.currentKey) {
      if (this.current && opts.speed !== undefined && opts.loop !== false) this.current.timeScale = opts.speed;
      return;
    }
    const clip = this.model.clips.get(name) ?? this.model.clips.get('idle');
    if (!clip) return;
    const action = this.model.mixer.clipAction(clip);
    action.reset();
    action.enabled = true;
    const loop = opts.loop ?? true;
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.timeScale = opts.duration ? clip.duration / Math.max(0.05, opts.duration) : (opts.speed ?? 1);
    const fade = opts.fade ?? 0.12;
    if (this.current && this.current !== action) {
      action.crossFadeFrom(this.current, fade, false);
    }
    action.play();
    // Looping idles start at a random point so a crowd doesn't move in lockstep.
    if (opts.randomStart && loop) action.time = Math.random() * clip.duration;
    this.current = action;
    this.currentKey = key;
  }

  update(dt: number): void {
    this.model.mixer.update(dt);
  }

  freeze(frozen: boolean): void {
    if (this.current) this.current.paused = frozen;
  }
}

/** Clone a prop from props.glb; materials named TeamColor get the given tint. */
const rockMaterials = new Map<string, THREE.MeshStandardMaterial>();
function rockMaterial(base: THREE.MeshStandardMaterial, color: number): THREE.MeshStandardMaterial {
  const key = `${base.uuid}:${color}`;
  let m = rockMaterials.get(key);
  if (!m) {
    m = base.clone();
    // Base colour is white (dark variant slightly grey); baked AO + strata live in vertex colours.
    m.color.multiply(new THREE.Color(color)).multiplyScalar(1.25);
    applyClay(m);
    rockMaterials.set(key, m);
  }
  return m;
}

/** A prop from props.glb; TeamColor* materials take the team colour, ThemeRock* the world's rock colour. */
export function createProp(name: string, teamColor?: number, rockColor?: number): THREE.Object3D | null {
  const gltf = models.get('props');
  const node = gltf?.scene.getObjectByName(name);
  if (!node) return null;
  const clone = node.clone(true);
  clone.position.set(0, 0, 0);
  clone.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const tint = (mat: THREE.Material) => {
      if (teamColor !== undefined && mat.name.startsWith('TeamColor')) {
        const m2 = (mat as THREE.MeshStandardMaterial).clone();
        m2.color.setHex(teamColor);
        return m2;
      }
      if (rockColor !== undefined && mat.name.startsWith('ThemeRock')) {
        return rockMaterial(mat as THREE.MeshStandardMaterial, rockColor);
      }
      return mat;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
  });
  return clone;
}

/**
 * A model from hazards.glb. Animated parts (bird wings, trapdoor doors, propellers) are
 * separate objects whose origin sits on their joint; they are returned with their
 * original offsets so they can be rotated in place.
 */
export function createHazard(
  name: string,
  parts: string[] = [],
): { root: THREE.Group; parts: Map<string, THREE.Object3D> } | null {
  const gltf = models.get('hazards');
  const node = gltf?.scene.getObjectByName(name);
  if (!node) return null;
  const root = new THREE.Group();
  const body = node.clone(true);
  body.position.set(0, 0, 0);
  root.add(body);
  const out = new Map<string, THREE.Object3D>();
  for (const p of parts) {
    const part = gltf!.scene.getObjectByName(p);
    if (!part) continue;
    const clone = part.clone(true);
    // Keep the joint offset relative to the body's own origin.
    clone.position.sub(node.position);
    root.add(clone);
    out.set(p, clone);
  }
  root.traverse(o => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { root, parts: out };
}
