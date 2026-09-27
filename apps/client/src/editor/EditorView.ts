import * as THREE from 'three';
import { createWorld, T, tileByName, tileId, type LevelData, type Point, type World } from '@gruntz/core';
import { GameRenderer } from '../render/renderer.ts';
import { LEVEL_H, renderLevels, tileY } from '../render/elevation.ts';
import { models } from '../render/models.ts';
import { settings } from '../game/store.ts';
import type { EditorModel } from './model.ts';

const OVERLAY_Y = 0.06;

/**
 * 3D view of the level being edited. The level is rendered with the game renderer (no
 * simulation runs); on top of it sit editor overlays: grid, brush, selection, links and
 * markers for things that are invisible in game (secret triggers, hidden items).
 */
export class EditorView {
  readonly renderer: GameRenderer;
  world: World | null = null;
  private raf = 0;
  private last = performance.now();
  private keys = new Set<string>();
  private disposers: (() => void)[] = [];
  private overlay = new THREE.Group();
  private grid: THREE.LineSegments | null = null;
  private cursor: THREE.LineLoop;
  private selection: THREE.LineLoop;
  private markers = new THREE.Group();
  private issuePins = new THREE.Group();
  private partnerLines: THREE.LineSegments;
  private loading: Promise<void> | null = null;
  /** Renders when requestAnimationFrame is paused (hidden or embedded panes). */
  private fallbackTimer = 0;
  private lastFrameAt = performance.now();
  /** Top level of every tile as drawn (walls stand above what they border). */
  private levels: number[] = [];
  private heightsTimer = 0;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly model: EditorModel,
  ) {
    this.renderer = new GameRenderer(canvas);
    this.renderer.setGraphics(settings.get().graphics);
    const square = () =>
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(1, 0, 1),
        new THREE.Vector3(0, 0, 1),
      ]);
    this.cursor = new THREE.LineLoop(
      square(),
      new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }),
    );
    this.selection = new THREE.LineLoop(
      square(),
      new THREE.LineBasicMaterial({ color: 0xffd84a, depthTest: false, transparent: true }),
    );
    this.partnerLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({
        color: 0xffa040,
        dashSize: 0.2,
        gapSize: 0.12,
        depthTest: false,
        transparent: true,
      }),
    );
    for (const o of [this.cursor, this.selection, this.partnerLines]) o.renderOrder = 7;
    this.overlay.add(this.cursor, this.selection, this.markers, this.issuePins, this.partnerLines);
    this.renderer.scene.add(this.overlay);

    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void) => {
      window.addEventListener(type, fn);
      this.disposers.push(() => window.removeEventListener(type, fn));
    };
    on('keydown', e => {
      if (isTyping(e)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      this.keys.add(e.code);
      if (e.code === 'KeyQ') this.renderer.rig.rotate(-1);
      if (e.code === 'KeyE') this.renderer.rig.rotate(1);
    });
    on('keyup', e => this.keys.delete(e.code));
    on('blur', () => this.keys.clear());
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.renderer.rig.zoomBy(Math.sign(e.deltaY) * 0.06);
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.disposers.push(() => canvas.removeEventListener('wheel', wheel));

    model.onTiles = points => this.updateTiles(points);
    // Heights reshape the whole terrain: rebuild it, at most a few times a second while painting.
    model.onHeights = () => {
      if (this.heightsTimer) return;
      this.heightsTimer = window.setTimeout(() => {
        this.heightsTimer = 0;
        void this.reload();
      }, 120);
    };
    model.onObjects = () => this.rebuildObjects();
    model.onReload = () => void this.reload();
    this.raf = requestAnimationFrame(this.frame);
    this.fallbackTimer = window.setInterval(() => {
      if (performance.now() - this.lastFrameAt > 250) this.frame(performance.now(), true);
    }, 100);
  }

  /** Full rebuild (first load, resize, theme change). */
  async reload(): Promise<void> {
    const run = async () => {
      await models.preload(['grunt', 'terrain', 'items', 'props', 'hazards']);
      const world = this.buildWorld(this.model.level());
      if (!world) return;
      const first = !this.world;
      this.world = world;
      this.levels = renderLevels(world.width, world.height, world.tiles, world.heights);
      this.renderer.load(world);
      // Editing wants the whole map in view: farther zoom, no distance fog.
      this.renderer.rig.maxZoom = 1.4;
      const fog = this.renderer.scene.fog as THREE.Fog | null;
      if (fog) {
        fog.near = 200;
        fog.far = 600;
      }
      // Editing should let the camera reach the map edges.
      this.renderer.rig.bounds.set(new THREE.Vector2(-4, -4), new THREE.Vector2(world.width + 4, world.height + 4));
      this.buildGrid();
      const cam = this.model.camera;
      if (first && cam) {
        this.renderer.rig.jumpTo(cam.x, cam.y);
        this.renderer.rig.setZoom(cam.zoom);
        this.renderer.rig.rotate(cam.rotation);
      } else if (first) {
        this.renderer.rig.jumpTo(world.width / 2, world.height / 2);
        this.renderer.rig.setZoom(0.55);
      }
    };
    // Serialize reloads so a quick undo doesn't race an earlier rebuild.
    this.loading = (this.loading ?? Promise.resolve()).then(run, run);
    return this.loading;
  }

  private buildWorld(level: LevelData): World | null {
    try {
      const teams = [0, 1, 2, 3].map(t => ({ team: t, name: `P${t + 1}` }));
      // Show every team's forts and gruntz regardless of the player count.
      return createWorld({ ...level, players: 4 }, { seed: 1, teams });
    } catch (err) {
      console.warn('editor: level does not build', err);
      return null;
    }
  }

  private rebuildObjects(): void {
    if (!this.world) return;
    const world = this.buildWorld(this.model.level());
    if (!world || world.width !== this.world.width || world.height !== this.world.height) {
      void this.reload();
      return;
    }
    // Objects can change tiles (brickz); keep the terrain in step without a full rebuild.
    const changes: [number, number][] = [];
    for (let i = 0; i < world.tiles.length; i++)
      if (world.tiles[i] !== this.world.tiles[i]) changes.push([i, world.tiles[i]!]);
    this.renderer.entities.dispose();
    this.world = world;
    if (changes.length) this.renderer.terrain?.updateTiles(changes);
  }

  private updateTiles(points: Point[]): void {
    const w = this.world;
    if (!w) return;
    const changes: [number, number][] = [];
    // Objects that own their tiles in game (brickz, giant rockz) keep them in the view.
    const owned = new Map<number, number>();
    for (const o of this.model.doc.objects) {
      if (o.type === 'brickz') owned.set(o.y * w.width + o.x, tileId('BRICKZ'));
      if (o.type === 'giantRock')
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) owned.set((o.y + dy) * w.width + o.x + dx, tileId('GIANT_ROCK'));
    }
    for (const p of points) {
      const name = this.model.tileAt(p.x, p.y);
      if (!name || !w.inBounds(p.x, p.y)) continue;
      const i = w.index(p.x, p.y);
      const id = owned.get(i) ?? tileId(name);
      w.setTileRaw(i, id);
      changes.push([i, id]);
    }
    w.takeChanges();
    if (changes.length) {
      this.levels = renderLevels(w.width, w.height, w.tiles, w.heights);
      this.renderer.terrain?.updateTiles(changes);
    }
  }

  private buildGrid(): void {
    const w = this.world!;
    if (this.grid) {
      this.grid.geometry.dispose();
      this.overlay.remove(this.grid);
    }
    const pts: number[] = [];
    if (w.maxLevel === 0) {
      for (let x = 0; x <= w.width; x++) pts.push(x, OVERLAY_Y - 0.03, 0, x, OVERLAY_Y - 0.03, w.height);
      for (let y = 0; y <= w.height; y++) pts.push(0, OVERLAY_Y - 0.03, y, w.width, OVERLAY_Y - 0.03, y);
    } else {
      // On a map with high ground every tile outlines itself on its own level.
      for (let y = 0; y < w.height; y++)
        for (let x = 0; x < w.width; x++) {
          const h = w.level(x, y) * LEVEL_H + OVERLAY_Y - 0.03;
          pts.push(x, h, y, x + 1, h, y, x, h, y, x, h, y + 1);
          if (x === w.width - 1) pts.push(x + 1, h, y, x + 1, h, y + 1);
          if (y === w.height - 1) pts.push(x, h, y + 1, x + 1, h, y + 1);
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.grid = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    this.grid.renderOrder = 3;
    this.overlay.add(this.grid);
  }

  pick(clientX: number, clientY: number): Point | null {
    if (!this.world) return null;
    return this.renderer.pickTile(this.renderer.toNdc(clientX, clientY), this.world);
  }

  /** Ground point under the mouse even outside the map (for dragging rectangles). */
  pickClamped(clientX: number, clientY: number): Point | null {
    const w = this.world;
    if (!w) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.renderer.toNdc(clientX, clientY), this.renderer.rig.active);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) return null;
    return {
      x: THREE.MathUtils.clamp(Math.floor(hit.x), 0, w.width - 1),
      y: THREE.MathUtils.clamp(Math.floor(hit.z), 0, w.height - 1),
    };
  }

  panPixels(dx: number, dy: number): void {
    const upp = this.renderer.rig.unitsPerPixel(this.renderer.height);
    this.renderer.rig.panBy(-dx * upp, -dy * upp);
  }

  focus(p: Point): void {
    this.renderer.rig.panTo(p.x + 0.5, p.y + 0.5);
  }

  saveCamera(): void {
    const rig = this.renderer.rig;
    this.model.camera = { x: rig.target.x, y: rig.target.y, zoom: rig.zoom, rotation: rig.quarter };
  }

  resize(width: number, height: number): void {
    this.renderer.resize(width, height);
  }

  private heightAt(x: number, y: number): number {
    const w = this.world;
    if (!w || !w.inBounds(x, y)) return OVERLAY_Y;
    const name = this.model.tileAt(x, y);
    // Walls: their top. Everything else: the ground (stairz included).
    if (name && tileByName(name).traits & T.HILL) return (this.levels[w.index(x, y)] ?? 1) * LEVEL_H + 0.04;
    return tileY(w, x, y) + OVERLAY_Y;
  }

  private placeBox(line: THREE.LineLoop, a: Point, b: Point, lift = 0): void {
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x) + 1;
    const y1 = Math.max(a.y, b.y) + 1;
    const h =
      a.x === b.x && a.y === b.y ? this.heightAt(a.x, a.y) : Math.max(this.heightAt(a.x, a.y), this.heightAt(b.x, b.y));
    line.position.set(x0, h + lift, y0);
    line.scale.set(x1 - x0, 1, y1 - y0);
    line.visible = true;
  }

  private updateOverlay(time: number): void {
    const s = this.model.state.get();
    if (this.grid) this.grid.visible = s.showGrid;

    // cursor: brush footprint / rectangle / hovered tile
    if (s.rect) {
      this.placeBox(this.cursor, s.rect.a, s.rect.b);
    } else if (s.hover) {
      const brush = s.tool === 'paint' ? s.brush : 1;
      const pts = this.model.brushPoints(s.hover, brush);
      this.placeBox(this.cursor, pts[0]!, pts[pts.length - 1]!);
    } else {
      this.cursor.visible = false;
    }
    const cursorColor = s.tool === 'link' ? 0x6ad8ff : s.tool === 'object' ? 0x9aff8a : 0xffffff;
    (this.cursor.material as THREE.LineBasicMaterial).color.setHex(cursorColor);
    (this.cursor.material as THREE.LineBasicMaterial).opacity = 0.75 + Math.sin(time * 6) * 0.2;

    // selection + links
    const sel = s.selected === null ? undefined : this.model.doc.objects[s.selected];
    if (sel) {
      const r = sel.type === 'fort' || sel.type === 'giantRock' ? 1 : 0;
      this.placeBox(this.selection, { x: sel.x - r, y: sel.y - r }, { x: sel.x + r, y: sel.y + r }, 0.02);
      const links = this.model.linksOf(s.selected);
      this.renderer.setLinks(links?.from ?? null, links?.targets ?? []);
      this.setPartnerLines(links?.from ?? null, links?.partners ?? []);
    } else {
      this.selection.visible = false;
      this.renderer.setLinks(null, []);
      this.setPartnerLines(null, []);
    }
  }

  private partnerKey = '';
  private setPartnerLines(from: Point | null, partners: Point[]): void {
    const key = from ? `${from.x},${from.y}:${partners.map(p => `${p.x},${p.y}`).join(';')}` : '';
    if (key === this.partnerKey) return;
    this.partnerKey = key;
    this.partnerLines.visible = partners.length > 0;
    if (!from || !partners.length) return;
    const pts: THREE.Vector3[] = [];
    for (const p of partners)
      pts.push(new THREE.Vector3(from.x + 0.5, 0.35, from.y + 0.5), new THREE.Vector3(p.x + 0.5, 0.35, p.y + 0.5));
    this.partnerLines.geometry.dispose();
    this.partnerLines.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.partnerLines.computeLineDistances();
  }

  private markerRevision = -1;
  /** Markers for objects that are invisible in game and for validation problems. */
  private updateMarkers(): void {
    const s = this.model.state.get();
    if (s.revision === this.markerRevision) return;
    this.markerRevision = s.revision;
    for (const g of [this.markers, this.issuePins]) {
      for (const c of g.children.slice()) {
        g.remove(c);
        (c as THREE.Mesh).geometry?.dispose();
      }
    }
    const diamond = new THREE.OctahedronGeometry(0.16, 0);
    const ring = new THREE.RingGeometry(0.3, 0.38, 24).rotateX(-Math.PI / 2);
    this.model.doc.objects.forEach(o => {
      let mesh: THREE.Mesh | null = null;
      if (o.type === 'secret') {
        mesh = new THREE.Mesh(
          diamond.clone(),
          new THREE.MeshBasicMaterial({ color: 0xc070ff, transparent: true, opacity: 0.9, depthTest: false }),
        );
        mesh.position.set(o.x + 0.5, this.heightAt(o.x, o.y) + 0.35, o.y + 0.5);
      } else if (o.type === 'pickup' && o.hidden) {
        mesh = new THREE.Mesh(
          ring.clone(),
          new THREE.MeshBasicMaterial({ color: 0xffe070, transparent: true, opacity: 0.8, depthTest: false }),
        );
        mesh.position.set(o.x + 0.5, this.heightAt(o.x, o.y) + 0.02, o.y + 0.5);
      } else if (o.type === 'grunt' && o.ai) {
        mesh = new THREE.Mesh(
          ring.clone(),
          new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.55, depthTest: false }),
        );
        mesh.position.set(o.x + 0.5, this.heightAt(o.x, o.y) + 0.02, o.y + 0.5);
      }
      if (mesh) {
        mesh.renderOrder = 6;
        this.markers.add(mesh);
      }
    });
    const pin = new THREE.ConeGeometry(0.12, 0.34, 10).rotateX(Math.PI);
    for (const issue of s.issues) {
      if (issue.x === undefined || issue.y === undefined || issue.y < 0) continue;
      const mesh = new THREE.Mesh(
        pin.clone(),
        new THREE.MeshBasicMaterial({ color: issue.severity === 'error' ? 0xff3a3a : 0xffb030, depthTest: false }),
      );
      mesh.position.set(issue.x + 0.5, this.heightAt(issue.x, issue.y) + 0.9, issue.y + 0.5);
      mesh.renderOrder = 8;
      this.issuePins.add(mesh);
    }
    diamond.dispose();
    ring.dispose();
    pin.dispose();
  }

  private frame = (now: number, fallback = false): void => {
    if (!fallback) this.raf = requestAnimationFrame(this.frame);
    this.lastFrameAt = now;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const w = this.world;
    if (!w) return;
    const rig = this.renderer.rig;
    const speed = (10 + rig.distance * 0.45) * dt;
    let dx = 0;
    let dy = 0;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) dy += 1;
    if (dx || dy) rig.panBy(dx * speed, dy * speed);
    const time = now / 1000;
    for (const m of this.issuePins.children) m.position.y += Math.sin(time * 4 + m.position.x) * 0.002;
    this.updateMarkers();
    this.updateOverlay(time);
    this.renderer.render({
      world: w,
      tick: 0,
      dt,
      time,
      viewer: 0,
      selected: new Set(),
      hovered: null,
      showAllBars: false,
      padsFlashing: false,
    });
  };

  dispose(): void {
    this.saveCamera();
    cancelAnimationFrame(this.raf);
    clearInterval(this.fallbackTimer);
    for (const d of this.disposers) d();
    this.model.onTiles = null;
    this.model.onHeights = null;
    window.clearTimeout(this.heightsTimer);
    this.model.onObjects = null;
    this.model.onReload = null;
    this.renderer.dispose();
  }
}

export function isTyping(e: Event): boolean {
  const el = e.target as HTMLElement | null;
  return (
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
}
