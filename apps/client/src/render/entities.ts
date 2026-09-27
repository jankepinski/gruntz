import * as THREE from 'three';
import {
  DIRS,
  MAX_FLIGHT,
  MAX_HEALTH,
  msToTicks,
  projectilePosition,
  stamina,
  TICK_MS,
  TOY_INFO,
  type Entity,
  type EntityId,
  type Grunt,
  type ThemeId,
  type ToyId,
  type World,
} from '@gruntz/core';
import {
  AI_COLORS,
  BRICK_COLORS,
  buildGrunt,
  buildItem,
  isPowerupItem,
  mat,
  TEAM_COLORS,
  type GruntRig,
} from './placeholders.ts';
import { ClipPlayer, createGrunt, createProp, type GruntModel } from './models.ts';
import { themeRock } from './tileKit.ts';
import { groundY } from './elevation.ts';
import { createHazardView } from './hazardViews.ts';
import { LightPool } from './lightPool.ts';

export interface FrameCtx {
  world: World;
  tick: number;
  dt: number;
  time: number;
  viewer: number;
  selected: ReadonlySet<EntityId>;
  hovered: EntityId | null;
  showAllBars: boolean;
  /** Ready ovens: highlight our pads. */
  padsFlashing: boolean;
  /** Client-side prediction of our own gruntz (tile coordinates), if any. */
  predict?: (g: Grunt, tick: number) => { x: number; y: number } | null;
}

interface View {
  object: THREE.Object3D;
  update(e: Entity, ctx: FrameCtx): void;
  dispose?(): void;
}

const tmpV = new THREE.Vector3();

function tilePos(x: number, y: number, h = 0): THREE.Vector3 {
  return new THREE.Vector3(x + 0.5, h, y + 0.5);
}

