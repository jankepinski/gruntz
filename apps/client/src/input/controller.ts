import * as THREE from 'three';
import { canUseRanged, isGone, T, toolTargetValid, type EntityId, type Grunt, type Point } from '@gruntz/core';
import type { GameClient } from '../game/GameClient.ts';
import { settings } from '../game/store.ts';
import type { HoverMode } from '../render/renderer.ts';

const DRAG_THRESHOLD = 6;
const EDGE = 12;

/**
 * Mouse & keyboard. Follows the original: left click selects / uses the tool when the
 * cursor shows it can, right click moves or attacks. On top: box select, shift to queue,
 * control groups, T/Y tool & toy modes, camera keys.
 */
export class InputController {
  hoveredGrunt: EntityId | null = null;
  hoverTarget: HoverMode = 'none';
  altHeld = false;
  dragRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private keys = new Set<string>();
  private mouse = { x: 0, y: 0, inside: false };
  private leftDown: { x: number; y: number } | null = null;
  private middleDown: { x: number; y: number } | null = null;
  private groups = new Map<number, EntityId[]>();
  private lastGroupKey = { key: -1, at: 0 };
  private lastClick = { id: -1, at: 0 };
  private disposers: (() => void)[] = [];
  onContextMenu?: (x: number, y: number, grunt: Grunt) => void;
  onDragChange?: () => void;

  constructor(
    private client: GameClient,
    private canvas: HTMLCanvasElement,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(canvas, 'pointerdown', e => this.pointerDown(e));
    on(window, 'pointermove', e => this.pointerMove(e));
    on(window, 'pointerup', e => this.pointerUp(e));
    on(canvas, 'wheel', e => this.wheel(e), { passive: false });
    on(canvas, 'contextmenu', e => e.preventDefault());
    on(canvas, 'pointerleave', () => (this.mouse.inside = false));
    on(canvas, 'pointerenter', () => (this.mouse.inside = true));
    on(window, 'keydown', e => this.keyDown(e));
    on(window, 'keyup', e => this.keyUp(e));
    on(window, 'blur', () => {
      this.keys.clear();
      this.altHeld = false;
    });
  }

  private get world() {
    return this.client.world;
  }

  private get team(): number {
    return this.client.ui.get().team;
  }

  private ndc(x: number, y: number): THREE.Vector2 {
    return this.client.renderer.toNdc(x, y);
  }

  private pick(x: number, y: number): { tile: Point | null; grunt: Grunt | null } {
    const w = this.world;
    if (!w) return { tile: null, grunt: null };
    const r = this.client.renderer;
    const ndc = this.ndc(x, y);
    const grunt = r.entities.pickGrunt(ndc, r.rig.active, r.width, r.height, g => !isGone(g), w);
    return { tile: r.pickTile(ndc, w), grunt };
  }

  private mine(g: Grunt | null): boolean {
    return !!g && g.team === this.team && !g.ai;
  }

  // --- pointer -----------------------------------------------------------------------

  private pointerDown(e: PointerEvent): void {
    this.canvas.focus();
    if (e.button === 0) this.leftDown = { x: e.clientX, y: e.clientY };
    if (e.button === 1) {
      e.preventDefault();
      this.middleDown = { x: e.clientX, y: e.clientY };
    }
    if (e.button === 2) this.rightClick(e);
  }

  private pointerMove(e: PointerEvent): void {
    this.mouse.x = e.clientX;
    this.mouse.y = e.clientY;
    const rect = this.canvas.getBoundingClientRect();
    this.mouse.inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (this.middleDown) {
      const rig = this.client.renderer.rig;
      const upp = rig.unitsPerPixel(rect.height);
      rig.panBy(-(e.clientX - this.middleDown.x) * upp, -(e.clientY - this.middleDown.y) * upp * Math.sin(rig.pitch));
      this.middleDown = { x: e.clientX, y: e.clientY };
    }
    if (this.leftDown) {
      const dx = e.clientX - this.leftDown.x;
      const dy = e.clientY - this.leftDown.y;
      if (this.dragRect || Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        this.dragRect = { x0: this.leftDown.x - rect.left, y0: this.leftDown.y - rect.top, x1: e.clientX - rect.left, y1: e.clientY - rect.top };
        this.onDragChange?.();
      }
    }
  }

