import * as THREE from 'three';

const DEG = Math.PI / 180;

/**
 * RTS camera. Default framing matches the original (top-down with a slight tilt,
 * north up). Zooming in lowers the camera angle for a more cinematic look, zooming out
 * raises it towards a planning view. The view can be rotated in 90° steps.
 */
export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  readonly ortho: THREE.OrthographicCamera;
  /** Ground point the camera looks at (world units, x/z). */
  target = new THREE.Vector2(10, 10);
  private targetGoal = new THREE.Vector2(10, 10);
  /** 0 = closest, 1 = farthest. */
  zoom = 0.4;
  private zoomGoal = 0.4;
  /** Rotation in quarter turns (0 = north up). */
  quarter = 0;
  private yaw = 0;
  classic = false;
  /** Farthest zoom allowed (multiplayer keeps it equal for everybody). */
  maxZoom = 1;
  bounds = new THREE.Box2(new THREE.Vector2(0, 0), new THREE.Vector2(32, 32));
  private shake = 0;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(24, aspect, 0.5, 400);
    this.ortho = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.5, 400);
  }

  get active(): THREE.Camera {
    return this.classic ? this.ortho : this.camera;
  }

  get pitch(): number {
    if (this.classic) return 72 * DEG;
    return (50 + 24 * this.zoom) * DEG;
  }

  get distance(): number {
    return 16 + 70 * Math.pow(this.zoom, 1.3);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  jumpTo(x: number, z: number): void {
    this.targetGoal.set(x, z);
    this.target.set(x, z);
  }

  panTo(x: number, z: number): void {
    this.targetGoal.set(x, z);
  }

  /** Pan in screen directions (dx right, dy down), in world units. */
  panBy(dx: number, dy: number): void {
    const a = this.yaw;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    // Screen right = (cos, -sin), screen down = (sin, cos) on the ground plane.
    this.targetGoal.x += dx * cos + dy * sin;
    this.targetGoal.y += -dx * sin + dy * cos;
    this.clamp();
  }

  zoomBy(delta: number): void {
    this.zoomGoal = THREE.MathUtils.clamp(this.zoomGoal + delta, 0, this.maxZoom);
  }

  setZoom(zoom: number): void {
    this.zoom = this.zoomGoal = THREE.MathUtils.clamp(zoom, 0, this.maxZoom);
  }

  rotate(steps: number): void {
    if (this.classic) return;
    this.quarter += steps;
  }

  resetRotation(): void {
    this.quarter = Math.round(this.quarter / 4) * 4;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  /** World units per screen pixel at the target (for panning with the mouse). */
  unitsPerPixel(viewportHeight: number): number {
    const visible = 2 * this.distance * Math.tan((this.camera.fov * DEG) / 2);
    return visible / viewportHeight / Math.sin(this.pitch);
  }

  private clamp(): void {
    this.targetGoal.clamp(this.bounds.min, this.bounds.max);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-dt * 12);
    this.target.lerp(this.targetGoal, k);
    this.zoom += (this.zoomGoal - this.zoom) * (1 - Math.exp(-dt * 10));
    const yawGoal = (this.quarter * Math.PI) / 2;
    this.yaw += (yawGoal - this.yaw) * (1 - Math.exp(-dt * 9));
    this.shake = Math.max(0, this.shake - dt * 2.5);

    const pitch = this.pitch;
    const dist = this.distance;
    const horiz = Math.cos(pitch) * dist;
    const height = Math.sin(pitch) * dist;
    // Camera sits "south" of the target when yaw = 0 (looking north, -z).
    const ox = Math.sin(this.yaw) * horiz;
    const oz = Math.cos(this.yaw) * horiz;
    const sx = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.6 : 0;
    const sz = this.shake > 0 ? (Math.random() - 0.5) * this.shake * 0.6 : 0;
    for (const cam of [this.camera, this.ortho]) {
      cam.position.set(this.target.x + ox + sx, height, this.target.y + oz + sz);
      cam.up.set(0, 1, 0);
      cam.lookAt(this.target.x + sx, 0, this.target.y + sz);
    }
    const halfH = dist * Math.tan((this.camera.fov * DEG) / 2);
    this.ortho.top = halfH;
    this.ortho.bottom = -halfH;
    this.ortho.left = -halfH * this.camera.aspect;
    this.ortho.right = halfH * this.camera.aspect;
    this.ortho.updateProjectionMatrix();
  }

  /** Yaw in radians (for the compass). */
  get heading(): number {
    return this.yaw;
  }
}