function facingAngle(dir: number): number {
  const d = DIRS[dir]!;
  return Math.atan2(d.x, d.y);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function gruntColor(g: Grunt): number {
  if (g.ai) return AI_COLORS[g.ai] ?? 0x999999;
  return TEAM_COLORS[g.team] ?? 0x999999;
}

/** Where a grunt is drawn at a (fractional) tick, in tile units. */
export function gruntTilePosition(g: Grunt, tick: number): { x: number; y: number; hop: number; moving: boolean } {
  const a = g.action;
  if ((a.kind === 'move' || a.kind === 'jump') && a.fromX !== undefined && a.fromY !== undefined) {
    const t = THREE.MathUtils.clamp((tick - a.start) / Math.max(1, a.end - a.start), 0, 1);
    const hop = a.kind === 'jump' ? Math.sin(t * Math.PI) * 0.8 : 0;
    return { x: a.fromX + (g.x - a.fromX) * t, y: a.fromY + (g.y - a.fromY) * t, hop, moving: t < 1 };
  }
  if (a.kind === 'play' && a.moving && a.fromX !== undefined && a.fromY !== undefined && a.variant !== undefined) {
    const rate = msToTicks(TOY_INFO[a.item as ToyId]?.rate ?? 600);
    const t = THREE.MathUtils.clamp((tick - a.variant) / rate, 0, 1);
    return { x: a.fromX + (g.x - a.fromX) * t, y: a.fromY + (g.y - a.fromY) * t, hop: 0, moving: t < 1 };
  }
  return { x: g.x, y: g.y, hop: 0, moving: false };
}

// --- bars ---------------------------------------------------------------------------

class Bars {
  readonly group = new THREE.Group();
  private bars: { bg: THREE.Mesh; fg: THREE.Mesh; mat: THREE.MeshBasicMaterial }[] = [];
  private static bgMat = new THREE.MeshBasicMaterial({
    color: 0x1a1410,
    depthTest: false,
    transparent: true,
    opacity: 0.75,
  });
  private static geo = new THREE.PlaneGeometry(1, 1);

  constructor(count: number) {
    for (let i = 0; i < count; i++) {
      const bg = new THREE.Mesh(Bars.geo, Bars.bgMat);
      const m = new THREE.MeshBasicMaterial({ color: 0x55dd44, depthTest: false });
      const fg = new THREE.Mesh(Bars.geo, m);
      bg.renderOrder = 998;
      fg.renderOrder = 999;
      bg.scale.set(0.56, 0.075, 1);
      fg.position.z = 0.001;
      this.group.add(bg, fg);
      this.bars.push({ bg, fg, mat: m });
    }
  }

  set(index: number, value: number | null, color: number): void {
    const bar = this.bars[index]!;
    const visible = value !== null;
    bar.bg.visible = visible;
    bar.fg.visible = visible;
    if (value === null) return;
    const v = THREE.MathUtils.clamp(value, 0, 1);
    bar.mat.color.setHex(color);
    const y = -index * 0.1;
    bar.bg.position.set(0, y, 0);
    bar.fg.scale.set(0.52 * v, 0.045, 1);
    bar.fg.position.set(-0.26 + 0.26 * v, y, 0.001);
  }

  face(camera: THREE.Camera): void {
    this.group.quaternion.copy(camera.quaternion);
  }
}

// --- grunts --------------------------------------------------------------------------

class GruntView implements View {
  object = new THREE.Group();
  /** Blender model (preferred) or the procedural placeholder rig. */
  private model: GruntModel | null;
  private player: ClipPlayer | null = null;
  private body = new THREE.Group();
  private rig: GruntRig;
  private color: number;
  private toolItem: string | null = null;
  private toolMesh: THREE.Object3D | null = null;
  private toyMesh: THREE.Object3D | null = null;
  private toyItem: string | null = null;
  private ring: THREE.Mesh;
  private bars = new Bars(3);
  private pos = new THREE.Vector3();
  /** Visual error being smoothed away (prediction hand-off, snaps). */
  private error = new THREE.Vector3();
  private wasPredicted = false;
  private lastPredicted = new THREE.Vector3();
  private yaw = 0;
  private initialized = false;
  private flash = 0;
  private lastHealth = MAX_HEALTH;
  private damagedAt = -10;
  private powerFx: THREE.Mesh;

  constructor(
    g: Grunt,
    private camera: () => THREE.Camera,
  ) {
    this.color = gruntColor(g);
    this.rig = buildGrunt(this.color);
    this.model = createGrunt(this.color);
    this.object.add(this.body);
    if (this.model) {
      this.body.add(this.model.root);
      this.player = new ClipPlayer(this.model);
      this.player.play('idle');
      // desynchronise idle loops
      this.model.mixer.update(Math.random() * 2);
    } else {
      this.body.add(this.rig.root);
    }
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x7dff6a,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.36, 0.44, 32), ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.02;
    this.ring.renderOrder = 2;
    this.object.add(this.ring);
    this.bars.group.position.y = 1.15;
    this.object.add(this.bars.group);
    this.powerFx = new THREE.Mesh(
      new THREE.TorusGeometry(0.34, 0.02, 6, 32),
      new THREE.MeshBasicMaterial({ color: 0xff3a3a, transparent: true, opacity: 0.8 }),
    );
    this.powerFx.rotation.x = -Math.PI / 2;
    this.powerFx.position.y = 0.45;
    this.object.add(this.powerFx);
    this.lastHealth = g.health;
  }

  update(e: Entity, ctx: FrameCtx): void {
    const g = e as Grunt;
    const color = gruntColor(g);
    if (color !== this.color) {
      this.color = color;
      this.rig.skin.color.setHex(color);
      if (this.model) this.model.skin.color.setHex(color).multiplyScalar(1.5);
    }
    this.syncTool(g);
    this.syncToy(g);

    const p = gruntTilePosition(g, ctx.tick);
    const predicted = ctx.predict?.(g, ctx.tick) ?? null;
    const target = predicted ? tilePos(predicted.x, predicted.y) : tilePos(p.x, p.y, p.hop);
    if (this.wasPredicted && !predicted) this.error.copy(this.pos).sub(target);
    let predictedYaw: number | null = null;
    if (predicted) {
      const dx = target.x - this.lastPredicted.x;
      const dz = target.z - this.lastPredicted.z;
      if (Math.abs(dx) + Math.abs(dz) > 1e-4) predictedYaw = Math.atan2(dx, dz);
      this.lastPredicted.copy(target);
    }
    this.wasPredicted = !!predicted;
    const moving = !!predicted || p.moving;
    if (!this.initialized || moving || g.action.kind === 'jump') {
      this.pos.copy(target).add(this.error);
    } else {
      this.pos.lerp(target.clone().add(this.error), 1 - Math.exp(-ctx.dt * 14));
    }
    this.error.multiplyScalar(Math.exp(-ctx.dt * 7));
    this.initialized = true;
    this.object.position.copy(this.pos);
    const yawGoal = predictedYaw ?? facingAngle(g.facing);
    this.yaw = lerpAngle(this.yaw, yawGoal, 1 - Math.exp(-ctx.dt * 14));
    this.body.rotation.y = this.yaw;

    if (g.health < this.lastHealth) {
      this.flash = 1;
      this.damagedAt = ctx.time;
    }
    this.lastHealth = g.health;
    this.flash = Math.max(0, this.flash - ctx.dt * 5);
    this.rig.skin.emissive.setRGB(this.flash * 0.9, this.flash * 0.3, this.flash * 0.2);

    if (this.model) this.animateModel(g, ctx, moving, !!predicted);
    else this.animate(g, ctx, moving, !!predicted);

    // Selection & bars.
    const selected = ctx.selected.has(g.id);
    const hovered = ctx.hovered === g.id;
    this.ring.visible = selected || hovered;
    (this.ring.material as THREE.MeshBasicMaterial).color.setHex(
      g.team === ctx.viewer ? (selected ? 0x7dff6a : 0xc8ffc0) : 0xff5a4a,
    );
    const st = stamina(ctx.world, g) / 20;
    const showBars = selected || hovered || ctx.showAllBars || ctx.time - this.damagedAt < 2;
    const dying = g.action.kind === 'death';
    this.bars.set(
      0,
      showBars && !dying ? g.health / MAX_HEALTH : null,
      g.health > 12 ? 0x55dd44 : g.health > 6 ? 0xf2c83a : 0xe8413a,
    );
    this.bars.set(1, st < 1 && !dying && (g.team === ctx.viewer || showBars) ? st : null, 0x4aa8ff);
    this.bars.set(2, g.flying ? g.flight / MAX_FLIGHT : null, 0xd0d0d8);
    this.bars.face(this.camera());

    this.powerFx.visible = !!g.powerup;
    if (g.powerup) {
      this.powerFx.rotation.z += ctx.dt * 3;
      (this.powerFx.material as THREE.MeshBasicMaterial).color.setHex(g.powerup === 'GHOST' ? 0xc8c8ff : 0xff3a3a);
    }
    const ghost = g.powerup === 'GHOST';
    const skinMat = this.model ? this.model.skin : this.rig.skin;
    if (ghost !== skinMat.transparent) {
      skinMat.transparent = ghost;
      skinMat.opacity = ghost ? 0.45 : 1;
      skinMat.needsUpdate = true;
    }
  }

  private syncTool(g: Grunt): void {
    const tool = g.tool === 'TOOBWATER' ? 'TOOB' : g.tool;
    if (tool === this.toolItem) return;
    if (this.toolMesh) this.toolMesh.removeFromParent();
    this.toolItem = tool;
    this.toolMesh = null;
    if (!tool) return;
    const item = buildItem(tool);
    if (this.model) {
      this.attachModelTool(tool, item);
      this.toolMesh = item;
      return;
    }
    if (tool === 'TOOB') {
      item.position.set(0, 0.22, 0);
      this.rig.body.add(item);
    } else if (tool === 'GUNHAT') {
      item.position.set(0, 0.24, 0);
      this.rig.head.add(item);
    } else if (tool === 'WINGZ') {
      item.position.set(0, 0.38, -0.16);
      this.rig.body.add(item);
    } else if (tool === 'GRAVITYBOOTZ') {
      item.scale.setScalar(0.6);
      this.rig.legL.add(item);
      item.position.set(0, -0.12, 0.02);
    } else if (tool === 'SPY') {
      item.position.set(0, 0.03, 0.22);
      this.rig.head.add(item);
    } else if (tool === 'WARPSTONE') {
      item.position.set(0, 0.95, 0);
      this.rig.body.add(item);
    } else {
      this.rig.hand.add(item);
    }
    this.toolMesh = item;
  }

  /** Tools on the Blender model: held in the right hand socket or worn on a bone. */
  private attachModelTool(tool: string, item: THREE.Object3D): void {
    const m = this.model!;
    const bone = (name: string) => m.bones.get(name) ?? m.socket;
    switch (tool) {
      case 'TOOB':
        attachUpright(m, bone('pelvis'), item, new THREE.Vector3(0, 0.2, 0));
        item.scale.setScalar(0.85);
        break;
      case 'GUNHAT':
        attachUpright(m, bone('head'), item, new THREE.Vector3(0, 0.8, 0.0));
        break;
      case 'SPY':
        attachUpright(m, bone('head'), item, new THREE.Vector3(0, 0.67, 0.2));
        break;
      case 'WINGZ':
        attachUpright(m, bone('spine'), item, new THREE.Vector3(0, 0.36, -0.12));
        break;
      case 'GRAVITYBOOTZ': {
        const other = buildItem(tool);
        attachUpright(m, bone('footL'), item, new THREE.Vector3(0.1, 0.06, 0.02));
        attachUpright(m, bone('footR'), other, new THREE.Vector3(-0.1, 0.06, 0.02));
        break;
      }
      case 'WARPSTONE':
        this.body.add(item);
        item.position.set(0, 1.05, 0);
        break;
      default:
        attachUpright(m, m.socket, item);
    }
  }

  /** Idle with an occasional fidget (head scratch) when standing around for a while. */
  private idleSince = -1;
  private fidgetUntil = 0;
  private nextFidget = 0;

  private playIdle(ctx: FrameCtx, clip: string): void {
    const player = this.player!;
    if (clip !== 'idle') {
      this.idleSince = -1;
      player.play(clip);
      return;
    }
    if (this.idleSince < 0) {
      this.idleSince = ctx.time;
      this.nextFidget = 7 + Math.random() * 12;
    }
    if (ctx.time < this.fidgetUntil) return;
    if (ctx.time - this.idleSince > this.nextFidget) {
      player.play('fidget', { loop: false, duration: 1.6, key: `fidget${Math.floor(ctx.time * 10)}`, fade: 0.25 });
      this.fidgetUntil = ctx.time + 1.6;
      this.idleSince = ctx.time;
      this.nextFidget = 9 + Math.random() * 14;
      return;
    }
    player.play('idle', { fade: 0.3, randomStart: true });
  }

  private animateModel(g: Grunt, ctx: FrameCtx, moving: boolean, predicted: boolean): void {
    const player = this.player!;
    const a = g.action;
    const idling = (a.kind === 'idle' || ((a.kind === 'move' || a.kind === 'jump') && !moving)) && !predicted;
    if (!idling) {
      this.idleSince = -1;
      this.fidgetUntil = 0;
    }
    const seconds = Math.max(0.05, ((a.end - a.start) * TICK_MS) / 1000);
    const swim = g.tool === 'TOOBWATER';
    this.body.position.set(0, swim ? -0.2 + Math.sin(ctx.time * 2) * 0.02 : 0, 0);
    this.body.scale.setScalar(1);
    this.model!.skin.emissive.setRGB(this.flash * 0.9, this.flash * 0.3, this.flash * 0.2);
    this.object.visible = true;
    player.freeze(false);
    const kind = predicted ? 'move' : a.kind;
    switch (kind) {
      case 'move':
      case 'jump':
        if (!moving) {
          this.playIdle(ctx, swim ? 'swim' : 'idle');
        } else if (g.flying) {
          player.play('fly');
        } else if (swim) {
          player.play('swim');
        } else {
          // One walk cycle covers one tile (0.6 s); match the step speed.
          const step = predicted ? 0.6 : seconds;
          player.play(a.run ? 'run' : 'walk', { speed: (a.run ? 0.34 : 0.6) / step });
        }
        break;
      case 'idle':
        this.playIdle(ctx, g.flying ? 'fly' : swim ? 'swim' : 'idle');
        break;
      case 'attackIdle':
        player.play('combat');
        break;
      case 'attack':
        player.play(a.item === 'TIMEBOMB' ? 'dig' : a.variant ? 'attack2' : 'attack', {
          loop: false,
          duration: seconds,
          key: `attack${a.start}`,
        });
        break;
      case 'throw':
        player.play('throw', { loop: false, duration: seconds, key: `throw${a.start}` });
        break;
      case 'tool': {
        const clip =
          a.item === 'SHOVEL' || a.item === 'BRICK'
            ? 'dig'
            : a.item === 'GOOBER'
              ? 'suck'
              : a.item === 'SPY'
                ? 'spy'
                : a.item === 'WAND' || a.item === 'BOMB'
                  ? 'cast'
                  : 'smash';
        const loop = clip === 'dig' || clip === 'suck' || clip === 'spy';
        player.play(
          clip,
          loop
            ? { key: `${clip}${a.start}` }
            : { loop: false, duration: Math.min(seconds, 1.2), key: `${clip}${a.start}` },
        );
        break;
      }
      case 'struck':
        if (a.item === 'FREEZE' || g.frozen) {
          player.freeze(true);
          this.model!.skin.emissive.setRGB(0.15, 0.35, 0.7);
        } else {
          player.play('struck', { loop: false, duration: seconds, key: `struck${a.start}` });
        }
        break;
      case 'play':
        player.play(a.variant === 2 ? 'idle' : 'play');
        break;
      case 'pickup':
        player.play('pickup', { loop: false, duration: seconds, key: `pickup${a.start}` });
        break;
      case 'swim':
        player.play('swim');
        break;
      case 'win':
        player.play('victory');
        break;
      case 'enter': {
        const phase = THREE.MathUtils.clamp((ctx.tick - a.start) / Math.max(1, a.end - a.start), 0, 1);
        player.play('idle');
        this.body.scale.setScalar(a.variant === 0 ? 1 - phase : a.variant === 2 ? Math.min(1, phase * 1.5) : phase);
        if (a.variant === 2) this.body.position.y = (1 - Math.min(1, phase * 1.5)) * 2.5;
        break;
      }
      case 'death': {
        const phase = THREE.MathUtils.clamp((ctx.tick - a.start) / Math.max(1, a.end - a.start), 0, 1);
        player.play('die', { loop: false, duration: Math.min(seconds, 1), key: `die${a.start}` });
        this.deathFx(a.item ?? 'GOO', phase, ctx.time);
        break;
      }
    }
    if (this.toyMesh && a.kind === 'play') {
      this.toyMesh.rotation.y += ctx.dt * 4;
      this.toyMesh.visible = a.variant !== 2 || Math.floor(ctx.time * 12) % 2 === 0;
    }
    player.update(ctx.dt);
  }

  private deathFx(kind: string, phase: number, time: number): void {
    const b = this.body;
    const skin = this.model!.skin;
    switch (kind) {
      case 'SINK':
      case 'HOLE':
        b.position.y = -phase * 1.2;
        break;
      case 'FALL':
        b.position.y = -phase * phase * 6;
        b.rotation.z = phase * 3;
        b.scale.setScalar(1 - phase * 0.6);
        break;
      case 'EXPLODE':
        b.scale.setScalar(1 + phase * 0.6);
        this.object.visible = phase < 0.4;
        break;
      case 'SQUASH':
        b.scale.set(1 + phase * 0.8, Math.max(0.05, 1 - phase), 1 + phase * 0.8);
        break;
      case 'BURN':
        skin.emissive.setRGB(0.3 * (1 - phase), 0.05, 0);
        b.scale.set(1, 1 - phase * 0.4, 1);
        break;
      case 'MELT':
      case 'GOO':
        if (phase > 0.4) {
          const k = (phase - 0.4) / 0.6;
          b.scale.set(1 + k * 0.9, Math.max(0.04, 1 - k), 1 + k * 0.9);
        }
        break;
      case 'ELECTROCUTE':
        skin.emissive.setRGB(0.6, 0.8, 1).multiplyScalar(Math.floor(time * 20) % 2);
        b.position.x = Math.sin(time * 60) * 0.03;
        break;
      case 'SHATTER':
        this.object.visible = phase < 0.2;
        break;
      case 'KARAOKE':
        b.position.y = phase > 0.8 ? -(phase - 0.8) * 5 : 0;
        break;
    }
  }

  private syncToy(g: Grunt): void {
    const playing = g.action.kind === 'play' ? (g.action.item ?? null) : null;
    if (playing === this.toyItem) return;
    if (this.toyMesh) this.toyMesh.removeFromParent();
    this.toyItem = playing;
    this.toyMesh = null;
    if (!playing) return;
    const item = buildItem(playing);
    item.position.set(0, 0.1, 0.25);
    (this.model ? this.body : this.rig.root).add(item);
    this.toyMesh = item;
  }

  private animate(g: Grunt, ctx: FrameCtx, moving: boolean, predicted = false): void {
    const r = this.rig;
    const t = ctx.time;
    const a = g.action;
    const phase = THREE.MathUtils.clamp((ctx.tick - a.start) / Math.max(1, a.end - a.start), 0, 1);
    // Reset pose.
    r.body.position.set(0, 0, 0);
    r.body.rotation.set(0, 0, 0);
    r.body.scale.set(1, 1, 1);
    r.armL.rotation.set(0, 0, 0.15);
    r.armR.rotation.set(0, 0, -0.15);
    r.legL.rotation.set(0, 0, 0);
    r.legR.rotation.set(0, 0, 0);
    r.head.rotation.set(0, 0, 0);
    r.earL.rotation.set(0, 0, Math.PI / 2 - 0.35 + Math.sin(t * 2.2 + g.id) * 0.06);
    r.earR.rotation.set(0, 0, -Math.PI / 2 + 0.35 - Math.sin(t * 2.2 + g.id + 1) * 0.06);
    this.object.visible = true;

    const swim = g.tool === 'TOOBWATER';
    if (swim) r.body.position.y = -0.22 + Math.sin(t * 2) * 0.03;

    switch (predicted ? 'move' : a.kind) {
      case 'move':
      case 'jump': {
        if (!moving) break;
        const s = Math.sin(t * 14);
        r.body.position.y += Math.abs(s) * 0.05;
        r.body.rotation.x = 0.12;
        r.legL.rotation.x = s * 0.7;
        r.legR.rotation.x = -s * 0.7;
        r.armL.rotation.x = -s * 0.6;
        r.armR.rotation.x = s * 0.6;
        if (a.run) r.body.rotation.x = 0.35;
        break;
      }
      case 'attack': {
        const k = Math.sin(phase * Math.PI);
        r.body.rotation.x = 0.35 * k;
        r.armR.rotation.x = -2.2 + 3.0 * phase;
        r.body.position.z = 0.08 * k;
        break;
      }
      case 'throw':
        r.armR.rotation.x = phase < 0.5 ? -2.6 * (phase * 2) : -2.6 + 3.4 * (phase - 0.5) * 2;
        break;
      case 'tool': {
        const k = Math.sin(phase * Math.PI * 6);
        if (a.item === 'SHOVEL') {
          r.body.rotation.x = 0.4 + k * 0.15;
          r.armR.rotation.x = -0.6 + k * 0.5;
          r.armL.rotation.x = -0.6 + k * 0.5;
        } else if (a.item === 'GAUNTLETZ') {
          const hit = Math.sin(Math.min(1, phase * 1.6) * Math.PI);
          r.armR.rotation.x = -2.4 * hit;
          r.body.rotation.x = 0.3 * hit;
        } else if (a.item === 'GOOBER') {
          r.body.rotation.x = 0.55;
          r.body.scale.set(1, 1 + Math.sin(t * 10) * 0.04, 1);
        } else if (a.item === 'SPY') {
          r.head.rotation.y = Math.sin(t * 6) * 0.6;
        } else if (a.item === 'BOMB') {
          r.body.position.y = Math.abs(Math.sin(t * 20)) * 0.04;
        } else {
          r.armR.rotation.x = -1.2 + k * 0.4;
        }
        break;
      }
      case 'struck':
        if (a.item === 'FREEZE' || g.frozen) {
          this.rig.skin.emissive.setRGB(0.1, 0.3, 0.6);
        } else {
          r.body.rotation.x = -0.4 * Math.sin(phase * Math.PI);
          r.head.rotation.z = Math.sin(phase * Math.PI * 4) * 0.3;
        }
        break;
      case 'attackIdle':
        r.armR.rotation.x = -0.5;
        r.body.position.y += Math.sin(t * 6) * 0.01;
        break;
      case 'pickup':
        r.armR.rotation.x = -2.8 * Math.sin(Math.min(1, phase * 2) * Math.PI * 0.5);
        r.armL.rotation.x = -2.8 * Math.sin(Math.min(1, phase * 2) * Math.PI * 0.5);
        break;
      case 'play': {
        const spin = a.variant === 2 ? 0 : 1;
        r.body.rotation.y = spin * Math.sin(t * 5) * 0.6;
        r.body.position.y = spin * Math.abs(Math.sin(t * 8)) * 0.12;
        r.armL.rotation.x = -1.5;
        r.armR.rotation.x = -1.5;
        break;
      }
      case 'swim':
        r.body.position.y = a.variant === 0 ? -0.22 * phase : -0.22 * (1 - phase);
        break;
      case 'win':
        r.body.position.y = Math.abs(Math.sin(t * 8)) * 0.25;
        r.armL.rotation.z = 2.6;
        r.armR.rotation.z = -2.6;
        break;
      case 'enter':
        r.body.scale.setScalar(a.variant === 0 ? 1 - phase : phase);
        r.body.rotation.y = phase * Math.PI * 4;
        break;
      case 'death':
        this.animateDeath(a.item ?? 'GOO', phase, t);
        break;
      default: {
        // Idle breathing.
        const b = Math.sin(t * 2.4 + g.id * 1.7);
        r.body.scale.set(1 + b * 0.012, 1 - b * 0.02, 1 + b * 0.012);
      }
    }
    if (this.toyMesh && a.kind === 'play') {
      this.toyMesh.rotation.y += ctx.dt * 4;
      this.toyMesh.visible = a.variant !== 2 || Math.floor(t * 12) % 2 === 0;
    }
  }

  private animateDeath(kind: string, phase: number, t: number): void {
    const r = this.rig;
    switch (kind) {
      case 'SINK':
      case 'HOLE':
        r.body.position.y = -phase * 1.2;
        r.armL.rotation.z = 2.6;
        r.armR.rotation.z = -2.6;
        break;
      case 'FALL':
        r.body.position.y = -phase * phase * 6;
        r.body.rotation.z = phase * 3;
        r.body.scale.setScalar(1 - phase * 0.6);
        break;
      case 'EXPLODE':
        r.body.scale.setScalar(1 + phase * 0.6);
        this.object.visible = phase < 0.4;
        break;
      case 'SQUASH':
        r.body.scale.set(1 + phase * 0.8, Math.max(0.05, 1 - phase), 1 + phase * 0.8);
        break;
      case 'BURN':
        this.rig.skin.color.setRGB(0.25 * (1 - phase) + 0.05, 0.08, 0.05);
        r.body.scale.set(1, 1 - phase * 0.5, 1);
        break;
      case 'MELT':
      case 'GOO':
        r.body.scale.set(1 + phase * 0.9, Math.max(0.04, 1 - phase), 1 + phase * 0.9);
        r.body.rotation.x = phase < 0.3 ? -phase : 0;
        break;
      case 'ELECTROCUTE':
        this.rig.skin.emissive.setRGB(0.6, 0.8, 1).multiplyScalar(Math.floor(t * 20) % 2);
        r.body.position.x = Math.sin(t * 60) * 0.03;
        break;
      case 'SHATTER':
        this.object.visible = phase < 0.2;
        break;
      case 'KARAOKE':
        r.armR.rotation.x = -2.2;
        r.body.position.y = phase > 0.8 ? -(phase - 0.8) * 5 : 0;
        break;
      default:
        r.body.scale.set(1, 1 - phase, 1);
    }
  }

  dispose(): void {
    this.object.removeFromParent();
  }
}

