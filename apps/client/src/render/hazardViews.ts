import * as THREE from 'three';
import {
  dropperPosition,
  msToTicks,
  STATIC_COOLDOWN_MS,
  pathPosition,
  slimePosition,
  spotPosition,
  staticHazardInfo,
  ufoBeams,
  type Entity,
  type EntityOf,
  type ThemeId,
  type World,
} from '@gruntz/core';
import { createHazard } from './models.ts';
import { mat } from './placeholders.ts';
import { LIQUID } from './tileKit.ts';
import { groundY } from './elevation.ts';
import { ventLavaMaterial } from './materials.ts';
import type { LightPool } from './lightPool.ts';

/**
 * Views of the world hazards (see core/sim/worldHazards). Each world dresses the same
 * rules differently: lava geysers, candles, trapdoors, electric outlets, firework mortars;
 * birds or toy planes that drop coconuts or candy bombs; storm clouds, UFOs, "star
 * search" spotlights and kitchen slime.
 */

export interface HazardFrame {
  world: World;
  tick: number;
  dt: number;
  time: number;
  /** Shared point lights (see LightPool): glowing hazardz ask for one every frame. */
  lights?: LightPool;
}

export interface HazardView {
  object: THREE.Object3D;
  update(e: Entity, ctx: HazardFrame): void;
  dispose?(): void;
}

const FLY_HEIGHT = 3.4;
const glow = (color: number, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    toneMapped: false,
  });

function at(x: number, y: number, h = 0): THREE.Vector3 {
  return new THREE.Vector3(x + 0.5, h, y + 0.5);
}

/** A soft dark disc under things that fly (in the original you saw their shadows). */
function groundShadow(radius: number, opacity = 0.28): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity, depthWrite: false }),
  );
  m.renderOrder = 2;
  return m;
}

// --- static hazards ----------------------------------------------------------------------------

type StaticStyle = 'geyser' | 'candle' | 'trapdoor' | 'outlet' | 'mortar';

function staticStyle(theme: ThemeId): StaticStyle {
  switch (theme) {
    case 'sweetz':
      return 'candle';
    case 'rollerz':
      return 'trapdoor';
    case 'shrunk':
      return 'outlet';
    case 'minis':
      return 'mortar';
    default:
      return 'geyser';
  }
}

/** Lava shared with the lava rivers: one palette, and the vent uses the river's shader. */
const LAVA = LIQUID.tropics!;
const LAVA_HOT = new THREE.Color(LAVA.hot);
const LAVA_WHITE = new THREE.Color(LAVA.hot).lerp(new THREE.Color(0xffd070), 0.55);
const LAVA_CRUST = new THREE.Color(LAVA.crust);

interface Blob {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  max: number;
  size: number;
  gravity: number;
  /** Embers float and never splat. */
  ember: boolean;
}

interface Splat {
  x: number;
  z: number;
  life: number;
  max: number;
  size: number;
}

/**
 * An erupting lava vent: a fountain of glowing blobs flying in arcs, stretching with their
 * speed and cooling from white-hot to dark crust, splashing into glowing splats where they
 * land, with smoke rolling up and embers drifting away. Before an eruption the vent
 * bubbles and glows brighter as a warning.
 */
