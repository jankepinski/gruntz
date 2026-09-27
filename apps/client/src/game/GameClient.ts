import {
  applyDelta,
  predictPath,
  replicaHash,
  T,
  tileDef,
  worldFromView,
  type Command,
  type Delta,
  type EntityId,
  type Fx,
  type GameEnd,
  type GameServerMsg,
  type GameStart,
  type Grunt,
  type Point,
  type World,
} from '@gruntz/core';
import { TickClock } from '../net/clock.ts';
import { Predictor } from '../net/predictor.ts';
import type { GameTransport } from '../net/transport.ts';
import { GameRenderer } from '../render/renderer.ts';
import { models } from '../render/models.ts';
import { audio, type Sfx } from '../audio/audio.ts';
import { InputController } from '../input/controller.ts';
import { settings, Store } from './store.ts';

export type InteractionMode =
  | { kind: 'normal' }
  | { kind: 'tool' }
  | { kind: 'toy' }
  | { kind: 'give'; slot: number }
  | { kind: 'drop'; oven: number };

export interface GameUi {
  status: 'loading' | 'playing' | 'ended';
  start: GameStart | null;
  team: number;
  selection: EntityId[];
  mode: InteractionMode;
  paused: boolean;
  speed: number;
  end: GameEnd | null;
  /** Bumped a few times per second so the HUD re-reads the replica. */
  frame: number;
  ping: number;
  connectionProblem: boolean;
  alert: { text: string; at: number } | null;
  /** Help book text being shown. */
  help: { en: string; pl: string } | null;
  toast: { key: string; at: number } | null;
}

/**
 * Client side of a game: keeps the replica in sync with the authoritative simulation,
 * renders it and turns input into commands.
 */
export class GameClient {
  world: World | null = null;
  readonly renderer: GameRenderer;
  readonly clock = new TickClock();
  readonly predictor = new Predictor();
  readonly ui = new Store<GameUi>({
    status: 'loading',
    start: null,
    team: 0,
    selection: [],
    mode: { kind: 'normal' },
    paused: false,
    speed: 1,
    end: null,
    frame: 0,
    ping: 0,
    connectionProblem: false,
    alert: null,
    help: null,
    toast: null,
  });
  readonly input: InputController;
  private seq = 1;
  private raf = 0;
  private last = performance.now();
  private hudTimer = 0;
  private unsub: () => void;
  private lastMessageAt = performance.now();
  private hoverTile: Point | null = null;
  private pathKey = '';
  lastEventAt: Point | null = null;
  readonly singlePlayer: boolean;
  private pingTimer = 0;
  private onEnd?: (end: GameEnd) => void;

  constructor(
    canvas: HTMLCanvasElement,
    readonly transport: GameTransport,
    opts: { singlePlayer: boolean; onEnd?: (end: GameEnd) => void },
  ) {
    this.singlePlayer = opts.singlePlayer;
    if (opts.onEnd) this.onEnd = opts.onEnd;
    this.renderer = new GameRenderer(canvas);
    this.input = new InputController(this, canvas);
    // Dev inspection hook (camera, renderer) for screenshots and debugging.
    if (import.meta.env.DEV) (window as unknown as { __gruntz?: GameClient }).__gruntz = this;
    this.unsub = transport.onMessage(msg => this.onMessage(msg));
    this.raf = requestAnimationFrame(this.frame);
    // Hidden tabs/panes stop requestAnimationFrame; keep the simulation view alive at a
    // low rate so state and HUD stay current (and automated previews can render).
    this.fallbackTimer = window.setInterval(() => {
      if (performance.now() - this.lastFrameAt > 250) this.frame(performance.now(), true);
    }, 100);
    this.pingTimer = window.setInterval(() => this.transport.send({ t: 'ping', c: performance.timeOrigin + performance.now() }), 2000);
    this.applySettings();
    settings.subscribe(() => this.applySettings());
  }

  private applySettings(): void {
    this.renderer.rig.classic = settings.get().classicCamera;
    this.renderer.setGraphics(settings.get().graphics);
  }