/**
 * Attach an item to a bone so that, in the model's rest pose, it stands upright and
 * faces forward at `offset` (model space; default: at the bone). Animations then move
 * it with the bone.
 */
function attachUpright(model: GruntModel, bone: THREE.Object3D, item: THREE.Object3D, offset?: THREE.Vector3): void {
  model.root.updateMatrixWorld(true);
  const rootInv = new THREE.Matrix4().copy(model.root.matrixWorld).invert();
  const boneRest = new THREE.Matrix4().multiplyMatrices(rootInv, bone.matrixWorld);
  const at = offset ?? new THREE.Vector3().setFromMatrixPosition(boneRest);
  const local = new THREE.Matrix4()
    .copy(boneRest)
    .invert()
    .multiply(new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
  local.decompose(item.position, item.quaternion, item.scale);
  bone.add(item);
}

// --- simple entities -----------------------------------------------------------------

class PickupView implements View {
  object = new THREE.Group();
  private item: THREE.Object3D;
  private sparkle: THREE.Mesh | null = null;

  constructor(e: Entity) {
    const p = e as Extract<Entity, { kind: 'pickup' }>;
    this.item = buildItem(p.item === 'TOYBOX' ? 'TOYBOX' : p.item);
    // Pickups are shown bigger than when carried, so they read from the game camera.
    if (p.item !== 'TOYBOX') this.item.scale.multiplyScalar(1.7);
    this.object.add(this.item);
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.2, 16),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.01;
    this.object.add(shadow);
    if (isPowerupItem(p.item) || p.item === 'MEGAPHONE') {
      this.sparkle = new THREE.Mesh(
        new THREE.TorusGeometry(0.25, 0.015, 6, 24),
        new THREE.MeshBasicMaterial({ color: p.item === 'MEGAPHONE' ? 0xffe066 : 0xff3a3a }),
      );
      this.object.add(this.sparkle);
    }
    this.object.position.copy(tilePos(p.x, p.y));
  }

  update(e: Entity, ctx: FrameCtx): void {
    const p = e as Extract<Entity, { kind: 'pickup' }>;
    const available = p.availableAt === undefined || ctx.tick >= p.availableAt;
    this.object.visible = available;
    if (p.item === 'TOYBOX') {
      this.item.position.y = 0;
      return;
    }
    this.item.position.y = 0.3 + Math.sin(ctx.time * 2 + p.id) * 0.05;
    this.item.rotation.y += ctx.dt * 1.5;
    if (this.sparkle) {
      this.sparkle.position.y = 0.3;
      this.sparkle.rotation.x = Math.PI / 2 + Math.sin(ctx.time * 3) * 0.4;
      this.sparkle.rotation.z += ctx.dt * 4;
    }
  }
}