class LavaFountain {
  readonly group = new THREE.Group();
  private blobs: Blob[] = [];
  private splats: Splat[] = [];
  private blobMesh: THREE.InstancedMesh;
  private splatMesh: THREE.InstancedMesh;
  private smoke: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; max: number; size: number }[] = [];
  private spawnAcc = 0;
  private smokeAcc = 0;
  private static MAX = 140;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private c = new THREE.Color();
  private up = new THREE.Vector3(0, 1, 0);

  constructor() {
    const blobMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.blobMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), blobMat, LavaFountain.MAX);
    this.blobMesh.count = 0;
    this.blobMesh.frustumCulled = false;
    this.blobMesh.setColorAt(0, new THREE.Color());
    const splatMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      toneMapped: false,
      transparent: true,
      depthWrite: false,
    });
    this.splatMesh = new THREE.InstancedMesh(new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2), splatMat, 48);
    this.splatMesh.count = 0;
    this.splatMesh.frustumCulled = false;
    this.splatMesh.setColorAt(0, new THREE.Color());
    this.splatMesh.renderOrder = 2;
    this.group.add(this.blobMesh, this.splatMesh);
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 2),
        new THREE.MeshStandardMaterial({
          color: 0x8a7e76,
          roughness: 1,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        }),
      );
      mesh.visible = false;
      this.group.add(mesh);
      this.smoke.push({ mesh, vel: new THREE.Vector3(), life: 0, max: 0, size: 0 });
    }
  }

  private spawn(speed: number, spread: number, size: number, ember = false): void {
    if (this.blobs.length >= LavaFountain.MAX) return;
    const a = Math.random() * Math.PI * 2;
    const h = Math.random() * spread;
    this.blobs.push({
      pos: new THREE.Vector3(Math.cos(a) * 0.06, 0.18, Math.sin(a) * 0.06),
      vel: new THREE.Vector3(Math.cos(a) * h, speed * (0.75 + Math.random() * 0.5), Math.sin(a) * h),
      life: 0,
      max: ember ? 1.2 + Math.random() : 3,
      size: size * (0.6 + Math.random() * 0.8),
      gravity: ember ? -0.6 : 9.8,
      ember,
    });
  }

  private puff(strength: number): void {
    const p = this.smoke.find(s => s.life >= s.max);
    if (!p) return;
    p.life = 0;
    p.max = 1.6 + Math.random() * 0.8;
    p.size = (0.12 + Math.random() * 0.08) * (0.6 + strength);
    p.mesh.position.set((Math.random() - 0.5) * 0.2, 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 0.2);
    p.vel.set((Math.random() - 0.5) * 0.3 + 0.15, 0.7 + Math.random() * 0.5, (Math.random() - 0.5) * 0.3);
    p.mesh.visible = true;
  }

  /** eruption: 0..1 strength of the active eruption; warning: 0..1 build-up before it. */
  update(dt: number, eruption: number, warning: number): void {
    // spawning
    const rate = eruption * 70 + warning * warning * 6;
    this.spawnAcc += rate * dt;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      if (eruption > 0) {
        const core = Math.random() < 0.4;
        this.spawn(core ? 5.5 + eruption * 1.5 : 3 + eruption * 2, core ? 0.3 : 1.2, core ? 0.06 : 0.045);
        if (Math.random() < 0.25) this.spawn(1.2, 0.5, 0.02, true);
      } else {
        this.spawn(1.4 + warning, 0.4, 0.035);
      }
    }
    this.smokeAcc += (eruption * 4 + warning * 0.8) * dt;
    while (this.smokeAcc >= 1) {
      this.smokeAcc -= 1;
      this.puff(eruption);
    }
    // blobs
    let n = 0;
    this.blobs = this.blobs.filter(b => {
      b.life += dt;
      b.vel.y -= b.gravity * dt;
      if (b.ember) b.vel.x += 0.3 * dt;
      b.pos.addScaledVector(b.vel, dt);
      if (!b.ember && b.pos.y <= 0.02 && b.vel.y < 0) {
        if (this.splats.length < 48 && b.size > 0.03)
          this.splats.push({ x: b.pos.x, z: b.pos.z, life: 0, max: 0.9 + Math.random() * 0.5, size: b.size * 1.6 });
        return false;
      }
      return b.life < b.max;
    });
    for (const b of this.blobs) {
      const speed = b.vel.length();
      const stretch = b.ember ? 1 : 1 + Math.min(1.6, speed * 0.18);
      this.q.setFromUnitVectors(this.up, speed > 0.01 ? b.vel.clone().divideScalar(speed) : this.up);
      const s = b.size * (b.ember ? 1 - b.life / b.max : 1);
      this.m.compose(b.pos, this.q, new THREE.Vector3(s / Math.sqrt(stretch), s * stretch, s / Math.sqrt(stretch)));
      this.blobMesh.setMatrixAt(n, this.m);
      // cools from white-hot through orange to dark crust
      const cool = b.ember ? b.life / b.max : Math.min(1, b.life / 2.4);
      if (cool < 0.3)
        this.c
          .copy(LAVA_WHITE)
          .lerp(LAVA_HOT, cool / 0.3)
          .multiplyScalar(2.2 - cool * 1.5);
      else
        this.c
          .copy(LAVA_HOT)
          .multiplyScalar(2.3 - cool * 1.6)
          .lerp(LAVA_CRUST, Math.max(0, cool - 0.6) * 1.5);
      this.blobMesh.setColorAt(n, this.c);
      n++;
    }
    this.blobMesh.count = n;
    this.blobMesh.instanceMatrix.needsUpdate = true;
    if (this.blobMesh.instanceColor) this.blobMesh.instanceColor.needsUpdate = true;
    // splats glow and fade to crust
    let k = 0;
    this.splats = this.splats.filter(sp => (sp.life += dt) < sp.max);
    for (const sp of this.splats) {
      const f = sp.life / sp.max;
      this.m.compose(
        new THREE.Vector3(sp.x, 0.015, sp.z),
        new THREE.Quaternion(),
        new THREE.Vector3(sp.size * (1 + f * 0.4), 1, sp.size * (1 + f * 0.4)),
      );
      this.splatMesh.setMatrixAt(k, this.m);
      this.c
        .copy(LAVA_HOT)
        .multiplyScalar(2.2 * (1 - f) + 0.2)
        .lerp(LAVA_CRUST, f * f);
      this.splatMesh.setColorAt(k, this.c);
      k++;
    }
    this.splatMesh.count = k;
    this.splatMesh.instanceMatrix.needsUpdate = true;
    if (this.splatMesh.instanceColor) this.splatMesh.instanceColor.needsUpdate = true;
    // smoke rolls up, grows and thins out
    for (const p of this.smoke) {
      if (p.life >= p.max) continue;
      p.life += dt;
      const f = Math.min(1, p.life / p.max);
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(1 - dt * 0.6);
      p.mesh.scale.setScalar(p.size * (1 + f * 2.2));
      (p.mesh.material as THREE.MeshStandardMaterial).opacity =
        0.3 * Math.sin(Math.min(1, f * 1.2) * Math.PI) * (1 - f * 0.5);
      if (p.life >= p.max) p.mesh.visible = false;
    }
  }

  dispose(): void {
    this.blobMesh.geometry.dispose();
    (this.blobMesh.material as THREE.Material).dispose();
    this.splatMesh.geometry.dispose();
    (this.splatMesh.material as THREE.Material).dispose();
    for (const p of this.smoke) {
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
  }
}

