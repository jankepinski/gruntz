import * as THREE from 'three';
import { tileDef, type ThemeId, type TileVisual, type World } from '@gruntz/core';
import { createTileKit, type TileKit, type PieceKey } from './tileKit.ts';
import type { TerrainOptions } from './graphics.ts';

/** Tiles of decorative high ground around the playable map. */
const PAD = 14;
/** Terrain batches are split into square chunks of this many tiles for culling. */
const CHUNK = 20;

/** One instanced mesh holding every copy of a terrain piece. Slots are recycled. */
class PieceBatch {
  mesh: THREE.InstancedMesh;
  private free: number[] = [];
  private used = 0;

  /** Removed slots are parked (scaled to nothing) at the chunk's centre so they don't blow up its bounds. */
  private hidden: THREE.Matrix4;

  constructor(
    private geometry: THREE.BufferGeometry,
    private material: THREE.Material,
    private capacity: number,
    private parent: THREE.Object3D,
    private castShadow: boolean,
    private receiveShadow: boolean,
    centre: THREE.Vector3,
  ) {
    this.hidden = new THREE.Matrix4().makeTranslation(centre.x, centre.y, centre.z).scale(new THREE.Vector3(0, 0, 0));
    this.mesh = this.create(capacity);
  }

  private create(capacity: number): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = this.receiveShadow;
    // Each batch holds one chunk of the map, so off-screen chunks are skipped (also for shadows).
    mesh.frustumCulled = true;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.parent.add(mesh);
    return mesh;
  }

  add(matrix: THREE.Matrix4, color?: THREE.Color): number {
    let slot = this.free.pop();
    if (slot === undefined) {
      if (this.used >= this.capacity) this.grow();
      slot = this.used++;
      this.mesh.count = this.used;
    }
    this.mesh.setMatrixAt(slot, matrix);
    if (color) this.mesh.setColorAt(slot, color);
    else if (this.mesh.instanceColor) this.mesh.setColorAt(slot, new THREE.Color(1, 1, 1));
    this.mesh.instanceMatrix.needsUpdate = true;
    // Picking raycasts these meshes; their bounds must follow the instances.
    this.mesh.boundingSphere = null;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    return slot;
  }

  set(slot: number, matrix: THREE.Matrix4): void {
    this.mesh.setMatrixAt(slot, matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.boundingSphere = null;
  }

  remove(slot: number): void {
    this.mesh.setMatrixAt(slot, this.hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.boundingSphere = null;
    this.free.push(slot);
  }

  private grow(): void {
    const old = this.mesh;
    const capacity = Math.max(16, this.capacity * 2);
    const mesh = this.create(capacity);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let i = 0; i < this.used; i++) {
      old.getMatrixAt(i, m);
      mesh.setMatrixAt(i, m);
      if (old.instanceColor) {
        old.getColorAt(i, c);
        mesh.setColorAt(i, c);
      }
    }
    mesh.count = this.used;
    this.parent.remove(old);
    old.dispose();
    this.mesh = mesh;
    this.capacity = capacity;
  }

  dispose(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }
}

interface PlacedPiece {
  key: PieceKey;
  /** One instance slot per part (material) of the piece. */
  slots: { batch: string; slot: number }[];
  base: THREE.Matrix4;
  /** Animatable pieces (pyramids, bridges): current level 0..1. */
  lift?: number;
}

interface TileAnim {
  index: number;
  start: number;
  duration: number;
  from: number;
  to: number;
}

/**
 * Terrain made of pieces from a tile kit. Each tile turns into a few instanced pieces
 * chosen from the tile's visual and its neighbours (autotiling of cliffs and shores).
 */
export class TerrainView {
  readonly group = new THREE.Group();
  private batches = new Map<PieceKey, PieceBatch>();
  private placed: PlacedPiece[][] = [];
  /** Dual-grid cells (one per tile corner, including the margin around the map). */
  private cells = new Map<number, PlacedPiece[]>();
  private anims: TileAnim[] = [];
  private kit: TileKit;
  private width = 0;
  private height = 0;
  private tiles: number[] = [];
  private time = 0;
  private liquidMask: THREE.DataTexture | null = null;
  /** Tiles covered by map objects: they get no grass or clutter. */
  private bare = new Set<number>();

  constructor(theme: ThemeId, options?: TerrainOptions) {
    this.kit = createTileKit(theme, options);
    this.group.name = 'terrain';
  }