  private onMessage(msg: GameServerMsg): void {
    this.lastMessageAt = performance.now();
    switch (msg.t) {
      case 'start':
        this.begin(msg.start);
        break;
      case 'snapshot':
        this.world = worldFromView(msg.s);
        if (this.ready) this.renderer.load(this.world);
        this.clock.reset(msg.s.tick);
        break;
      case 'delta':
        this.applyDelta(msg.d);
        break;
      case 'hash':
        if (this.world && this.world.tick === msg.tick + 1 && replicaHash(this.world) !== msg.h) {
          console.warn('State mismatch, resyncing');
          this.transport.send({ t: 'resync' });
        }
        break;
      case 'end':
        this.ui.set({ status: 'ended', end: msg.end });
        audio.stopMusic();
        this.onEnd?.(msg.end);
        break;
      case 'pong':
        this.ui.set({ ping: Math.round(performance.timeOrigin + performance.now() - msg.c) });
        break;
      case 'ack':
      case 'reject':
        break;
    }
  }

  private ready = false;

  private begin(start: GameStart): void {
    this.world = worldFromView(start.snapshot);
    this.clock.reset(start.snapshot.tick);
    // Deltas keep flowing into the replica while the models load.
    void models.preload(['grunt', 'terrain', 'items', 'props', 'hazards']).then(() => {
      const w = this.world;
      if (!w) return;
      this.renderer.load(w);
      this.ready = true;
      audio.music(w.theme);
      this.ui.set({ status: 'playing', start, team: start.team });
      // Look at our gruntz.
      const mine = [...w.all('grunt')].filter(g => g.team === start.team);
      const focus = mine[0] ?? [...w.all('fort')].find(f => f.team === start.team);
      if (focus) this.renderer.rig.jumpTo(focus.x + 0.5, focus.y + 0.5);
      else this.renderer.rig.jumpTo(w.width / 2, w.height / 2);
    });
  }

  private applyDelta(d: Delta): void {
    if (!this.world) return;
    applyDelta(this.world, d);
    if (d.tiles && this.renderer.terrain && this.ready) {
      this.renderer.terrain.updateTiles(d.tiles);
      const t = d.tiles.find(([, tile]) => {
        const k = tileDef(tile).visual.kind;
        return k === 'pyramid' || k === 'bridge';
      });
      if (t) this.sound('pyramid', t[0] % this.world.width, Math.floor(t[0] / this.world.width));
    }
    if (d.fx && this.ready) for (const fx of d.fx) this.handleFx(fx);
    this.clock.onTick(d.tick);
    if (d.removed && this.ui.get().selection.some(id => d.removed!.includes(id))) {
      this.ui.set({ selection: this.ui.get().selection.filter(id => this.world!.entities.has(id)) });
    }
  }

  /** Stereo pan and volume for a sound at a tile, from the camera's point of view. */
  private spatial(x: number, y: number): { pan: number; vol: number } {
    const p = this.renderer.toScreen(x + 0.5, 0.3, y + 0.5);
    const w = this.renderer.width;
    const h = this.renderer.height;
    const pan = Math.max(-1, Math.min(1, (p.x / w) * 2 - 1)) * 0.7;
    const off = Math.max(0, Math.max(-p.x, p.x - w, -p.y, p.y - h) / Math.max(w, h));
    const zoomFalloff = 1 - this.renderer.rig.zoom * 0.35;
    return { pan, vol: Math.max(0, 1 - off * 2.5) * zoomFalloff };
  }

  private sound(name: Sfx, x: number, y: number, gain = 1): void {
    const { pan, vol } = this.spatial(x, y);
    audio.play(name, pan, vol * gain);
  }

  private handleFx(fx: Fx): void {
    const mine = fx.id !== undefined && this.world?.get(fx.id, 'grunt')?.team === this.ui.get().team;
    this.renderer.effects.handle(fx, mine);
    this.fxSound(fx, mine);
    if (fx.type === 'death' || fx.type === 'explosion' || fx.type === 'fortCaptured') this.lastEventAt = { x: fx.x, y: fx.y };
    if (fx.type === 'help' && fx.data === this.ui.get().team && fx.id !== undefined) {
      const book = this.world?.get(fx.id, 'help');
      if (book) this.ui.set({ help: { en: book.en, pl: book.pl } });
    }
    if (fx.type === 'fortCaptured' && fx.data !== this.ui.get().team) {
      this.ui.set({ alert: { text: 'fortCaptured', at: performance.now() } });
    }
  }