export class StaticHazardView implements HazardView {
  object = new THREE.Group();
  private style: StaticStyle;
  private effect = new THREE.Group();
  private doors: THREE.Object3D[] = [];
  private flame: THREE.Mesh | null = null;
  private sparks: THREE.LineSegments | null = null;
  private column: THREE.Mesh | null = null;
  private burst: THREE.Mesh[] = [];
  /** The glow asked of the light pool every frame (where, what colour, how bright). */
  private lightAnchor = new THREE.Object3D();
  private light = { color: new THREE.Color(), intensity: 0, distance: 4 };
  private pit: THREE.Mesh | null = null;
  private fountain: LavaFountain | null = null;
  private vent: ReturnType<typeof ventLavaMaterial> | null = null;

  constructor(theme: ThemeId) {
    this.style = staticStyle(theme);
    const model = createHazard(this.style, this.style === 'trapdoor' ? ['trapdoorL', 'trapdoorR'] : []);
    if (model) {
      if (this.style === 'geyser') {
        // The vent's pool charges up (same lava colours as the rivers) until it erupts.
        const vent = (this.vent = ventLavaMaterial(LAVA.hot, LAVA.crust));
        model.root.traverse(o => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh && (mesh.material as THREE.Material).name === 'Lava') {
            mesh.material = vent;
            // Sits flush with the cone's rim in the model: lift it a hair to stop z-fighting.
            mesh.position.y += 0.012;
          }
        });
      }
      this.object.add(model.root);
      this.doors = [model.parts.get('trapdoorL'), model.parts.get('trapdoorR')].filter((d): d is THREE.Object3D => !!d);
    } else {
      this.object.add(new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 0.12, 16), mat(0x3a3230)));
    }
    this.object.add(this.effect);
    const color = this.style === 'outlet' ? 0x8ad8ff : this.style === 'candle' ? 0xffc060 : 0xff7a2a;
    this.light.color.set(color);
    this.lightAnchor.position.y = 0.8;
    this.object.add(this.lightAnchor);
    switch (this.style) {
      case 'geyser': {
        this.fountain = new LavaFountain();
        this.effect.add(this.fountain.group);
        this.light.color.copy(LAVA_HOT);
        break;
      }
      case 'candle':
      case 'mortar': {
        this.flame = new THREE.Mesh(
          new THREE.SphereGeometry(0.09, 12, 8).scale(1, 2, 1).translate(0, 0.12, 0),
          glow(0xffb040, 0.95),
        );
        this.flame.position.y = this.style === 'candle' ? 0.92 : 0.66;
        this.effect.add(this.flame);
        for (let i = 0; i < 10; i++) {
          const b = new THREE.Mesh(
            new THREE.SphereGeometry(0.05, 8, 6),
            glow([0xff4a8a, 0xffd23a, 0x6ad8ff, 0x9aff6a][i % 4]!),
          );
          this.burst.push(b);
          this.effect.add(b);
        }
        break;
      }
      case 'outlet': {
        this.sparks = new THREE.LineSegments(
          new THREE.BufferGeometry(),
          new THREE.LineBasicMaterial({ color: 0xbfeeff, transparent: true, toneMapped: false }),
        );
        this.effect.add(this.sparks);
        break;
      }
      case 'trapdoor':
        // The ground slab covers the modelled shaft, so an opening trapdoor shows a dark pit.
        this.pit = new THREE.Mesh(
          new THREE.PlaneGeometry(0.84, 0.84).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: 0x050404 }),
        );
        this.pit.position.y = 0.012;
        this.effect.add(this.pit);
        break;
    }
  }

  dispose(): void {
    this.fountain?.dispose();
    this.vent?.dispose();
  }

  update(e: Entity, ctx: HazardFrame): void {
    const h = e as EntityOf<'hazard'>;
    this.object.position.copy(at(h.x, h.y, 0));
    const info = staticHazardInfo(ctx.world.theme);
    const total = Math.max(1, msToTicks(info.time));
    const t = h.active ? THREE.MathUtils.clamp((ctx.tick - h.since) / total, 0, 1) : 0;
    const pulse = h.active ? Math.sin(t * Math.PI) : 0;
    this.light.intensity = pulse * 6;
    switch (this.style) {
      case 'geyser': {
        // Warning: the last 1.4 s before an eruption the vent starts to bubble and glow.
        const cycle = h.period + msToTicks(STATIC_COOLDOWN_MS);
        const warning = h.active
          ? 0
          : THREE.MathUtils.clamp(1 - (cycle - (ctx.tick - h.since)) / msToTicks(1400), 0, 1);
        const eruption = h.active ? Math.min(1, t * 6) * (1 - THREE.MathUtils.smoothstep(t, 0.75, 1)) : 0;
        this.fountain!.update(ctx.dt, eruption, warning);
        // Charge: builds up over the quiet part of the cycle, drains while it erupts.
        const charge = h.active
          ? 1 - t * 0.85
          : Math.pow(THREE.MathUtils.clamp((ctx.tick - h.since) / Math.max(1, cycle), 0, 1), 1.3);
        if (this.vent) {
          this.vent.userData.time.value = ctx.time;
          this.vent.userData.charge.value = charge;
        }
        const flicker = 0.85 + Math.sin(ctx.time * 31) * 0.1 + Math.sin(ctx.time * 17) * 0.05;
        this.light.intensity = (eruption * 9 + charge * charge * 2.2 + 0.2) * flicker;
        this.light.distance = 3 + eruption * 3;
        break;
      }
      case 'candle':
      case 'mortar': {
        const flick = 1 + Math.sin(ctx.time * 23) * 0.08 + Math.sin(ctx.time * 37) * 0.05;
        const big = this.style === 'candle' ? 1 + pulse * 4 : pulse * 2.5;
        this.flame!.visible = this.style === 'candle' || h.active;
        this.flame!.scale.set(flick * (1 + pulse * 1.5), flick * big, flick * (1 + pulse * 1.5));
        this.burst.forEach((b, i) => {
          b.visible = h.active && this.style === 'mortar';
          const a = (i / this.burst.length) * Math.PI * 2;
          const r = t * 1.4;
          b.position.set(Math.cos(a) * r, 0.7 + t * 2.2 - t * t * 1.5, Math.sin(a) * r);
        });
        if (this.style === 'candle') this.light.intensity = 1.2 + pulse * 6;
        break;
      }
      case 'trapdoor': {
        // Doors swing open while the trapdoor is active.
        const open = h.active
          ? THREE.MathUtils.smoothstep(t, 0, 0.25) * (1 - THREE.MathUtils.smoothstep(t, 0.8, 1))
          : 0;
        // Hinges run along z at the outer edges; the doors drop into the pit.
        this.doors.forEach((d, i) => (d.rotation.z = (i === 0 ? -1 : 1) * open * 1.9));
        this.pit!.visible = open > 0.02;
        this.pit!.scale.set(Math.min(1, open * 3), 1, 1);
        break;
      }
      case 'outlet': {
        const s = this.sparks!;
        s.visible = h.active;
        if (h.active) {
          const pts: number[] = [];
          for (let k = 0; k < 5; k++) {
            let x = (k % 2 ? 0.12 : -0.12) * (1 + Math.sin(ctx.time * 40 + k));
            let y = 0.1;
            let z = 0.05;
            for (let j = 0; j < 4; j++) {
              const nx = x + (Math.random() - 0.5) * 0.3;
              const ny = y + 0.12 + Math.random() * 0.15;
              const nz = z + (Math.random() - 0.5) * 0.3;
              pts.push(x, y, z, nx, ny, nz);
              x = nx;
              y = ny;
              z = nz;
            }
          }
          s.geometry.dispose();
          s.geometry = new THREE.BufferGeometry();
          s.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        }
        break;
      }
    }
    ctx.lights?.request(this.lightAnchor, this.light.color, this.light.intensity, this.light.distance);
  }
}