  build(w: World): void {
    this.width = w.width;
    this.height = w.height;
    this.tiles = w.tiles.slice();
    this.placed = new Array(w.width * w.height).fill(null).map(() => []);
    this.bare.clear();
    for (const e of w.entities.values()) {
      const r = e.kind === 'fort' || e.kind === 'giantrock' ? 1 : 0;
      if (!['hazard', 'fort', 'pad', 'wormhole', 'flag', 'help', 'giantrock', 'brickz'].includes(e.kind)) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) this.bare.add((e.y + dy) * w.width + (e.x + dx));
    }
    for (let y = 0; y < w.height; y++) for (let x = 0; x < w.width; x++) this.placeTile(x, y);
    for (let cy = -PAD; cy <= this.height + PAD; cy++)
      for (let cx = -PAD; cx <= this.width + PAD; cx++) this.placeCell(cx, cy);
    this.buildSurroundings();
    this.buildLiquidMask();
    this.group.add(this.kit.backdrop(w.width, w.height));
  }

  /** Which way the chasms run (principal axis of the chasm tiles): lava flows along it. */
  private flowDirection(): THREE.Vector2 {
    let n = 0;
    let mx = 0;
    let my = 0;
    const pts: [number, number][] = [];
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        const v = this.visual(x, y);
        if (v && (v.kind === 'death' || (v.kind === 'bridge' && v.over === 'death'))) {
          pts.push([x, y]);
          mx += x;
          my += y;
          n++;
        }
      }
    if (n < 2) return new THREE.Vector2(0, 1);
    mx /= n;
    my /= n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const [x, y] of pts) {
      sxx += (x - mx) ** 2;
      syy += (y - my) ** 2;
      sxy += (x - mx) * (y - my);
    }
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return new THREE.Vector2(Math.cos(angle), Math.sin(angle));
  }

  /**
   * Soft mask of water (R) and chasms (G) at 4 texels per tile, blurred so the liquid
   * shaders know how far a point is from the shore.
   */
  private buildLiquidMask(): void {
    const R = 4;
    const w = this.width * R;
    const h = this.height * R;
    const water = new Float32Array(w * h);
    const chasm = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = this.visual(Math.floor(x / R), Math.floor(y / R));
        if (!v) continue;
        const over = v.kind === 'bridge' ? v.over : null;
        if (v.kind === 'water' || over === 'water') water[y * w + x] = 1;
        if (v.kind === 'death' || over === 'death') chasm[y * w + x] = 1;
      }
    const blur = (src: Float32Array, radius: number) => {
      const tmp = new Float32Array(w * h);
      const n = radius * 2 + 1;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) sum += src[y * w + Math.min(w - 1, Math.max(0, x + k))]!;
          tmp[y * w + x] = sum / n;
        }
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) sum += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x]!;
          src[y * w + x] = sum / n;
        }
    };
    for (let pass = 0; pass < 2; pass++) {
      blur(water, 3);
      blur(chasm, 3);
    }
    const data = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = Math.round(water[i]! * 255);
      data[i * 4 + 1] = Math.round(chasm[i]! * 255);
      data[i * 4 + 3] = 255;
    }
    this.liquidMask?.dispose();
    const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.liquidMask = tex;
    this.kit.setLiquidMask(tex, this.width, this.height, this.flowDirection());
  }

  /** Trees and bushes on the high ground around the playable map. */
  private buildSurroundings(): void {
    for (let y = -PAD; y < this.height + PAD; y++) {
      for (let x = -PAD; x < this.width + PAD; x++) {
        if (x >= 0 && y >= 0 && x < this.width && y < this.height) continue;
        // Full detail near the map, thinning out towards the horizon.
        const gap = Math.max(-x - 1, x - this.width, -y - 1, y - this.height, 0);
        const detail = gap < 4 ? 1 : gap < 8 ? 0.45 : 0;
        for (const p of this.kit.surroundingPieces(x, y, (dx, dy) => this.visual(x + dx, y + dy), detail))
          for (const batch of this.batchKeys(p.key, p.matrix)) this.batches.get(batch)!.add(p.matrix, p.color);
      }
    }
  }

  private cellIndex(cx: number, cy: number): number {
    return (cy + PAD) * (this.width + 2 * PAD + 1) + (cx + PAD);
  }

  /** (Re)build the dual-grid cell on tile corner (cx, cy): its four tiles are NE, NW, SW, SE of it. */
  private placeCell(cx: number, cy: number): void {
    const i = this.cellIndex(cx, cy);
    for (const p of this.cells.get(i) ?? []) for (const s of p.slots) this.batches.get(s.batch)!.remove(s.slot);
    const corners = [
      this.visual(cx, cy - 1),
      this.visual(cx - 1, cy - 1),
      this.visual(cx - 1, cy),
      this.visual(cx, cy),
    ];
    const placed: PlacedPiece[] = [];
    for (const p of this.kit.cellPieces(cx, cy, corners)) {
      const slots = this.batchKeys(p.key, p.matrix).map(batch => ({
        batch,
        slot: this.batches.get(batch)!.add(p.matrix, p.color),
      }));
      placed.push({ key: p.key, slots, base: p.matrix.clone() });
    }
    this.cells.set(i, placed);
  }

  /** Batches for the parts of a piece placed at a given spot (one batch per piece part and map chunk). */
  private batchKeys(key: PieceKey, matrix: THREE.Matrix4): string[] {
    const parts = this.kit.parts(key);
    const cx = Math.floor(matrix.elements[12]! / CHUNK);
    const cz = Math.floor(matrix.elements[14]! / CHUNK);
    return parts.map((part, i) => {
      const id = `${key}#${i}@${cx},${cz}`;
      if (!this.batches.has(id)) {
        const centre = new THREE.Vector3((cx + 0.5) * CHUNK, 0, (cz + 0.5) * CHUNK);
        this.batches.set(
          id,
          new PieceBatch(part.geometry, part.material, 16, this.group, part.castShadow, part.receiveShadow, centre),
        );
      }
      return id;
    });
  }

  private visual(x: number, y: number): TileVisual | undefined {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return undefined;
    return tileDef(this.tiles[y * this.width + x]!).visual;
  }

  private placeTile(x: number, y: number): void {
    const i = y * this.width + x;
    for (const p of this.placed[i]!) for (const s of p.slots) this.batches.get(s.batch)!.remove(s.slot);
    const pieces = this.kit.tilePieces(
      x,
      y,
      this.visual(x, y)!,
      (dx, dy) => this.visual(x + dx, y + dy),
      this.bare.has(i),
    );
    const placed: PlacedPiece[] = [];
    const m = new THREE.Matrix4();
    for (const p of pieces) {
      const matrix = p.lift !== undefined ? m.copy(p.matrix).multiply(this.kit.liftTransform(p.key, p.lift)) : p.matrix;
      const slots = this.batchKeys(p.key, p.matrix).map(batch => ({
        batch,
        slot: this.batches.get(batch)!.add(matrix, p.color),
      }));
      const entry: PlacedPiece = { key: p.key, slots, base: p.matrix.clone() };
      if (p.lift !== undefined) entry.lift = p.lift;
      placed.push(entry);
    }
    this.placed[i] = placed;
  }

  /** Tiles changed (rock broken, pyramid raised...). Rebuilds them and their neighbours. */
  updateTiles(changes: [number, number][]): void {
    const dirty = new Set<number>();
    const previous = new Map<number, number | undefined>();
    for (const [i, tile] of changes) {
      const before = this.tiles[i];
      previous.set(i, before);
      this.tiles[i] = tile;
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < this.width && ny < this.height) dirty.add(ny * this.width + nx);
        }
      if (before !== undefined) this.animateChange(i, before, tile);
    }
    for (const i of dirty) this.placeTile(i % this.width, Math.floor(i / this.width));
    // Every changed tile touches the four dual-grid cells on its corners.
    const cells = new Set<string>();
    for (const [i] of changes) {
      const x = i % this.width;
      const y = Math.floor(i / this.width);
      for (const [cx, cy] of [
        [x, y],
        [x + 1, y],
        [x, y + 1],
        [x + 1, y + 1],
      ] as const)
        cells.add(`${cx},${cy}`);
    }
    for (const c of cells) {
      const [cx, cy] = c.split(',').map(Number) as [number, number];
      this.placeCell(cx, cy);
    }
    const liquid = (t: number | undefined) => {
      if (t === undefined) return 0;
      const v = tileDef(t).visual;
      const over = v.kind === 'bridge' ? v.over : null;
      return v.kind === 'water' || over === 'water' ? 1 : v.kind === 'death' || over === 'death' ? 2 : 0;
    };
    if (changes.some(([i, t]) => liquid(t) !== liquid(previous.get(i)))) this.buildLiquidMask();
  }

  /** Pyramids and bridges slide instead of popping. */
  private animateChange(i: number, before: number, after: number): void {
    const a = tileDef(before).visual;
    const b = tileDef(after).visual;
    if (a.kind === 'pyramid' && b.kind === 'pyramid') {
      this.anims.push({ index: i, start: this.time, duration: 0.45, from: a.lowered ? 0 : 1, to: b.lowered ? 0 : 1 });
    } else if (a.kind === 'bridge' && b.kind === 'bridge') {
      this.anims.push({ index: i, start: this.time, duration: 0.5, from: a.lowered ? 0 : 1, to: b.lowered ? 0 : 1 });
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.kit.update(this.time);
    if (this.anims.length === 0) return;
    const m = new THREE.Matrix4();
    this.anims = this.anims.filter(anim => {
      const t = Math.min(1, (this.time - anim.start) / anim.duration);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const value = anim.from + (anim.to - anim.from) * e;
      for (const p of this.placed[anim.index]!) {
        if (p.lift === undefined) continue;
        m.copy(p.base).multiply(this.kit.liftTransform(p.key, t >= 1 ? p.lift : value));
        for (const s of p.slots) this.batches.get(s.batch)!.set(s.slot, m);
      }
      return t < 1;
    });
  }

  dispose(): void {
    this.liquidMask?.dispose();
    for (const b of this.batches.values()) b.dispose();
    this.batches.clear();
    this.kit.dispose();
  }
}