class PuddleView implements View {
  object: THREE.Mesh;
  constructor(e: Entity) {
    const p = e as Extract<Entity, { kind: 'puddle' }>;
    const color = new THREE.Color(TEAM_COLORS[p.team] ?? 0x8a6a4a).multiplyScalar(0.8);
    const geo = new THREE.SphereGeometry(0.34, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
    geo.scale(1, 0.18, 0.85);
    this.object = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.05 }));
    this.object.position.copy(tilePos(p.x, p.y, 0.005));
    this.object.receiveShadow = true;
  }
  update(e: Entity, ctx: FrameCtx): void {
    const p = e as Extract<Entity, { kind: 'puddle' }>;
    const k = p.sucking >= 0 ? Math.max(0.05, 1 - (ctx.tick - p.sucking) / 66) : 1;
    this.object.scale.set(k, 1 + Math.sin(ctx.time * 3 + p.id) * 0.1, k);
  }
}

class ProjectileView implements View {
  object = new THREE.Group();
  private mesh: THREE.Object3D;
  constructor(e: Entity) {
    const p = e as Extract<Entity, { kind: 'projectile' }>;
    const item =
      p.type === 'NERFGUN' ? 'SQUEAKTOY' : p.type === 'GUNHAT' ? 'TIMEBOMB' : p.type === 'WELDER' ? '' : p.type;
    if (p.type === 'WELDER') {
      this.mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.14, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xff7a1a }),
      );
    } else if (p.type === 'WINGZ') {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.6, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xe8eef8, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
      );
      cone.rotation.x = Math.PI;
      this.mesh = cone;
    } else {
      this.mesh = buildItem(item);
      this.mesh.scale.setScalar(0.8);
    }
    this.object.add(this.mesh);
  }
  update(e: Entity, ctx: FrameCtx): void {
    const p = e as Extract<Entity, { kind: 'projectile' }>;
    if (p.state === 'impact') {
      this.object.visible = false;
      return;
    }
    const pos = projectilePosition(p, ctx.tick);
    const t = THREE.MathUtils.clamp((ctx.tick - p.start) / Math.max(1, p.end - p.start), 0, 1);
    const lobbed = p.type === 'ROCK' || p.type === 'GUNHAT' || p.type === 'NERFGUN';
    const h = lobbed ? 0.5 + Math.sin(t * Math.PI) * 1.4 : 0.45;
    this.object.position.copy(tilePos(pos.x, pos.y, h));
    this.mesh.rotation.y += ctx.dt * (p.type === 'BOOMERANG' || p.type === 'WINGZ' ? 18 : 4);
    this.mesh.rotation.x += ctx.dt * 3;
  }
}