// --- birds and planes -----------------------------------------------------------------------------

export class DropperView implements HazardView {
  object = new THREE.Group();
  private flyer = new THREE.Group();
  private shadow = groundShadow(0.45);
  private wings: THREE.Object3D[] = [];
  private prop: THREE.Object3D | null = null;

  constructor(theme: ThemeId) {
    const plane = theme === 'sweetz' || theme === 'minis' || theme === 'rollerz';
    const model = plane ? createHazard('plane', ['planeProp']) : createHazard('bird', ['birdWingL', 'birdWingR']);
    if (model) {
      // Models are exported Y-up with the nose pointing north (-z).
      this.flyer.add(model.root);
      this.wings = [model.parts.get('birdWingL'), model.parts.get('birdWingR')].filter((w): w is THREE.Object3D => !!w);
      this.prop = model.parts.get('planeProp') ?? null;
    } else {
      this.flyer.add(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.6, 8).rotateX(Math.PI / 2), mat(0xe8342a)));
    }
    this.flyer.scale.setScalar(1.3);
    this.object.add(this.flyer, this.shadow);
  }

  update(e: Entity, ctx: HazardFrame): void {
    const d = e as EntityOf<'dropper'>;
    const p = dropperPosition(ctx.world, d, ctx.tick + (ctx.dt ? 0 : 0));
    const ground = groundY(ctx.world, p.x + 0.5, p.y + 0.5);
    this.flyer.position.copy(at(p.x, p.y, ground + FLY_HEIGHT + Math.sin(ctx.time * 2 + d.id) * 0.1));
    this.shadow.position.copy(at(p.x, p.y, ground + 0.03));
    // Face the flying direction (0 north = -z, 2 east = +x).
    this.flyer.rotation.y = -(d.dir * Math.PI) / 4;
    const flap = Math.sin(ctx.time * 12) * 0.7;
    this.wings.forEach((w, i) => (w.rotation.y = (i === 0 ? 1 : -1) * flap));
    if (this.prop) this.prop.rotation.y += ctx.dt * 40;
  }
}