  private fxSound(fx: Fx, mine: boolean): void {
    const at = (name: Sfx, gain = 1) => this.sound(name, fx.x, fx.y, gain);
    switch (fx.type) {
      case 'explosion':
        at('explosion');
        break;
      case 'hit':
        at(typeof fx.data === 'number' && fx.data >= 8 ? 'hitBig' : 'hit');
        if (mine && fx.id !== undefined) {
          const { pan, vol } = this.spatial(fx.x, fx.y);
          audio.voice(fx.id, 'hurt', pan, vol * 0.8);
        }
        break;
      case 'death':
        at(fx.data === 'SINK' ? 'splash' : 'death');
        if (fx.id !== undefined) {
          const { pan, vol } = this.spatial(fx.x, fx.y);
          audio.voice(fx.id, 'die', pan, vol * (mine ? 1 : 0.6));
        }
        break;
      case 'dirt':
        at('dig');
        break;
      case 'break':
      case 'brickBreak':
      case 'ballBreak':
        at('smash');
        break;
      case 'clang':
        at('brick');
        break;
      case 'brick':
        at('brick');
        break;
      case 'pickup': {
        const item = String(fx.data ?? '');
        at(item === 'COIN' || item.startsWith('SECRET') ? 'coin' : ['GHOST', 'SUPERSPEED', 'INVULNERABILITY', 'CONVERSION', 'DEATHTOUCH', 'ROIDZ', 'REACTIVEARMOR'].includes(item) ? 'powerup' : 'pickup');
        if (mine && fx.id !== undefined) audio.voice(fx.id, 'happy', 0, 0.7);
        break;
      }
      case 'suck':
        at('suck');
        break;
      case 'teleport':
      case 'secret':
        at('teleport');
        break;
      case 'switch':
        at('switch');
        break;
      case 'throw':
        at('throw');
        break;
      case 'impact':
        at('impact');
        break;
      case 'fuse':
        at('fuse');
        break;
      case 'spell':
      case 'convert':
        at('spell');
        break;
      case 'giveToy':
      case 'toybox':
        at('toy');
        break;
      case 'win':
        audio.play(mine || fx.id === this.world?.team(this.ui.get().team)?.id ? 'win' : 'lose');
        break;
      case 'fortCaptured':
        at('explosion', 0.6);
        break;
      case 'hazard': {
        const theme = this.world?.theme;
        at(theme === 'sweetz' ? 'flare' : theme === 'rollerz' ? 'trapdoor' : theme === 'shrunk' ? 'zap' : theme === 'minis' ? 'explosion' : 'geyser', 0.8);
        break;
      }
      case 'drop':
        at('whistle', 0.9);
        if (mine && fx.id !== undefined) audio.voice(fx.id, 'confused', 0, 0.7);
        break;
      case 'splat':
        at('splat');
        break;
      case 'giantBreak':
        at('rumble');
        at('smash');
        break;
    }
  }

  send(cmd: Command): void {
    if (this.world) {
      const ui = this.ui.get();
      this.predictor.onCommand(this.world, ui.team, cmd, this.clock.serverTick, Math.max(ui.ping, 50), settings.get().safePath);
    }
    this.transport.send({ t: 'cmd', seq: this.seq++, c: cmd });
    // A quick "yes boss!" from the first grunt that got the order.
    if ('ids' in cmd && cmd.ids.length && cmd.type !== 'stop' && performance.now() - this.lastAck > 350) {
      this.lastAck = performance.now();
      const g = this.world?.get(cmd.ids[0]!, 'grunt');
      if (g) audio.voice(g.id, cmd.type === 'attack' ? 'attack' : 'ack', 0, 0.6);
    }
  }
  private lastAck = 0;

  // --- selection helpers ------------------------------------------------------------

  selectedGruntz(): Grunt[] {
    const w = this.world;
    if (!w) return [];
    return this.ui
      .get()
      .selection.map(id => w.get(id, 'grunt'))
      .filter((g): g is Grunt => !!g && g.action.kind !== 'death');
  }

  select(ids: EntityId[]): void {
    this.ui.set({ selection: ids });
  }

  setMode(mode: InteractionMode): void {
    this.ui.set({ mode });
  }

  togglePause(): void {
    if (!this.singlePlayer) return;
    const paused = !this.ui.get().paused;
    this.ui.set({ paused });
    this.transport.control?.({ t: 'pause', paused });
  }

  /** Single player quick save / load (F5 / F9). */
  quickSave(levelId: string): void {
    const t = this.transport as GameTransport & { onSaved?: (data: unknown) => void };
    if (!this.singlePlayer || !t.control) return;
    t.onSaved = data => {
      try {
        localStorage.setItem(`gruntz.save.${levelId}`, JSON.stringify(data));
        this.ui.set({ toast: { key: 'saved', at: performance.now() } });
      } catch {
        this.ui.set({ toast: { key: 'saveFailed', at: performance.now() } });
      }
    };
    t.control({ t: 'save' });
  }