  private pointerUp(e: PointerEvent): void {
    if (e.button === 1) this.middleDown = null;
    if (e.button !== 0 || !this.leftDown) return;
    const wasDrag = this.dragRect;
    this.leftDown = null;
    this.dragRect = null;
    this.onDragChange?.();
    if (wasDrag) this.boxSelect(wasDrag, e.shiftKey);
    else this.leftClick(e);
  }

  private boxSelect(rect: { x0: number; y0: number; x1: number; y1: number }, add: boolean): void {
    const w = this.world;
    if (!w) return;
    const r = this.client.renderer;
    const bounds = this.canvas.getBoundingClientRect();
    const a = this.ndc(bounds.left + Math.min(rect.x0, rect.x1), bounds.top + Math.max(rect.y0, rect.y1));
    const b = this.ndc(bounds.left + Math.max(rect.x0, rect.x1), bounds.top + Math.min(rect.y0, rect.y1));
    const found = r.entities.gruntsInRect(a, b, r.rig.active, w, g => this.mine(g) && !isGone(g)).map(g => g.id);
    const current = add ? this.client.ui.get().selection : [];
    this.client.select([...new Set([...current, ...found])]);
  }

  private leftClick(e: PointerEvent): void {
    const w = this.world;
    if (!w) return;
    const { tile, grunt } = this.pick(e.clientX, e.clientY);
    const mode = this.client.ui.get().mode;
    const sel = this.client.selectedGruntz().filter(g => this.mine(g));
    const ids = sel.map(g => g.id);
    const queue = e.shiftKey;

    switch (mode.kind) {
      case 'tool':
        if (tile && ids.length) {
          const target = grunt && !this.mine(grunt) ? grunt.id : undefined;
          this.client.send({ type: 'useTool', ids, x: grunt?.x ?? tile.x, y: grunt?.y ?? tile.y, target, queue });
        }
        if (!queue) this.client.setMode({ kind: 'normal' });
        return;
      case 'toy':
        if (tile && ids.length) {
          const target = grunt?.id;
          this.client.send({ type: 'useToy', ids, x: grunt?.x ?? tile.x, y: grunt?.y ?? tile.y, target, queue });
        }
        if (!queue) this.client.setMode({ kind: 'normal' });
        return;
      case 'give':
        if (grunt && this.mine(grunt)) this.client.send({ type: 'give', slot: mode.slot, id: grunt.id });
        this.client.setMode({ kind: 'normal' });
        return;
      case 'drop': {
        const pad = tile ? w.objectAt(tile.x, tile.y, 'pad') : undefined;
        if (pad && pad.team === this.team) this.client.send({ type: 'drop', oven: mode.oven, pad: pad.id });
        this.client.setMode({ kind: 'normal' });
        return;
      }
    }

    if (grunt && this.mine(grunt)) {
      const now = performance.now();
      if (this.lastClick.id === grunt.id && now - this.lastClick.at < 350) {
        // Double click: every grunt with the same tool on screen.
        const r = this.client.renderer;
        const all = r.entities.gruntsInRect(new THREE.Vector2(-1, -1), new THREE.Vector2(1, 1), r.rig.active, w, g => this.mine(g) && g.tool === grunt.tool);
        this.client.select(all.map(g => g.id));
      } else if (e.shiftKey) {
        const current = this.client.ui.get().selection;
        this.client.select(current.includes(grunt.id) ? current.filter(id => id !== grunt.id) : [...current, grunt.id]);
      } else {
        this.client.select([grunt.id]);
      }
      this.lastClick = { id: grunt.id, at: now };
      return;
    }
    // Left click with a usable tool cursor uses the tool (original behaviour).
    if (tile && ids.length && this.hoverTarget === 'tool') {
      const target = grunt && !this.mine(grunt) ? grunt.id : undefined;
      this.client.send({ type: 'useTool', ids, x: grunt?.x ?? tile.x, y: grunt?.y ?? tile.y, target, queue });
      return;
    }
    if (!e.shiftKey) this.client.select([]);
  }