export class PoopView implements HazardView {
  object = new THREE.Group();
  private thing: THREE.Object3D;
  private warn: THREE.Mesh;
  private splat: THREE.Mesh;

  constructor(theme: ThemeId) {
    const name = theme === 'sweetz' || theme === 'minis' || theme === 'rollerz' ? 'candybomb' : 'coconut';
    const model = createHazard(name);
    this.thing = model?.root ?? new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), mat(0x6a4020));
    this.warn = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.42, 28).rotateX(-Math.PI / 2), glow(0xff3a2a, 0.8));
    this.warn.renderOrder = 3;
    this.splat = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2),
      mat(name === 'coconut' ? 0x7a5a3a : 0xc86ad8),
    );
    this.splat.visible = false;
    this.object.add(this.thing, this.warn, this.splat);
  }

  update(e: Entity, ctx: HazardFrame): void {
    const p = e as EntityOf<'poop'>;
    const fall = msToTicks(2000);
    const t = THREE.MathUtils.clamp((ctx.tick - p.dropped) / fall, 0, 1);
    this.object.position.copy(at(p.px, p.py, 0));
    this.thing.visible = !p.hit;
    this.thing.position.y = FLY_HEIGHT * (1 - t * t);
    this.thing.rotation.x += ctx.dt * 6;
    this.warn.visible = !p.hit;
    const k = 1.4 - t * 0.6;
    this.warn.scale.set(k, 1, k);
    this.warn.position.y = 0.04;
    (this.warn.material as THREE.MeshBasicMaterial).opacity = 0.5 + Math.sin(ctx.time * 14) * 0.3;
    this.splat.visible = p.hit;
    this.splat.position.y = 0.03;
  }
}

