import * as THREE from 'three';
import { createWorld, type LevelData, type LevelObject, type ThemeId, type World } from '@gruntz/core';
import { EntityLayer, type FrameCtx } from './entities.ts';
import { clayRim } from './materials.ts';
import { models } from './models.ts';
import { TerrainView } from './terrain.ts';
import { themeLighting } from './tileKit.ts';

/**
 * Small 3D renders of tiles and map objects for the level editor's palettes, made with
 * the game's own terrain kit and models (in the chosen world's look), so a rock button
 * shows the actual rock. Rendered one at a time in the background and cached as PNGs.
 */

const SIZE = 160;

interface Job {
  key: string;
  render: (r: Renderer) => void;
}

interface Renderer {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
}

class Thumbnails {
  private r: Renderer | null = null;
  private cache = new Map<string, string>();
  private queued = new Set<string>();
  private jobs: Job[] = [];
  private listeners = new Set<() => void>();
  private running = false;

  /** Rendered tile (by tile name), or undefined while it is still being made. */
  tile(theme: ThemeId, name: string): string | undefined {
    const key = `tile|${theme}|${name}`;
    return this.request(key, r => this.renderTile(r, theme, name));
  }

  /** Rendered map object (level object template), or undefined while it is being made. */
  object(theme: ThemeId, id: string, obj: LevelObject): string | undefined {
    const key = `obj|${theme}|${id}`;
    return this.request(key, r => this.renderObject(r, theme, obj));
  }

  /** Head-and-shoulders portrait of a grunt (team colour or enemy AI colour). */
  portrait(theme: ThemeId, team: number, ai?: string): string | undefined {
    const key = `portrait|${theme}|${team}|${ai ?? ''}`;
    const obj = { type: 'grunt', x: 0, y: 0, team, ...(ai ? { ai } : {}) } as LevelObject;
    return this.request(key, r => this.renderObject(r, theme, obj, true));
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private request(key: string, render: (r: Renderer) => void): string | undefined {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit || undefined;
    if (!this.queued.has(key)) {
      this.queued.add(key);
      this.jobs.push({ key, render });
      void this.pump();
    }
    return undefined;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await models.preload(['grunt', 'terrain', 'items', 'props', 'hazards']);
    const r = (this.r ??= this.createRenderer());
    while (this.jobs.length) {
      const job = this.jobs.shift()!;
      let url = '';
      try {
        job.render(r);
        url = r.gl.domElement.toDataURL('image/png');
      } catch (err) {
        console.warn('thumbnail failed', job.key, err);
      }
      this.cache.set(job.key, url);
      this.queued.delete(job.key);
      // Let the page breathe between renders and show thumbnails as they arrive.
      if (this.jobs.length % 4 === 0) {
        for (const fn of this.listeners) fn();
        await new Promise(res => setTimeout(res, 0));
      }
    }
    for (const fn of this.listeners) fn();
    this.running = false;
  }

  private createRenderer(): Renderer {
    const gl = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    gl.setPixelRatio(1);
    gl.setSize(SIZE, SIZE, false);
    gl.setClearColor(0x000000, 0);
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 0.9);
    const sun = new THREE.DirectionalLight(0xffffff, 2.6);
    scene.add(hemi, sun, sun.target);
    const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
    return { gl, scene, camera, hemi, sun };
  }

  private light(r: Renderer, theme: ThemeId): void {
    const l = themeLighting(theme);
    r.hemi.color.setHex(l.sky);
    r.hemi.groundColor.setHex(l.bounce);
    r.hemi.intensity = 1.1;
    r.sun.color.setHex(l.sun);
    clayRim.value.setHex(l.rim);
  }

  /** A 5x5 patch of plain ground with something in the middle (liquids get a pool around them). */
  private world(theme: ThemeId, centre: string, objects: LevelObject[] = []): World {
    // BRIDGE* tiles span water, DBRIDGE* tiles span the abyss.
    const pool =
      centre.startsWith('WATER') || centre.startsWith('BRIDGE')
        ? 'WATER'
        : centre.startsWith('DEATH') || centre.startsWith('DBRIDGE')
          ? 'DEATH'
          : null;
    const level: LevelData = {
      id: 'thumb',
      name: { en: '', pl: '' },
      mode: 'quest',
      theme,
      legend: { '.': 'GROUND', X: centre, o: pool ?? 'GROUND' },
      tiles: pool ? ['.....', '.ooo.', '.oXo.', '.ooo.', '.....'] : ['.....', '.....', '..X..', '.....', '.....'],
      objects,
    };
    return createWorld(level, { seed: 1, teams: [{ team: 0, name: 'P' }] });
  }