  private rightClick(e: PointerEvent): void {
    const w = this.world;
    if (!w) return;
    if (this.client.ui.get().mode.kind !== 'normal') {
      this.client.setMode({ kind: 'normal' });
      return;
    }
    const { tile, grunt } = this.pick(e.clientX, e.clientY);
    const sel = this.client.selectedGruntz().filter(g => this.mine(g));
    const ids = sel.map(g => g.id);
    if (grunt && this.mine(grunt) && (ids.length === 0 || ids.includes(grunt.id))) {
      if (!ids.includes(grunt.id)) this.client.select([grunt.id]);
      this.onContextMenu?.(e.clientX, e.clientY, grunt);
      return;
    }
    if (ids.length === 0 || !tile) return;
    const queue = e.shiftKey;
    if (grunt && !this.mine(grunt) && w.alliance(grunt.team) !== w.alliance(this.team)) {
      this.client.send({ type: 'attack', ids, target: grunt.id, queue });
      this.client.renderer.effects.pulse(grunt.x + 0.5, grunt.y + 0.5, 0xff5a4a, 0.6, 0.35);
      return;
    }
    this.client.send({ type: 'move', ids, x: tile.x, y: tile.y, queue, safe: settings.get().safePath });
    this.client.renderer.effects.pulse(tile.x + 0.5, tile.y + 0.5, 0xffffff, 0.5, 0.35);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.client.renderer.rig.zoomBy(Math.sign(e.deltaY) * 0.06);
  }

  // --- keyboard -----------------------------------------------------------------------