class TimeBombView implements View {
  object = new THREE.Group();
  private light: THREE.Mesh;
  constructor(e: Entity) {
    const b = e as Extract<Entity, { kind: 'timebomb' }>;
    const bomb = buildItem('TIMEBOMB');
    bomb.position.y = 0.12;
    bomb.scale.setScalar(1.4);
    this.object.add(bomb);
    this.light = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
    this.light.position.set(0, 0.32, 0);
    this.object.add(this.light);
    this.object.position.copy(tilePos(b.x, b.y));
  }
  update(e: Entity, ctx: FrameCtx): void {
    const b = e as Extract<Entity, { kind: 'timebomb' }>;
    const fast = ctx.tick >= b.fastAt;
    const period = fast ? 3 : 10;
    this.light.visible = Math.floor(ctx.tick / (period / 2)) % 2 === 0;
    const s = fast ? 1 + Math.sin(ctx.time * 30) * 0.06 : 1;
    this.object.scale.setScalar(s);
  }
}

class BrickzView implements View {
  object = new THREE.Group();
  private key = '';
  constructor(e: Entity) {
    this.object.position.copy(tilePos(e.x, e.y));
  }
  update(e: Entity): void {
    const b = e as Extract<Entity, { kind: 'brickz' }>;
    const key = b.layers.join(',');
    if (key === this.key) return;
    this.key = key;
    this.object.clear();
    b.layers.forEach((color, i) => {
      const brick = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.3, 0.88), mat(BRICK_COLORS[color] ?? 0x9a5a36, 0.8));
      brick.position.y = 0.09 + 0.15 + i * 0.31;
      brick.castShadow = true;
      brick.receiveShadow = true;
      this.object.add(brick);
    });
  }
}

