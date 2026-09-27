import * as THREE from 'three';

interface LightRequest {
  anchor: THREE.Object3D;
  color: THREE.Color;
  intensity: number;
  distance: number;
  score: number;
}

const tmp = new THREE.Vector3();

/**
 * A handful of point lights shared by everything that glows (candlez, geyserz, outlets...).
 * Three.js shades every pixel against every light in the scene, so a level with dozens of
 * hazardz, each with a light of its own, crawls. Instead the views ask for light every frame
 * and the brightest requests near what the camera looks at get one of these. The number of
 * lights never changes, so the shaders never need recompiling either.
 */
export class LightPool {
  readonly group = new THREE.Group();
  private lights: THREE.PointLight[] = [];
  private requests: LightRequest[] = [];
  private used = 0;

  constructor(size = 6) {
    this.group.name = 'hazard lights';
    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 4, 2);
      this.lights.push(light);
      this.group.add(light);
    }
  }

  /** Ask for a light at `anchor`'s world position this frame. */
  request(anchor: THREE.Object3D, color: THREE.ColorRepresentation, intensity: number, distance: number): void {
    if (intensity <= 0.01) return;
    let r = this.requests[this.used];
    if (!r) {
      r = { anchor, color: new THREE.Color(), intensity, distance, score: 0 };
      this.requests.push(r);
    }
    r.anchor = anchor;
    r.color.set(color);
    r.intensity = intensity;
    r.distance = distance;
    this.used++;
  }

  /** Hand the lights to the strongest requests around `focus` (x/z in world units). */
  flush(focus: { x: number; z: number }): void {
    const live = this.requests.slice(0, this.used);
    for (const r of live) {
      r.anchor.getWorldPosition(tmp);
      const d2 = (tmp.x - focus.x) ** 2 + (tmp.z - focus.z) ** 2;
      r.score = r.intensity / (1 + d2 / 60);
    }
    live.sort((a, b) => b.score - a.score);
    this.lights.forEach((light, i) => {
      const r = live[i];
      if (!r) {
        light.intensity = 0;
        return;
      }
      r.anchor.getWorldPosition(light.position);
      light.color.copy(r.color);
      light.intensity = r.intensity;
      light.distance = r.distance;
    });
    this.used = 0;
  }
}