  private keyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    this.keys.add(e.code);
    if (e.key === 'Alt') {
      this.altHeld = true;
      e.preventDefault();
    }
    const rig = this.client.renderer.rig;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const n = Number(digit[1]);
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this.groups.set(n, this.client.ui.get().selection.slice());
      } else {
        const ids = (this.groups.get(n) ?? []).filter(id => this.world?.entities.has(id));
        this.client.select(ids);
        const now = performance.now();
        if (this.lastGroupKey.key === n && now - this.lastGroupKey.at < 350) this.centerOnSelection();
        this.lastGroupKey = { key: n, at: now };
      }
      return;
    }
    switch (e.code) {
      case 'KeyT':
        if (this.client.selectedGruntz().length) this.client.setMode({ kind: 'tool' });
        break;
      case 'KeyY':
        if (this.client.selectedGruntz().length) this.client.setMode({ kind: 'toy' });
        break;
      case 'KeyX': {
        const ids = this.client.selectedGruntz().filter(g => this.mine(g)).map(g => g.id);
        if (ids.length) this.client.send({ type: 'stop', ids });
        break;
      }
      case 'Escape':
        if (this.client.ui.get().mode.kind !== 'normal') this.client.setMode({ kind: 'normal' });
        else this.client.select([]);
        break;
      case 'KeyQ':
        rig.rotate(-1);
        break;
      case 'KeyE':
        rig.rotate(1);
        break;
      case 'Home':
        rig.resetRotation();
        break;
      case 'Space':
        e.preventDefault();
        if (this.client.lastEventAt) rig.panTo(this.client.lastEventAt.x + 0.5, this.client.lastEventAt.y + 0.5);
        else this.centerOnSelection();
        break;
      case 'KeyP':
      case 'Pause':
        this.client.togglePause();
        break;
      case 'F5':
        e.preventDefault();
        this.client.quickSave(this.client.ui.get().start?.level.id ?? 'unknown');
        break;
      case 'F9':
        e.preventDefault();
        this.client.quickLoad(this.client.ui.get().start?.level.id ?? 'unknown');
        break;
      case 'Equal':
      case 'NumpadAdd':
        this.client.setSpeed(Math.min(2, this.client.ui.get().speed * 2));
        break;
      case 'Minus':
      case 'NumpadSubtract':
        this.client.setSpeed(Math.max(0.5, this.client.ui.get().speed / 2));
        break;
      case 'KeyA':
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          const w = this.world;
          if (w) this.client.select([...w.all('grunt')].filter(g => this.mine(g) && !isGone(g)).map(g => g.id));
        }
        break;
      case 'Period': {
        // Select idle gruntz.
        const w = this.world;
        if (w) this.client.select([...w.all('grunt')].filter(g => this.mine(g) && g.action.kind === 'idle' && !g.task).map(g => g.id));
        break;
      }
    }
  }

  private keyUp(e: KeyboardEvent): void {
    this.keys.delete(e.code);
    if (e.key === 'Alt') this.altHeld = false;
  }

  centerOnSelection(): void {
    const sel = this.client.selectedGruntz();
    if (sel.length === 0) return;
    const x = sel.reduce((s, g) => s + g.x, 0) / sel.length;
    const y = sel.reduce((s, g) => s + g.y, 0) / sel.length;
    this.client.renderer.rig.panTo(x + 0.5, y + 0.5);
  }

  // --- per frame --------------------------------------------------------------------

  update(dt: number): void {
    const rig = this.client.renderer.rig;
    const speed = (8 + rig.distance * 0.5) * dt;
    let dx = 0;
    let dy = 0;
    const ctrl = this.keys.has('ControlLeft') || this.keys.has('ControlRight') || this.keys.has('MetaLeft');
    if (!ctrl) {
      if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) dx -= 1;
      if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) dx += 1;
      if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) dy -= 1;
      if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) dy += 1;
    }
    if (settings.get().edgeScroll && this.mouse.inside && !this.leftDown && document.hasFocus()) {
      const rect = this.canvas.getBoundingClientRect();
      if (this.mouse.x - rect.left < EDGE) dx -= 1;
      if (rect.right - this.mouse.x < EDGE) dx += 1;
      if (this.mouse.y - rect.top < EDGE) dy -= 1;
      if (rect.bottom - this.mouse.y < EDGE) dy += 1;
    }
    if (dx || dy) rig.panBy(dx * speed, dy * speed);
    this.updateHover();
  }

  private updateHover(): void {
    const w = this.world;
    if (!w || !this.mouse.inside) {
      this.hoverTarget = 'none';
      this.client.renderer.setHover(null, 'none', null);
      this.client.updateHover(null);
      this.hoveredGrunt = null;
      return;
    }
    const { tile, grunt } = this.pick(this.mouse.x, this.mouse.y);
    this.hoveredGrunt = grunt?.id ?? null;
    this.client.updateHover(tile);
    const sel = this.client.selectedGruntz().filter(g => this.mine(g));
    const mode = this.client.ui.get().mode;
    let hover: HoverMode = 'none';
    if (mode.kind === 'tool') {
      hover = tile && sel.some(g => this.canToolAt(g, tile, grunt)) ? 'tool' : 'invalid';
    } else if (mode.kind === 'toy') {
      hover = tile && sel.some(g => g.toy) ? 'toy' : 'invalid';
    } else if (mode.kind === 'give') {
      hover = this.mine(grunt) ? 'select' : 'invalid';
    } else if (mode.kind === 'drop') {
      const pad = tile ? w.objectAt(tile.x, tile.y, 'pad') : undefined;
      hover = pad && pad.team === this.team ? 'tool' : 'invalid';
    } else if (grunt && this.mine(grunt)) {
      hover = 'select';
    } else if (sel.length && grunt && w.alliance(grunt.team) !== w.alliance(this.team)) {
      hover = 'attack';
    } else if (sel.length && tile && sel.some(g => this.canToolAt(g, tile, null) && !w.has(tile.x, tile.y, T.PAIN))) {
      hover = 'tool';
    } else if (sel.length && tile) {
      hover = 'move';
    }
    this.hoverTarget = hover;
    this.client.renderer.setHover(tile, hover, w);
    this.canvas.style.cursor =
      hover === 'tool' ? 'crosshair' : hover === 'attack' ? 'crosshair' : hover === 'select' ? 'pointer' : hover === 'invalid' ? 'not-allowed' : 'default';
  }

  private canToolAt(g: Grunt, tile: Point, target: Grunt | null): boolean {
    const w = this.world;
    if (!w || !g.tool) return false;
    if (target && canUseRanged(g, target)) return true;
    if (canUseRanged(g, tile)) return true;
    if (g.tool === 'TIMEBOMB' && target) return true;
    return toolTargetValid(w, g, tile) && g.tool !== 'SPY' && g.tool !== 'WAND' && g.tool !== 'BOMB';
  }

  dispose(): void {
    for (const d of this.disposers) d();
  }
}