// --- storm clouds ---------------------------------------------------------------------------------

export class CloudView implements HazardView {
  object = new THREE.Group();
  private cloud: THREE.Object3D;
  private rain: THREE.LineSegments;
  private bolt: THREE.Line;
  private shadow = groundShadow(0.9, 0.35);
  private light = new THREE.PointLight(0xcfe8ff, 0, 5, 2);
  private nextBolt = 0;

  constructor() {
    this.cloud =
      createHazard('cloud')?.root ??
      new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 10).scale(1.3, 0.6, 1), mat(0x5a5e6a));
    const drops: number[] = [];
    for (let i = 0; i < 40; i++) {
      const x = (Math.random() - 0.5) * 1.4;
      const z = (Math.random() - 0.5) * 1.2;
      const y = Math.random() * FLY_HEIGHT;
      drops.push(x, y, z, x, y - 0.25, z);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(drops, 3));
    this.rain = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x9ab8e8, transparent: true, opacity: 0.6 }),
    );
    this.bolt = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xf8ffff, toneMapped: false }),
    );
    this.light.position.y = 1.5;
    this.object.add(this.cloud, this.rain, this.bolt, this.shadow, this.light);
  }

  update(e: Entity, ctx: HazardFrame): void {
    const c = e as EntityOf<'cloud'>;
    const p = pathPosition(c, ctx.tick);
    this.object.position.copy(at(p.x, p.y, 0));
    this.cloud.position.y = FLY_HEIGHT;
    this.shadow.position.y = 0.03;
    // Falling rain.
    const pos = this.rain.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 2) {
      let y = pos.getY(i) - ctx.dt * 7;
      if (y < 0) y += FLY_HEIGHT - 0.2;
      pos.setY(i, y);
      pos.setY(i + 1, y - 0.25);
    }
    pos.needsUpdate = true;
    // Lightning every now and then (the zap itself kills whatever is underneath).
    if (ctx.time > this.nextBolt) {
      this.nextBolt = ctx.time + 0.6 + Math.random() * 1.2;
      const pts: THREE.Vector3[] = [];
      let x = 0;
      let z = 0;
      for (let y = FLY_HEIGHT - 0.2; y > 0; y -= 0.45) {
        pts.push(new THREE.Vector3(x, y, z));
        x += (Math.random() - 0.5) * 0.35;
        z += (Math.random() - 0.5) * 0.35;
      }
      pts.push(new THREE.Vector3(0, 0, 0));
      this.bolt.geometry.dispose();
      this.bolt.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    }
    const flash = THREE.MathUtils.clamp(1 - (this.nextBolt - ctx.time) * 6, 0, 1);
    this.bolt.visible = this.nextBolt - ctx.time > 0.45 || flash > 0.9;
    this.light.intensity = this.bolt.visible ? 8 : 0;
  }
}

