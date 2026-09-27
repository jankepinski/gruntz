import { useEffect, useRef } from 'preact/hooks';
import { createWorld, type Grunt } from '@gruntz/core';
import { CAMPAIGN } from '../game/levels.ts';
import { settings } from '../game/store.ts';
import { models } from '../render/models.ts';
import { GameRenderer } from '../render/renderer.ts';

/**
 * Behind the menus: a real level from the game, gently flown over, with its gruntz
 * idling about. A different world every time the menu opens.
 */
export function MenuBackdrop() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    let disposed = false;
    let raf = 0;
    let renderer: GameRenderer | null = null;
    let ro: ResizeObserver | null = null;
    void (async () => {
      await models.preload(['grunt', 'terrain', 'items', 'props', 'hazards']);
      if (disposed) return;
      try {
        renderer = new GameRenderer(canvas);
      } catch {
        return; // no WebGL: the CSS gradient stays
      }
      const r = renderer;
      // The backdrop sits behind blurred panels: skip the costliest extras.
      r.setGraphics({
        ...settings.get().graphics,
        ao: false,
        resolution: Math.min(1.5, settings.get().graphics.resolution),
      });
      const pool = CAMPAIGN.filter(l => (l.world ?? 0) > 0);
      const level = pool[Math.floor(Math.random() * pool.length)] ?? CAMPAIGN[0]!;
      const world = createWorld(level, { seed: 7, teams: [{ team: 0, name: 'P' }] });
      r.load(world);
      // Start over the player's gruntz, then drift around the map.
      const home = [...world.entities.values()].find((e): e is Grunt => e.kind === 'grunt' && e.team === 0) ?? {
        x: world.width / 2,
        y: world.height / 2,
      };
      const cx = THREE_clamp(home.x + 0.5, 6, world.width - 6);
      const cy = THREE_clamp(home.y + 0.5, 5, world.height - 5);
      r.rig.setZoom(0.22);
      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        r.resize(Math.max(1, rect.width), Math.max(1, rect.height));
      };
      resize();
      ro = new ResizeObserver(resize);
      ro.observe(canvas);
      const start = performance.now();
      let last = start;
      const frame = (now: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;
        const time = (now - start) / 1000;
        r.rig.jumpTo(cx + Math.sin(time * 0.045) * 5, cy + Math.sin(time * 0.031 + 1) * 3);
        r.render({
          world,
          tick: Math.floor(time * 20),
          dt,
          time,
          viewer: 0,
          selected: new Set(),
          hovered: null,
          showAllBars: false,
          padsFlashing: false,
        });
        canvas.classList.add('ready');
      };
      raf = requestAnimationFrame(frame);
    })();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro?.disconnect();
      renderer?.dispose();
    };
  }, []);
  return <canvas class="menu-3d" ref={ref} />;
}

function THREE_clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
}