/** A golf ball for the miniature world: white clay with a ring of dimples. */
function golfBall(): THREE.Object3D {
  const group = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 3), mat(0xfbfbf6, 0.45));
  ball.position.y = 0.42;
  ball.castShadow = true;
  group.add(ball);
  const dimple = new THREE.SphereGeometry(0.05, 8, 6);
  const dark = mat(0xdadad2, 0.6);
  for (let i = 0; i < 26; i++) {
    // Spread dimples evenly over the ball (golden spiral).
    const y = 1 - (i / 25) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996;
    const d = new THREE.Mesh(dimple, dark);
    d.position.set(Math.cos(a) * r * 0.32, 0.42 + y * 0.32, Math.sin(a) * r * 0.32);
    d.scale.set(1, 1, 0.4);
    d.lookAt(new THREE.Vector3(0, 0.42, 0));
    group.add(d);
  }
  return group;
}

class GiantRockView implements View {
  object = new THREE.Group();
  constructor(e: Entity, theme: ThemeId) {
    const model = createProp('giantRock', undefined, themeRock(theme));
    if (model) this.object.add(model);
    else {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2, 0), mat(themeRock(theme), 0.9));
      m.scale.set(1.2, 0.8, 1.2);
      m.position.y = 0.7;
      m.castShadow = true;
      this.object.add(m);
    }
    // Every giant rock looks a bit different.
    this.object.rotation.y = ((e.x * 7 + e.y * 13) % 4) * (Math.PI / 2);
  }
  update(e: Entity): void {
    this.object.position.copy(tilePos(e.x, e.y, 0));
  }
}