// --- UFO --------------------------------------------------------------------------------------------

export class UfoView implements HazardView {
  object = new THREE.Group();
  private ship: THREE.Object3D;
  private beams: THREE.Mesh[] = [];
  private spots: THREE.Mesh[] = [];
  private shadow = groundShadow(0.7);

  constructor() {
    this.ship =
      createHazard('ufo')?.root ??
      new THREE.Mesh(new THREE.SphereGeometry(0.6, 20, 10).scale(1, 0.25, 1), mat(0xb8c0cc, 0.3, 0.7));
    this.object.add(this.ship, this.shadow);
    for (let i = 0; i < 2; i++) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.34, 1, 16, 1, true).translate(0, -0.5, 0),
        glow(0x9aff6a, 0.22),
      );
      beam.material.side = THREE.DoubleSide;
      const spot = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20).rotateX(-Math.PI / 2), glow(0xb8ff8a, 0.5));
      spot.renderOrder = 3;
      this.beams.push(beam);
      this.spots.push(spot);
      this.object.add(beam, spot);
    }
  }

  update(e: Entity, ctx: HazardFrame): void {
    const u = e as EntityOf<'ufo'>;
    const p = pathPosition(u, ctx.tick);
    const ground = groundY(ctx.world, p.x + 0.5, p.y + 0.5);
    const base = at(p.x, p.y, ground);
    this.object.position.set(0, 0, 0);
    this.ship.position.set(base.x, ground + FLY_HEIGHT + 0.2 + Math.sin(ctx.time * 2) * 0.08, base.z);
    this.ship.rotation.y += ctx.dt * 1.5;
    this.shadow.position.set(base.x, ground + 0.03, base.z);
    ufoBeams(u, ctx.tick).forEach((b, i) => {
      const target = at(b.x, b.y, groundY(ctx.world, b.x + 0.5, b.y + 0.5) + 0.04);
      const from = this.ship.position;
      const beam = this.beams[i]!;
      beam.position.copy(from);
      const dir = new THREE.Vector3().subVectors(target, from);
      const len = dir.length();
      beam.scale.set(1, len, 1);
      beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
      this.spots[i]!.position.copy(target);
    });
  }
}