  private shoot(r: Renderer, target: THREE.Vector3, radius: number, elevation = 48, azimuth = -28): void {
    const el = THREE.MathUtils.degToRad(elevation);
    const az = THREE.MathUtils.degToRad(azimuth);
    const dist = radius / Math.tan(THREE.MathUtils.degToRad(r.camera.fov / 2));
    r.camera.position.set(
      target.x + Math.sin(az) * Math.cos(el) * dist,
      target.y + Math.sin(el) * dist,
      target.z + Math.cos(az) * Math.cos(el) * dist,
    );
    r.camera.lookAt(target);
    r.camera.near = dist * 0.1;
    r.camera.far = dist * 10;
    r.camera.updateProjectionMatrix();
    r.sun.position.set(target.x - 4, target.y + 6, target.z + 3);
    r.sun.target.position.copy(target);
    r.gl.render(r.scene, r.camera);
  }

  private renderTile(r: Renderer, theme: ThemeId, name: string): void {
    this.light(r, theme);
    const w = this.world(theme, name);
    const terrain = new TerrainView(theme);
    terrain.build(w);
    terrain.update(1.7);
    r.scene.add(terrain.group);
    const tall = name.startsWith('CLIFF') ? 0.55 : name.startsWith('PYRAMID') && !name.endsWith('_LO') ? 0.45 : 0.15;
    this.shoot(r, new THREE.Vector3(2.5, tall, 2.5), 0.82);
    r.scene.remove(terrain.group);
    terrain.dispose();
  }

  private renderObject(r: Renderer, theme: ThemeId, obj: LevelObject, portrait = false): void {
    this.light(r, theme);
    const placed = { ...obj, x: 2, y: 2 } as LevelObject;
    const w = this.world(theme, 'GROUND', [placed]);
    const terrain = new TerrainView(theme);
    terrain.build(w);
    terrain.update(1.7);
    const layer = new EntityLayer(() => r.camera);
    const ctx: FrameCtx = {
      world: w,
      tick: 0,
      dt: 1 / 30,
      time: 1.3,
      viewer: 0,
      selected: new Set(),
      hovered: null,
      showAllBars: false,
      padsFlashing: false,
    };
    for (let i = 0; i < 3; i++) layer.sync(ctx);
    if (portrait) {
      // Just the grunt against a clear background, framed on its head (from the rig's bones,
      // so bars, rings or a drop-in animation can't throw the framing off).
      r.scene.add(layer.group);
      layer.group.updateMatrixWorld(true);
      const head = layer.group.getObjectByName('head');
      const pelvis = layer.group.getObjectByName('pelvis');
      const target = new THREE.Vector3(2.5, 0.6, 2.5);
      let radius = 0.4;
      if (head && pelvis) {
        const h = head.getWorldPosition(new THREE.Vector3());
        const p = pelvis.getWorldPosition(new THREE.Vector3());
        const d = Math.max(0.05, h.distanceTo(p));
        target.copy(h).addScaledVector(new THREE.Vector3(0, 1, 0), d * 0.55);
        radius = d * 1.25;
      }
      this.shoot(r, target, radius, 10, 0);
      r.scene.remove(layer.group);
      layer.dispose();
      terrain.dispose();
      return;
    }
    r.scene.add(terrain.group, layer.group);
    const box = new THREE.Box3().setFromObject(layer.group);
    const target = new THREE.Vector3(2.5, 0.3, 2.5);
    let radius = 0.9;
    if (!box.isEmpty()) {
      box.getCenter(target);
      const size = box.getSize(new THREE.Vector3());
      radius = Math.max(0.55, Math.max(size.x, size.z) * 0.62, size.y * 0.55);
    }
    this.shoot(r, target, radius);
    r.scene.remove(terrain.group, layer.group);
    layer.dispose();
    terrain.dispose();
  }
}

export const thumbnails = new Thumbnails();