class BallView implements View {
  object = new THREE.Group();
  private ball: THREE.Mesh;
  private roll = 0;
  constructor(theme: ThemeId) {
    // Rolling "boulderz of doom" in the rocky worlds, 8-ballz elsewhere.
    const boulder = theme === 'rocky' || theme === 'training' || theme === 'ice' || theme === 'tropics';
    const model = boulder
      ? createProp('boulder', undefined, themeRock(theme))
      : theme === 'minis'
        ? golfBall()
        : createProp('ball');
    if (model) {
      // Re-centre the ball so it can spin around its middle.
      model.position.y = -0.42;
      this.ball = new THREE.Group() as unknown as THREE.Mesh;
      this.ball.add(model);
    } else {
      this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 18), mat(0x18181c, 0.25, 0.1));
      this.ball.castShadow = true;
      const spot = new THREE.Mesh(new THREE.CircleGeometry(0.16, 20), mat(0xf4f4f0, 0.3));
      spot.position.z = 0.421;
      this.ball.add(spot);
    }
    this.object.add(this.ball);
  }
  update(e: Entity, ctx: FrameCtx): void {
    const b = e as Extract<Entity, { kind: 'ball' }>;
    const t = THREE.MathUtils.clamp((ctx.tick - b.start) / Math.max(1, b.rate), 0, 1);
    const x = b.fromX + (b.x - b.fromX) * t;
    const y = b.fromY + (b.y - b.fromY) * t;
    const fall = b.state === 'fall' ? -t * 2 : 0;
    this.object.position.copy(tilePos(x, y, 0.42 + fall));
    this.object.rotation.y = facingAngle(b.dir);
    this.roll += ctx.dt * (b.state === 'roll' ? 12 / Math.max(1, b.rate) : 0) * 20;
    this.ball.rotation.x = this.roll;
    this.object.visible = b.state !== 'break' || Math.floor(ctx.time * 20) % 2 === 0;
  }
}

class FortView implements View {
  object = new THREE.Group();
  private flag!: THREE.Mesh;
  private model: THREE.Object3D | null;
  constructor(e: Entity) {
    const f = e as Extract<Entity, { kind: 'fort' }>;
    const color = TEAM_COLORS[f.team] ?? 0xaaaaaa;
    this.model = createProp('fort', color);
    if (this.model) {
      this.object.add(this.model);
      this.object.position.copy(tilePos(f.x, f.y));
      return;
    }
    const stone = mat(0xb8a890, 0.9);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 0.7, 8), stone);
    base.position.y = 0.35;
    base.castShadow = true;
    base.receiveShadow = true;
    this.object.add(base);
    for (let i = 0; i < 8; i++) {
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.18), stone);
      const a = (i / 8) * Math.PI * 2;
      merlon.position.set(Math.cos(a) * 0.68, 0.78, Math.sin(a) * 0.68);
      merlon.castShadow = true;
      this.object.add(merlon);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.6, 8), mat(color, 0.7));
    roof.position.y = 1.1;
    roof.castShadow = true;
    this.object.add(roof);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7), mat(0x5a3a20));
    pole.position.y = 1.7;
    this.object.add(pole);
    this.flag = new THREE.Mesh(
      new THREE.PlaneGeometry(0.4, 0.25),
      new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide }),
    );
    this.flag.position.set(0.2, 1.9, 0);
    this.object.add(this.flag);
    this.object.position.copy(tilePos(f.x, f.y));
  }
  update(e: Entity, ctx: FrameCtx): void {
    const f = e as Extract<Entity, { kind: 'fort' }>;
    if (this.model) {
      // A captured fort sinks a little and loses its colour.
      const goal = f.captured ? -0.25 : 0;
      this.model.position.y += (goal - this.model.position.y) * (1 - Math.exp(-ctx.dt * 2));
      return;
    }
    this.flag.rotation.y = Math.sin(ctx.time * 3) * 0.3;
    this.flag.visible = !f.captured;
  }
}

class PadView implements View {
  object: THREE.Object3D;
  private materials: THREE.MeshStandardMaterial[] = [];
  private team = -1;
  constructor(private e: Entity) {
    this.object = new THREE.Group();
    this.object.position.copy(tilePos(e.x, e.y));
  }
  private build(team: number): void {
    this.object.clear();
    this.materials = [];
    const color = TEAM_COLORS[team] ?? 0xaaaaaa;
    const model = createProp('pad', color);
    if (model) {
      this.object.add(model);
      model.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats)
            if (m.name.startsWith('TeamColor')) this.materials.push(m as THREE.MeshStandardMaterial);
        }
      });
    } else {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.4 });
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.45, 0.06, 6), m);
      mesh.position.y = 0.03;
      this.object.add(mesh);
      this.materials.push(m);
    }
    this.team = team;
  }
  update(e: Entity, ctx: FrameCtx): void {
    const p = e as Extract<Entity, { kind: 'pad' }>;
    if (p.team !== this.team) this.build(p.team);
    const flash = p.team === ctx.viewer && ctx.padsFlashing ? (Math.sin(ctx.time * 8) + 1) / 2 : 0;
    for (const m of this.materials) m.emissive.setRGB(flash * 0.6, flash * 0.6, flash * 0.3);
  }
}

class WormholeView implements View {
  object = new THREE.Group();
  private ring: THREE.Mesh;
  constructor(e: Entity) {
    const w = e as Extract<Entity, { kind: 'wormhole' }>;
    const color = w.color === 'green' ? 0x3af25a : w.color === 'blue' ? 0x3a8af2 : 0xf23a3a;
    const model = createProp('wormhole');
    if (model) {
      model.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const tint = (m: THREE.Material) => {
          if (!m.name.startsWith('WormSwirl')) return m;
          const c = (m as THREE.MeshStandardMaterial).clone();
          c.color.setHex(color);
          c.emissive.setHex(color);
          c.emissiveIntensity = 1.2;
          return c;
        };
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(tint) : tint(mesh.material);
      });
      this.object.add(model);
    }
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.03, 8, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.08;
    this.object.add(this.ring);
    this.object.position.copy(tilePos(w.x, w.y));
  }
  update(e: Entity, ctx: FrameCtx): void {
    const w = e as Extract<Entity, { kind: 'wormhole' }>;
    this.object.visible = w.open;
    this.ring.rotation.z += ctx.dt * 4;
    this.ring.scale.setScalar(1 + Math.sin(ctx.time * 5) * 0.08);
  }
}

class FlagView implements View {
  object = new THREE.Group();
  private cloth: THREE.Mesh;
  constructor(e: Entity) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.2), mat(0xd0d0d8, 0.4, 0.6));
    pole.position.y = 0.6;
    this.object.add(pole);
    const tex = checkerTexture();
    this.cloth = new THREE.Mesh(
      new THREE.PlaneGeometry(0.45, 0.3),
      new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide }),
    );
    this.cloth.position.set(0.23, 0.3, 0);
    this.object.add(this.cloth);
    this.object.position.copy(tilePos(e.x, e.y));
  }
  update(e: Entity, ctx: FrameCtx): void {
    const f = e as Extract<Entity, { kind: 'flag' }>;
    const goal = f.raised ? 1.0 : 0.25;
    this.cloth.position.y += (goal - this.cloth.position.y) * (1 - Math.exp(-ctx.dt * 3));
    this.cloth.rotation.y = Math.sin(ctx.time * 3) * 0.25;
  }
}

