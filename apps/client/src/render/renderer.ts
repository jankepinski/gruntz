import * as THREE from 'three';
import { T, type Point, type World } from '@gruntz/core';
import { CameraRig } from './camera.ts';
import { Effects } from './effects.ts';
import { EntityLayer, type FrameCtx } from './entities.ts';
import { TerrainView } from './terrain.ts';
import { themeLighting, themeSky } from './tileKit.ts';
import { clayRim } from './materials.ts';
import { PostFX, type Quality } from './postfx.ts';

export type HoverMode = 'none' | 'move' | 'attack' | 'tool' | 'toy' | 'invalid' | 'select';

const HOVER_COLORS: Record<HoverMode, number> = {
  none: 0xffffff,
  move: 0xffffff,
  select: 0x9aff8a,
  attack: 0xff5a4a,
  tool: 0xffd84a,
  toy: 0x6ad8ff,
  invalid: 0xff3a3a,
};

export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly rig: CameraRig;
  readonly effects = new Effects();
  terrain: TerrainView | null = null;
  readonly entities: EntityLayer;
  private sun: THREE.DirectionalLight;
  private hemi: THREE.HemisphereLight;
  private envMap: THREE.Texture | null = null;
  private hover: THREE.LineLoop;
  private pathDots: THREE.InstancedMesh;
  private linkLines: THREE.LineSegments;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  width = 1;
  height = 1;
  private post: PostFX;
  private quality: Quality = 'high';

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.rig = new CameraRig(1);
    this.entities = new EntityLayer(() => this.rig.active);

    this.post = new PostFX(this.renderer, this.scene, this.rig.active);

    this.hemi = new THREE.HemisphereLight(0xfff4e0, 0x6a5a48, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera;
    sc.left = -24;
    sc.right = 24;
    sc.top = 24;
    sc.bottom = -24;
    sc.near = 1;
    sc.far = 80;
    this.scene.add(this.sun, this.sun.target);
    // A faint cool light from the opposite side keeps shadowed faces from going flat.
    const fill = new THREE.DirectionalLight(0xbfd8ff, 0.35);
    fill.position.set(20, 12, -14);
    this.scene.add(fill);

    this.scene.add(this.entities.group, this.effects.group);
    this.effects.onShake = a => this.rig.addShake(a);

    const hoverGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.47, 0, -0.47),
      new THREE.Vector3(0.47, 0, -0.47),
      new THREE.Vector3(0.47, 0, 0.47),
      new THREE.Vector3(-0.47, 0, 0.47),
    ]);
    this.hover = new THREE.LineLoop(hoverGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthTest: false }));
    this.hover.renderOrder = 5;
    this.scene.add(this.hover);

    this.pathDots = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.07, 12).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }),
      256,
    );
    this.pathDots.count = 0;
    this.pathDots.renderOrder = 4;
    this.pathDots.frustumCulled = false;
    this.scene.add(this.pathDots);

    this.linkLines = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.2, gapSize: 0.12, depthTest: false, transparent: true }),
    );
    this.linkLines.renderOrder = 6;
    this.scene.add(this.linkLines);
  }

  load(world: World): void {
    this.terrain?.dispose();
    if (this.terrain) this.scene.remove(this.terrain.group);
    this.entities.dispose();
    this.terrain = new TerrainView(world.theme);
    this.terrain.build(world);
    this.scene.add(this.terrain.group);
    const sky = new THREE.Color(themeSky(world.theme));
    this.scene.background = sky;
    this.scene.fog = new THREE.Fog(sky, 70, 140);
    this.applyLighting(world.theme);
    this.rig.bounds.set(new THREE.Vector2(0, 0), new THREE.Vector2(world.width, world.height));
  }

  /**
   * Per world light rig: warm sun, cool sky fill (so shadows turn gently blue) and a soft
   * sky dome as environment map for the ambient light and reflections.
   */
  private applyLighting(theme: World['theme']): void {
    const l = themeLighting(theme);
    this.sun.color.setHex(l.sun);
    this.sun.intensity = l.sunIntensity;
    this.hemi.color.setHex(l.sky);
    this.hemi.groundColor.setHex(l.bounce);
    this.hemi.intensity = l.hemi;
    clayRim.value.setHex(l.rim);
    this.envMap?.dispose();
    this.envMap = skyEnvironment(this.renderer, l.sky, themeSky(theme), l.bounce, l.sun);
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = l.env;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.rig.setAspect(width / height);
    this.post.setQuality(this.quality, width, height);
    this.post.setSize(width, height);
  }

  setQuality(quality: Quality): void {
    this.quality = quality;
    this.renderer.setPixelRatio(quality === 'low' ? 1 : Math.min(window.devicePixelRatio, 2));
    this.post.setQuality(quality, this.width, this.height);
  }

  toNdc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  }

  /**
   * Tile under a screen point. Raycasts the terrain meshes so raised things (cliffs,
   * pyramids, rocks) pick the tile you actually see; falls back to the ground plane.
   */
  pickTile(ndc: THREE.Vector2, world: World): Point | null {
    this.raycaster.setFromCamera(ndc, this.rig.active);
    const hit = new THREE.Vector3();
    if (this.terrain) {
      const hits = this.raycaster.intersectObject(this.terrain.group, true);
      const dir = this.raycaster.ray.direction;
      for (const h of hits) {
        // Step a hair into the surface so a hit on a cliff's side face picks that cliff.
        hit.copy(h.point).addScaledVector(dir, 0.02);
        const x = Math.floor(hit.x);
        const y = Math.floor(hit.z);
        if (world.inBounds(x, y)) return { x, y };
      }
    }
    // Try the cliff-top plane first so clicking a raised tile picks it.
    const top = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.05);
    if (this.raycaster.ray.intersectPlane(top, hit)) {
      const x = Math.floor(hit.x);
      const y = Math.floor(hit.z);
      if (world.inBounds(x, y) && world.has(x, y, T.HILL)) return { x, y };
    }
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    const x = Math.floor(hit.x);
    const y = Math.floor(hit.z);
    return world.inBounds(x, y) ? { x, y } : null;
  }

  setHover(tile: Point | null, mode: HoverMode, world: World | null): void {
    this.hover.visible = !!tile && mode !== 'none';
    if (!tile || !world) return;
    const h = world.has(tile.x, tile.y, T.HILL) ? 1.07 : 0.03;
    this.hover.position.set(tile.x + 0.5, h, tile.y + 0.5);
    (this.hover.material as THREE.LineBasicMaterial).color.setHex(HOVER_COLORS[mode]);
  }

  setPath(points: Point[], dangerous: (p: Point) => boolean): void {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const count = Math.min(points.length, this.pathDots.instanceMatrix.count);
    for (let i = 0; i < count; i++) {
      const p = points[i]!;
      m.makeTranslation(p.x + 0.5, 0.04, p.y + 0.5);
      this.pathDots.setMatrixAt(i, m);
      this.pathDots.setColorAt(i, dangerous(p) ? c.setHex(0xff3a2a) : c.setHex(0xffffff));
    }
    this.pathDots.count = count;
    this.pathDots.instanceMatrix.needsUpdate = true;
    if (this.pathDots.instanceColor) this.pathDots.instanceColor.needsUpdate = true;
  }

  /** Dashed lines from a switch to everything it controls (QoL highlight). */
  setLinks(from: Point | null, targets: Point[]): void {
    if (!from || targets.length === 0) {
      this.linkLines.visible = false;
      return;
    }
    const pts: THREE.Vector3[] = [];
    for (const t of targets) {
      pts.push(new THREE.Vector3(from.x + 0.5, 0.3, from.y + 0.5), new THREE.Vector3(t.x + 0.5, 0.3, t.y + 0.5));
    }
    this.linkLines.geometry.dispose();
    this.linkLines.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.linkLines.computeLineDistances();
    this.linkLines.visible = true;
  }

  render(ctx: FrameCtx): void {
    this.rig.update(ctx.dt);
    // Keep the shadow frustum around what we are looking at.
    const tx = this.rig.target.x;
    const tz = this.rig.target.y;
    const extent = 10 + this.rig.distance * 0.45;
    const sc = this.sun.shadow.camera;
    sc.left = -extent;
    sc.right = extent;
    sc.top = extent;
    sc.bottom = -extent;
    sc.updateProjectionMatrix();
    // Sun from the south-west, fairly low: long soft shadows that show the shapes.
    this.sun.position.set(tx - 16, 21, tz + 12);
    this.sun.target.position.set(tx, 0, tz);
    this.terrain?.update(ctx.dt);
    this.entities.sync(ctx);
    this.effects.update(ctx.dt);
    this.post.setCamera(this.rig.active);
    this.post.render(ctx.dt);
  }

  /** Project a world point to CSS pixels (for HTML overlays). */
  toScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.rig.active);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height, visible: v.z < 1 };
  }

  dispose(): void {
    this.envMap?.dispose();
    this.post.dispose();
    this.terrain?.dispose();
    this.entities.dispose();
    this.renderer.dispose();
  }
}

/** Pre-filtered environment from a simple sky dome: zenith, horizon haze, ground bounce and a sun glow. */
function skyEnvironment(renderer: THREE.WebGLRenderer, zenith: number, horizon: number, ground: number, sun: number): THREE.Texture {
  const scene = new THREE.Scene();
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uZenith: { value: new THREE.Color(zenith) },
      uHorizon: { value: new THREE.Color(horizon).lerp(new THREE.Color(0xffffff), 0.35) },
      uGround: { value: new THREE.Color(ground) },
      uSun: { value: new THREE.Color(sun) },
      uSunDir: { value: new THREE.Vector3(-16, 21, 12).normalize() },
    },
    vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 uZenith, uHorizon, uGround, uSun, uSunDir;
      varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 col = d.y > 0.0 ? mix(uHorizon, uZenith, pow(d.y, 0.6)) : mix(uHorizon, uGround, pow(-d.y, 0.4));
        float s = max(dot(d, uSunDir), 0.0);
        col += uSun * (pow(s, 64.0) * 6.0 + pow(s, 6.0) * 0.4);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), material));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  material.dispose();
  return target.texture;
}