  quickLoad(levelId: string): void {
    if (!this.singlePlayer || !this.transport.control) return;
    try {
      const raw = localStorage.getItem(`gruntz.save.${levelId}`);
      if (!raw) return;
      this.transport.control({ t: 'load', data: JSON.parse(raw) });
      this.ui.set({ toast: { key: 'loaded', at: performance.now() }, end: null, status: 'playing' });
    } catch {
      /* ignore broken saves */
    }
  }

  setSpeed(speed: number): void {
    if (!this.singlePlayer) return;
    this.ui.set({ speed });
    this.clock.speed = speed;
    this.transport.control?.({ t: 'speed', speed });
  }

  // --- hover / path preview ------------------------------------------------------------

  updateHover(tile: Point | null): void {
    this.hoverTile = tile;
  }

  private updatePathPreview(): void {
    const w = this.world;
    const sel = this.selectedGruntz().filter(g => g.team === this.ui.get().team);
    const tile = this.hoverTile;
    const mode = this.ui.get().mode.kind;
    if (!w || !tile || sel.length === 0 || mode !== 'normal' || this.input.hoverTarget !== 'move') {
      if (this.pathKey !== '') {
        this.renderer.setPath([], () => false);
        this.pathKey = '';
      }
      return;
    }
    const g = sel[0]!;
    const key = `${g.id}:${g.x},${g.y}->${tile.x},${tile.y}:${w.mapVersion}`;
    if (key === this.pathKey) return;
    this.pathKey = key;
    const path = predictPath(w, g, tile, settings.get().safePath);
    const toob = g.tool === 'TOOB' || g.tool === 'TOOBWATER' || g.tool === 'WINGZ';
    this.renderer.setPath(path, p => {
      const tr = w.traits(p.x, p.y);
      if (g.tool === 'WINGZ' && tr & T.FLY) return false;
      return (tr & (T.DEATH | T.HOLE | T.PAIN)) !== 0 || (!toob && (tr & T.WATER) !== 0);
    });
  }

  private updateLinks(): void {
    const w = this.world;
    const tile = this.hoverTile;
    if (!w || !tile || !settings.get().showLinks) {
      this.renderer.setLinks(null, []);
      return;
    }
    const sw = w.objectAt(tile.x, tile.y, 'switch');
    this.renderer.setLinks(sw ? tile : null, sw ? sw.targets : []);
  }

  // --- main loop ------------------------------------------------------------------------

  private fallbackTimer = 0;
  private lastFrameAt = performance.now();

  /** Frame rate meter (for the optional on-screen counter). */
  readonly perf = new Store<{ fps: number; ms: number }>({ fps: 0, ms: 0 });
  private perfFrames = 0;
  private perfSince = performance.now();
  private perfWork = 0;

  private frame = (now: number, fallback = false): void => {
    if (!fallback) this.raf = requestAnimationFrame(this.frame);
    this.lastFrameAt = now;
    const workStart = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const ui = this.ui.get();
    this.clock.update(dt * 1000, ui.paused);
    this.input.update(dt);
    const w = this.world;
    if (!w || !this.ready) return;
    this.updatePathPreview();
    this.updateLinks();
    const team = w.team(ui.team);
    const padsFlashing = !!team && team.ovens.some(o => o >= 0 && w.tick >= o);
    this.renderer.render({
      world: w,
      tick: this.clock.renderTick,
      dt,
      time: now / 1000,
      viewer: ui.team,
      selected: new Set(ui.selection),
      hovered: this.input.hoveredGrunt,
      showAllBars: this.input.altHeld,
      padsFlashing,
      predict: (g, tick) => this.predictor.position(g, tick),
    });
    this.perfFrames++;
    this.perfWork += performance.now() - workStart;
    if (now - this.perfSince >= 500) {
      this.perf.set({ fps: Math.round((this.perfFrames * 1000) / (now - this.perfSince)), ms: this.perfWork / this.perfFrames });
      this.perfFrames = 0;
      this.perfWork = 0;
      this.perfSince = now;
    }
    this.hudTimer += dt;
    if (this.hudTimer > 0.1) {
      this.hudTimer = 0;
      const problem = !this.singlePlayer && performance.now() - this.lastMessageAt > 1500;
      this.ui.set({ frame: ui.frame + 1, connectionProblem: problem });
    }
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    audio.stopMusic();
    clearInterval(this.pingTimer);
    clearInterval(this.fallbackTimer);
    this.unsub();
    this.input.dispose();
    this.renderer.dispose();
    this.transport.close();
  }
}