class HelpBookView implements View {
  object = new THREE.Group();
  private book: THREE.Group;
  constructor(e: Entity) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 0.35, 8), mat(0x8f5f36));
    post.position.y = 0.17;
    post.castShadow = true;
    this.object.add(post);
    this.book = new THREE.Group();
    for (const side of [-1, 1]) {
      const page = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.02, 0.22), mat(0xf6ead2, 0.7));
      page.position.x = side * 0.08;
      page.rotation.z = side * -0.25;
      page.castShadow = true;
      this.book.add(page);
    }
    const cover = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.015, 0.24), mat(0x8a2a1e));
    cover.position.y = -0.02;
    this.book.add(cover);
    this.book.position.y = 0.4;
    this.object.add(this.book);
    this.object.position.copy(tilePos(e.x, e.y));
  }
  update(_e: Entity, ctx: FrameCtx): void {
    this.book.position.y = 0.42 + Math.sin(ctx.time * 2) * 0.03;
    this.book.rotation.y += ctx.dt * 0.6;
  }
}

let checker: THREE.Texture | null = null;
function checkerTexture(): THREE.Texture {
  if (checker) return checker;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      g.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  checker = new THREE.CanvasTexture(c);
  checker.magFilter = THREE.NearestFilter;
  return checker;
}

// --- layer ------------------------------------------------------------------------------

/** Views laid out in world coordinates (their parts move independently): not lifted as a whole. */
const FREE_VIEWS = new Set(['dropper', 'ufo', 'spotlight']);

export class EntityLayer {
  readonly group = new THREE.Group();
  /** holder: lifts the view to the ground height under it (high ground, stairz). */
  private views = new Map<EntityId, { kind: string; view: View; holder: THREE.Group }>();
  /** Point lights shared by the glowing hazardz. */
  private lights = new LightPool();

  constructor(private camera: () => THREE.Camera) {
    this.group.name = 'entities';
    this.group.add(this.lights.group);
  }

  private create(e: Entity, theme: ThemeId): View | null {
    switch (e.kind) {
      case 'grunt':
        return new GruntView(e, this.camera);
      case 'pickup':
        return new PickupView(e);
      case 'puddle':
        return new PuddleView(e);
      case 'projectile':
        return new ProjectileView(e);
      case 'timebomb':
        return new TimeBombView(e);
      case 'brickz':
        return new BrickzView(e);
      case 'ball':
        return new BallView(theme);
      case 'giantrock':
        return new GiantRockView(e, theme);
      case 'fort':
        return new FortView(e);
      case 'pad':
        return new PadView(e);
      case 'wormhole':
        return new WormholeView(e);
      case 'flag':
        return new FlagView(e);
      case 'help':
        return new HelpBookView(e);
      default:
        return createHazardView(e, theme);
    }
  }

  /** `focus`: what the camera looks at (world x/z): the shared lights go to glows around it. */
  sync(ctx: FrameCtx, focus?: { x: number; z: number }): void {
    const w = ctx.world;
    const frame = { ...ctx, lights: this.lights };
    for (const [id, entry] of this.views) {
      const e = w.entities.get(id);
      if (!e || e.kind !== entry.kind) {
        entry.holder.removeFromParent();
        entry.view.dispose?.();
        this.views.delete(id);
      }
    }
    const lifted = w.maxLevel > 0;
    for (const e of w.entities.values()) {
      let entry = this.views.get(e.id);
      if (!entry) {
        const view = this.create(e, w.theme);
        if (!view) continue;
        const holder = new THREE.Group();
        holder.add(view.object);
        entry = { kind: e.kind, view, holder };
        this.views.set(e.id, entry);
        this.group.add(holder);
      }
      entry.view.update(e, frame);
      // (flyers place their own ground parts)
      if (lifted && !FREE_VIEWS.has(e.kind)) {
        const p = entry.view.object.position;
        entry.holder.position.y = groundY(w, p.x, p.z);
      }
    }
    this.lights.flush(focus ?? { x: w.width / 2, z: w.height / 2 });
  }

  /** Screen-space picking of gruntz: nearest grunt whose body is under the cursor. */
  pickGrunt(
    ndc: THREE.Vector2,
    camera: THREE.Camera,
    width: number,
    height: number,
    filter?: (g: Grunt) => boolean,
    world?: World,
  ): Grunt | null {
    let best: Grunt | null = null;
    let bestD = 34;
    for (const [id, entry] of this.views) {
      if (entry.kind !== 'grunt' || !world) continue;
      const g = world.get(id, 'grunt');
      if (!g || g.action.kind === 'death' || (filter && !filter(g))) continue;
      entry.view.object.getWorldPosition(tmpV);
      tmpV.y += 0.4;
      tmpV.project(camera);
      const dx = ((tmpV.x - ndc.x) * width) / 2;
      const dy = ((tmpV.y - ndc.y) * height) / 2;
      const d = Math.hypot(dx, dy * 0.8);
      if (d < bestD) {
        best = g;
        bestD = d;
      }
    }
    return best;
  }

  /** Grunt ids whose screen position falls in a rectangle (NDC). */
  gruntsInRect(
    min: THREE.Vector2,
    max: THREE.Vector2,
    camera: THREE.Camera,
    world: World,
    filter: (g: Grunt) => boolean,
  ): Grunt[] {
    const out: Grunt[] = [];
    for (const [id, entry] of this.views) {
      if (entry.kind !== 'grunt') continue;
      const g = world.get(id, 'grunt');
      if (!g || !filter(g)) continue;
      entry.view.object.getWorldPosition(tmpV);
      tmpV.y += 0.35;
      tmpV.project(camera);
      if (tmpV.x >= min.x && tmpV.x <= max.x && tmpV.y >= min.y && tmpV.y <= max.y) out.push(g);
    }
    return out;
  }

  objectOf(id: EntityId): THREE.Object3D | undefined {
    return this.views.get(id)?.view.object;
  }

  dispose(): void {
    for (const { view, holder } of this.views.values()) {
      holder.removeFromParent();
      view.dispose?.();
    }
    this.views.clear();
  }
}
