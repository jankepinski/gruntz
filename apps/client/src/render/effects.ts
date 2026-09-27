import * as THREE from 'three';
import type { Fx } from '@gruntz/core';

interface Particle {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  gravity: number;
  grow: number;
  /** Ground height the particle bounces on. */
  floor: number;
}

interface Pulse {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  maxScale: number;
}

const COLORS: Record<string, number> = {
  explosion: 0xff9a2a,
  hit: 0xfff2a0,
  dirt: 0x8a5a36,
  break: 0x8f7a6a,
  brickBreak: 0x9a5a36,
  pickup: 0xfff6a0,
  suck: 0x9ae06a,
  teleport: 0x6ad8ff,
  convert: 0xf2902a,
  clang: 0xffffff,
  crumble: 0x6a5040,
  ballBreak: 0x2a2a2a,
};

const SPELL_COLORS: Record<string, number> = {
  FREEZE: 0xe0f4ff,
  HEALTH: 0x55ff00,
  RESURRECT: 0xcc6600,
  TOYZ: 0xff0099,
  TELEPORT: 0x3a5aff,
  ROLLINGBALLZ: 0xcc0000,
};

export interface FloatingText {
  text: string;
  x: number;
  y: number;
  z: number;
  color: string;
  born: number;
}

/** Short-lived particles, shockwaves and floating numbers. */
export class Effects {
  readonly group = new THREE.Group();
  private particles: Particle[] = [];
  private pulses: Pulse[] = [];
  private geo = new THREE.IcosahedronGeometry(0.06, 0);
  private ringGeo = new THREE.RingGeometry(0.85, 1, 40);
  private materials = new Map<number, THREE.MeshStandardMaterial>();
  texts: FloatingText[] = [];
  onShake?: (amount: number) => void;
  /** Height of the ground at a point: effects are placed relative to it (high ground, stairz). */
  groundAt?: (x: number, z: number) => number;
  private time = 0;

  private material(color: number): THREE.MeshStandardMaterial {
    let m = this.materials.get(color);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.8 });
      this.materials.set(color, m);
    }
    return m;
  }

  burst(x: number, y: number, z: number, color: number, count: number, speed: number, size = 1, gravity = 9): void {
    const ground = this.groundAt?.(x, z) ?? 0;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.geo, this.material(color));
      mesh.position.set(x, y + ground, z);
      mesh.scale.setScalar(size * (0.6 + Math.random() * 0.8));
      const a = Math.random() * Math.PI * 2;
      const up = 0.4 + Math.random();
      const vel = new THREE.Vector3(
        Math.cos(a) * speed * Math.random(),
        up * speed,
        Math.sin(a) * speed * Math.random(),
      );
      this.group.add(mesh);
      const life = 0.5 + Math.random() * 0.5;
      this.particles.push({ mesh, vel, life, maxLife: life, gravity, grow: 0, floor: ground + 0.02 });
    }
  }

  pulse(x: number, z: number, color: number, radius: number, life = 0.6, y = 0.05): void {
    const mesh = new THREE.Mesh(
      this.ringGeo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + (this.groundAt?.(x, z) ?? 0), z);
    this.group.add(mesh);
    this.pulses.push({ mesh, life, maxLife: life, maxScale: radius });
  }

  text(text: string, x: number, z: number, color = '#ffe066', y = 1.1): void {
    this.texts.push({ text, x, y: y + (this.groundAt?.(x, z) ?? 0), z, color, born: this.time });
  }

  handle(fx: Fx, mine: boolean): void {
    const x = fx.x + 0.5;
    const z = fx.y + 0.5;
    switch (fx.type) {
      case 'explosion':
        this.burst(x, 0.4, z, 0xff7a1a, 26, 5, 2.2, 6);
        this.burst(x, 0.4, z, 0x3a3a3a, 12, 3, 2.5, 2);
        this.pulse(x, z, 0xffb04a, 1.6, 0.5);
        this.onShake?.(0.6);
        break;
      case 'hit':
        this.burst(x, 0.5, z, COLORS.hit!, 6, 2.5, 0.8);
        if (typeof fx.data === 'number' && fx.data > 0) this.text(`-${fx.data}`, x, z, '#ff6a4a');
        break;
      case 'hurt':
        this.text(`-${fx.data ?? ''}`, x, z, '#ff9a6a');
        break;
      case 'dirt':
      case 'break':
      case 'brickBreak':
      case 'crumble':
      case 'clang':
      case 'ballBreak':
        this.burst(x, 0.3, z, COLORS[fx.type]!, fx.type === 'clang' ? 6 : 14, 3, 1.3);
        break;
      case 'pickup':
        this.burst(x, 0.5, z, COLORS.pickup!, 10, 2, 0.8, 2);
        break;
      case 'suck':
        this.burst(x, 0.1, z, COLORS.suck!, 10, 1.5, 0.9, -2);
        break;
      case 'teleport':
        this.pulse(x, z, COLORS.teleport!, 0.8, 0.5, 0.4);
        break;
      case 'spell': {
        const color = SPELL_COLORS[String(fx.data)] ?? 0xffffff;
        this.pulse(x, z, color, 4.5, 0.9);
        this.burst(x, 0.6, z, color, 30, 4, 1, 1);
        break;
      }
      case 'convert':
        this.pulse(x, z, COLORS.convert!, 0.8);
        break;
      case 'death':
        if (fx.data === 'SHATTER') this.burst(x, 0.5, z, 0xc8e8ff, 20, 3, 1.2);
        if (fx.data === 'BURN') this.burst(x, 0.5, z, 0xff5a1a, 16, 2, 1, -1);
        if (fx.data === 'ELECTROCUTE') this.pulse(x, z, 0x9ad8ff, 0.8, 0.4, 0.5);
        break;
      case 'win':
        break;
      case 'switch':
        this.pulse(x, z, 0xffffff, 0.5, 0.3);
        break;
      case 'fortCaptured':
        this.pulse(x, z, 0xffe066, 3, 1.2);
        this.onShake?.(0.4);
        break;
      case 'impact':
        this.burst(x, 0.3, z, fx.data === 'WELDER' ? 0xff6a1a : 0xd8d0c0, 8, 2, 1);
        break;
      default:
        void mine;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.particles = this.particles.filter(p => {
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.removeFromParent();
        return false;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.mesh.position.y < p.floor && p.gravity > 0) {
        p.mesh.position.y = p.floor;
        p.vel.multiplyScalar(0.5);
        p.vel.y = Math.abs(p.vel.y) * 0.3;
      }
      p.mesh.scale.multiplyScalar(1 - dt * 0.8);
      return true;
    });
    this.pulses = this.pulses.filter(p => {
      p.life -= dt;
      const k = 1 - p.life / p.maxLife;
      p.mesh.scale.setScalar(0.1 + k * p.maxScale);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      if (p.life <= 0) {
        p.mesh.removeFromParent();
        (p.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
    this.texts = this.texts.filter(t => this.time - t.born < 1.1);
  }

  now(): number {
    return this.time;
  }
}