// --- "star search" spotlight --------------------------------------------------------------------------

export class SpotLightView implements HazardView {
  object = new THREE.Group();
  private cone: THREE.Mesh;
  private spot: THREE.Mesh;
  private light = new THREE.SpotLight(0xfff2c0, 20, 12, 0.22, 0.5, 1.5);

  constructor() {
    this.cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.5, 1, 20, 1, true).translate(0, -0.5, 0),
      glow(0xfff2c0, 0.16),
    );
    (this.cone.material as THREE.Material).side = THREE.DoubleSide;
    this.spot = new THREE.Mesh(new THREE.CircleGeometry(0.5, 28).rotateX(-Math.PI / 2), glow(0xfff6d8, 0.45));
    this.spot.renderOrder = 3;
    this.object.add(this.cone, this.spot, this.light, this.light.target);
  }

  update(e: Entity, ctx: HazardFrame): void {
    const s = e as EntityOf<'spotlight'>;
    const p = spotPosition(s, ctx.tick);
    const target = at(p.x, p.y, groundY(ctx.world, p.x + 0.5, p.y + 0.5) + 0.04);
    const from = at(s.x, s.y, 7 + groundY(ctx.world, s.x + 0.5, s.y + 0.5));
    this.cone.position.copy(from);
    const dir = new THREE.Vector3().subVectors(target, from);
    this.cone.scale.set(1, dir.length(), 1);
    this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.normalize());
    this.spot.position.copy(target);
    const k = 1 + Math.sin(ctx.time * 3) * 0.04;
    this.spot.scale.set(k, 1, k);
    this.light.position.copy(from);
    this.light.target.position.copy(target);
  }
}

// --- kitchen slime --------------------------------------------------------------------------------------

export class SlimeView implements HazardView {
  object = new THREE.Group();
  private blob: THREE.Mesh;
  private drops: THREE.Mesh[] = [];

  constructor() {
    const m = new THREE.MeshStandardMaterial({
      color: 0x7ad83a,
      roughness: 0.25,
      emissive: 0x2a6a10,
      emissiveIntensity: 0.6,
      transparent: true,
      opacity: 0.9,
    });
    this.blob = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 14), m);
    this.blob.castShadow = true;
    this.object.add(this.blob);
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), m);
      this.drops.push(d);
      this.object.add(d);
    }
  }

  update(e: Entity, ctx: HazardFrame): void {
    const s = e as EntityOf<'slime'>;
    const p = slimePosition(s, ctx.tick);
    this.object.position.copy(at(p.x, p.y, 0));
    const wob = Math.sin(ctx.time * 6);
    this.blob.scale.set(1.2 + wob * 0.12, 0.55 - wob * 0.08, 1.2 - wob * 0.12);
    this.blob.position.y = 0.16;
    this.drops.forEach((d, i) => {
      const a = ctx.time * 2 + (i * Math.PI) / 2;
      d.position.set(Math.cos(a) * 0.38, 0.06 + Math.abs(Math.sin(a * 1.5)) * 0.06, Math.sin(a) * 0.38);
    });
  }
}

export function createHazardView(e: Entity, theme: ThemeId): HazardView | null {
  switch (e.kind) {
    case 'hazard':
      return new StaticHazardView(theme);
    case 'dropper':
      return new DropperView(theme);
    case 'poop':
      return new PoopView(theme);
    case 'cloud':
      return new CloudView();
    case 'ufo':
      return new UfoView();
    case 'spotlight':
      return new SpotLightView();
    case 'slime':
      return new SlimeView();
    default:
      return null;
  }
}
