import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import {
  AI_TYPES,
  blankLevel,
  BRICK_COLORS,
  POWERUPS,
  REWARDS,
  SPELLS,
  TOOLS,
  TOYS,
  UTILITIES,
  CURSES,
  tileByName,
  type BrickColor,
  type CombatTool,
  type Dir,
  type ItemId,
  type LevelData,
  type LevelObject,
  type PlayerInfo,
  type Point,
  type ThemeId,
  type ToyId,
} from '@gruntz/core';
import { aiName, itemName, localized, t, type Key } from '../i18n/index.ts';
import { settings, useStore } from '../game/store.ts';
import { LEVELS } from '../game/levels.ts';
import { GameScreen, type GameLaunch } from '../ui/GameScreen.tsx';
import { ItemImg } from '../ui/icons.tsx';
import { TEAM_COLORS } from '../render/placeholders.ts';
import {
  ArrowLeft,
  Brush,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Grid3x3,
  Menu as MenuIcon,
  Package,
  Settings2,
  Shapes,
  TriangleAlert,
  X,
  Download,
  FilePlus,
  FolderOpen,
  HardDrive,
  Link,
  MousePointer2,
  PaintBucket,
  Play,
  Plus,
  RectangleHorizontal,
  Redo2,
  Save,
  Swords,
  Undo2,
  Upload,
} from 'lucide-preact';
import { EditorView, isTyping } from './EditorView.ts';
import type { EditorModel, EditorTool, ObjectTemplate } from './model.ts';
import { groupLabel, ObjectThumb, TILE_GROUPS, tileLabel, TileCardArt, useThumbnails, type TileGroupId } from './palette.tsx';
import { customLevels, deleteCustomLevel, downloadLevel, parseLevelText, readLevelFile, saveCustomLevel, saveToContent } from './library.ts';

const THEMES: ThemeId[] = ['training', 'rocky', 'ice', 'tropics', 'sweetz', 'rollerz', 'shrunk', 'minis', 'space'];
const ALL_ITEMS: ItemId[] = [...TOOLS, ...TOYS, ...POWERUPS, ...UTILITIES, ...CURSES, ...REWARDS];
const DIR_GLYPH = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const newSeed = () => (Date.now() >>> 0) ^ Math.floor(Math.random() * 0xffff);

export function EditorScreen({ model, back }: { model: EditorModel; back: () => void }) {
  const [test, setTest] = useState<GameLaunch | null>(null);
  if (test) {
    return (
      <div class="editor-test">
        <GameScreen launch={test} onExit={() => setTest(null)} onRestart={() => setTest({ ...test, seed: newSeed() })} />
        <button class="editor-test-back primary" onClick={() => setTest(null)}>
          ✎ {t('editor.backToEditor')}
        </button>
      </div>
    );
  }
  return <Workspace model={model} back={back} onTest={setTest} />;
}

export function testLaunch(level: LevelData): GameLaunch {
  const name = settings.get().playerName || t('menu.you');
  const players: PlayerInfo[] = [{ team: 0, name, alliance: 0 }];
  if (level.mode === 'battle') {
    for (let i = 1; i < (level.players ?? 2); i++) players.push({ team: i, name: `Bot ${i}`, alliance: i, bot: 'normal' });
  }
  return { kind: 'sp', level, players, team: 0, seed: newSeed(), test: true };
}

type Drag =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'paint'; tile: string; last: Point }
  | { kind: 'rect'; tile: string; a: Point }
  | { kind: 'move'; index: number; started: boolean; from: Point; cycle: number[] | null };

/** Floating card on the right: the level settings or the problem list (the inspector shows by itself). */
type Card = 'level' | 'problems' | null;
/** Bottom dock category: a tile group, map objects or pickup items. */
type Category = TileGroupId | 'objects' | 'items';

function Workspace({ model, back, onTest }: { model: EditorModel; back: () => void; onTest: (l: GameLaunch) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = useStore(model.state);
  const [card, setCard] = useState<Card>(null);
  const [category, setCategory] = useState<Category>('terrain');
  const [dockOpen, setDockOpen] = useState(true);
  const lastTiles = useRef<TileGroupId>('terrain');
  const setPalette = (p: 'tiles' | 'objects') => setCategory(p === 'objects' ? 'objects' : lastTiles.current);
  const setPanel = (p: 'inspector' | 'problems') => setCard(p === 'problems' ? 'problems' : null);
  const [openDialog, setOpenDialog] = useState(false);
  const [toast, setToast] = useState<{ text: string; bad?: boolean } | null>(null);

  const notify = (text: string, bad = false) => {
    setToast({ text, bad });
    window.setTimeout(() => setToast(cur => (cur?.text === text ? null : cur)), 2600);
  };

  // --- 3D view and mouse --------------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current!;
    const view = new EditorView(canvas, model);
    viewRef.current = view;
    if (import.meta.env.DEV) (window as unknown as { __editor: EditorView }).__editor = view;
    void view.reload();
    const resize = () => {
      const r = wrapRef.current!.getBoundingClientRect();
      view.resize(r.width, r.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current!);

    let drag: Drag | null = null;
    let space = false;
    const setHover = (p: Point | null) => {
      const h = model.state.get().hover;
      if (h?.x !== p?.x || h?.y !== p?.y) model.state.set({ hover: p });
    };
    const removeTop = (p: Point) => {
      const hits = model.objectsAt(p.x, p.y);
      if (!hits.length) return;
      model.begin();
      model.remove(hits[0]!);
      model.end();
    };
    const select = (p: Point, e: PointerEvent) => {
      const hits = model.objectsAt(p.x, p.y);
      if (!hits.length) {
        model.state.set({ selected: null });
        return;
      }
      const cur = model.state.get().selected;
      const inHits = cur !== null && hits.includes(cur);
      const index = inHits ? cur : hits[0]!;
      model.state.set({ selected: index });
      setPanel('inspector');
      drag = { kind: 'move', index, started: false, from: p, cycle: inHits && !e.shiftKey ? hits : null };
    };

    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      if (e.button === 1 || (e.button === 0 && space)) {
        drag = { kind: 'pan', x: e.clientX, y: e.clientY };
        return;
      }
      const s = model.state.get();
      const p = s.tool === 'rect' ? view.pickClamped(e.clientX, e.clientY) : view.pick(e.clientX, e.clientY);
      if (!p) return;
      const erase = e.button === 2;
      if (e.button === 0 && e.altKey) {
        const name = model.tileAt(p.x, p.y);
        if (name) model.state.set({ tile: name, tool: s.tool === 'rect' || s.tool === 'fill' ? s.tool : 'paint' });
        setPalette('tiles');
        return;
      }
      switch (s.tool) {
        case 'paint': {
          const tile = erase ? 'GROUND' : s.tile;
          model.begin();
          model.setTiles(model.brushPoints(p), tile);
          drag = { kind: 'paint', tile, last: p };
          break;
        }
        case 'rect':
          model.state.set({ rect: { a: p, b: p } });
          drag = { kind: 'rect', tile: erase ? 'GROUND' : s.tile, a: p };
          break;
        case 'fill':
          model.begin();
          model.fill(p, erase ? 'GROUND' : s.tile);
          model.end();
          break;
        case 'object': {
          if (erase) {
            removeTop(p);
            break;
          }
          model.begin();
          const index = model.place(p);
          model.end();
          if (index === null) break;
          model.state.set({ selected: index });
          setPanel('inspector');
          const o = model.doc.objects[index]!;
          if (o.type === 'wormhole' || o.type === 'secret' || o.type === 'cloud' || o.type === 'ufo') model.state.set({ tool: 'link' });
          break;
        }
        case 'select':
          if (erase) removeTop(p);
          else select(p, e);
          break;
        case 'link': {
          if (erase) {
            model.state.set({ tool: 'select' });
            break;
          }
          const sel = s.selected;
          if (sel === null || !model.linksOf(sel)) {
            select(p, e);
            break;
          }
          model.begin();
          model.link(sel, p, e.shiftKey);
          model.end();
          const o = model.doc.objects[sel]!;
          if (o.type === 'wormhole' || o.type === 'secret') model.state.set({ tool: 'select' });
          break;
        }
      }
    };

    const move = (e: PointerEvent) => {
      const s = model.state.get();
      const p = view.pick(e.clientX, e.clientY);
      setHover(p);
      if (!drag) return;
      switch (drag.kind) {
        case 'pan':
          view.panPixels(e.clientX - drag.x, e.clientY - drag.y);
          drag.x = e.clientX;
          drag.y = e.clientY;
          break;
        case 'paint':
          if (!p) break;
          for (const q of line(drag.last, p)) model.setTiles(model.brushPoints(q, s.brush), drag.tile);
          drag.last = p;
          break;
        case 'rect': {
          const b = view.pickClamped(e.clientX, e.clientY);
          if (b) model.state.set({ rect: { a: drag.a, b } });
          break;
        }
        case 'move':
          if (!p || (p.x === drag.from.x && p.y === drag.from.y && !drag.started)) break;
          if (!drag.started) {
            model.begin();
            drag.started = true;
          }
          model.move(drag.index, p);
          drag.index = model.state.get().selected ?? drag.index;
          break;
      }
    };

    const up = () => {
      const d = drag;
      drag = null;
      if (!d) return;
      if (d.kind === 'paint') model.end();
      if (d.kind === 'rect') {
        const rect = model.state.get().rect;
        model.state.set({ rect: null });
        if (rect) {
          model.begin();
          model.setTiles(model.rectPoints(rect.a, rect.b), d.tile);
          model.end();
        }
      }
      if (d.kind === 'move') {
        if (d.started) model.end();
        else if (d.cycle && d.cycle.length > 1) {
          // Clicking the selected object again picks the next one on that tile.
          const at = d.cycle.indexOf(d.index);
          model.state.set({ selected: d.cycle[(at + 1) % d.cycle.length]! });
        }
      }
    };

    const leave = () => setHover(null);
    const menu = (e: Event) => e.preventDefault();
    const keyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTyping(e)) space = true;
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') space = false;
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('pointerleave', leave);
    canvas.addEventListener('contextmenu', menu);
    window.addEventListener('keydown', keyDown);
    window.addEventListener('keyup', keyUp);
    return () => {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('pointerleave', leave);
      canvas.removeEventListener('contextmenu', menu);
      window.removeEventListener('keydown', keyDown);
      window.removeEventListener('keyup', keyUp);
      view.dispose();
      viewRef.current = null;
    };
  }, [model]);

  // --- file actions --------------------------------------------------------------------
  const save = () => {
    const level = model.level();
    try {
      saveCustomLevel(level);
      model.markSaved();
      notify(t('editor.saved'));
    } catch (err) {
      notify((err as Error).message, true);
    }
  };
  const saveContent = async () => {
    const level = model.level();
    try {
      await saveToContent(level);
      model.markSaved();
      notify(t('editor.savedContent', { id: level.id }));
    } catch (err) {
      notify((err as Error).message, true);
    }
  };
  const newLevel = (mode: LevelData['mode']) => {
    if (s.dirty && !confirm(t('editor.confirmNew'))) return;
    model.camera = null;
    model.load(blankLevel(mode));
  };
  const importFile = async (e: JSX.TargetedEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = '';
    if (!file) return;
    try {
      model.load(await readLevelFile(file));
    } catch (err) {
      notify((err as Error).message, true);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(model.level()));
      notify(t('editor.copied'));
    } catch (err) {
      notify((err as Error).message, true);
    }
  };
  const test = () => {
    const errors = s.issues.filter(i => i.severity === 'error');
    if (errors.length && !confirm(`${t('editor.errorsBlock')}\n\n${errors.map(i => `• ${issueText(i)}`).join('\n')}`)) {
      setPanel('problems');
      return;
    }
    viewRef.current?.saveCamera();
    onTest(testLaunch(model.level()));
  };

  // --- keyboard ------------------------------------------------------------------------------
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const mod = e.ctrlKey || e.metaKey;
      const st = model.state.get();
      if (mod && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) model.redo();
        else model.undo();
        return;
      }
      if (mod && e.code === 'KeyY') {
        e.preventDefault();
        model.redo();
        return;
      }
      if (mod && e.code === 'KeyS') {
        e.preventDefault();
        save();
        return;
      }
      if (mod || e.altKey) return;
      const tools: Record<string, EditorTool> = { KeyB: 'paint', KeyR: 'rect', KeyG: 'fill', KeyO: 'object', KeyV: 'select', KeyL: 'link' };
      const tool = tools[e.code];
      if (tool) {
        model.state.set({ tool });
        if (tool === 'object') setPalette('objects');
        if (tool === 'paint' || tool === 'rect' || tool === 'fill') setPalette('tiles');
        return;
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && st.selected !== null) {
        model.begin();
        model.remove(st.selected);
        model.end();
        return;
      }
      if (e.code === 'Escape') {
        if (st.tool === 'link') model.state.set({ tool: 'select' });
        else model.state.set({ selected: null });
        return;
      }
      if (e.code === 'BracketLeft') model.state.set({ brush: Math.max(1, st.brush - 1) });
      if (e.code === 'BracketRight') model.state.set({ brush: Math.min(5, st.brush + 1) });
      if (e.code === 'KeyF' && st.selected !== null) {
        const o = model.doc.objects[st.selected];
        if (o) viewRef.current?.focus(o);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [model]);

  // Leaving with unsaved work: the autosave keeps it, but warn on closing the tab.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (model.state.get().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [model]);

  const errors = s.issues.filter(i => i.severity === 'error').length;
  const warnings = s.issues.length - errors;
  const meta = model.doc.meta;
  const hoverTile = s.hover ? model.tileAt(s.hover.x, s.hover.y) : undefined;

  const pickCategory = (c: Category) => {
    setCategory(c);
    setDockOpen(true);
    if (c !== 'objects' && c !== 'items') lastTiles.current = c;
  };
  const showInspector = card === null && s.selected !== null;

  return (
    <div class={`editor ${dockOpen ? '' : 'dock-low'}`}>
      <main class="editor-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} class={`editor-canvas tool-${s.tool}`} />
      </main>

      <div class="ed-float ed-topleft">
        <button class="icon-btn ghost" onClick={back} title={t('menu.back')}>
          <ArrowLeft size={18} />
        </button>
        <div class="editor-title">
          <strong>
            {localized(meta.name) || meta.id}
            {s.dirty ? <span class="dirty-dot" title="●" /> : null}
          </strong>
          <span class="muted">
            {t(`editor.${meta.mode}` as Key)} · {t(`editor.themes.${meta.theme}` as Key)} · {model.width}×{model.height}
          </span>
        </div>
        <FileMenu
          items={[
            { icon: <FilePlus size={15} />, label: t('editor.newQuest'), run: () => newLevel('quest') },
            { icon: <Swords size={15} />, label: t('editor.newBattle'), run: () => newLevel('battle') },
            { icon: <FolderOpen size={15} />, label: t('editor.open'), run: () => setOpenDialog(true) },
            null,
            { icon: <Save size={15} />, label: t('editor.save'), hint: 'Ctrl+S', run: save },
            ...(import.meta.env.DEV ? [{ icon: <HardDrive size={15} />, label: t('editor.saveContent'), run: () => void saveContent() }] : []),
            null,
            { icon: <Download size={15} />, label: t('editor.export'), run: () => downloadLevel(model.level()) },
            { icon: <Upload size={15} />, label: t('editor.import'), run: () => fileRef.current?.click() },
            { icon: <Copy size={15} />, label: t('editor.copy'), run: () => void copy() },
          ]}
        />
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={e => void importFile(e)} />
      </div>

      <div class="ed-float ed-topright">
        <button class="icon-btn ghost" disabled={!s.canUndo} title={`${t('editor.undo')} (Ctrl+Z)`} onClick={() => model.undo()}>
          <Undo2 size={17} />
        </button>
        <button class="icon-btn ghost" disabled={!s.canRedo} title={`${t('editor.redo')} (Ctrl+Y)`} onClick={() => model.redo()}>
          <Redo2 size={17} />
        </button>
        <button class={`icon-btn ghost ${s.showGrid ? 'active' : ''}`} title={t('editor.grid')} onClick={() => model.state.set({ showGrid: !s.showGrid })}>
          <Grid3x3 size={17} />
        </button>
        <span class="ed-sep" />
        <button class={`ghost ${card === 'level' ? 'active' : ''}`} onClick={() => setCard(card === 'level' ? null : 'level')}>
          <Settings2 size={16} /> {t('editor.level')}
        </button>
        <button class={`ghost ${card === 'problems' ? 'active' : ''}`} onClick={() => setCard(card === 'problems' ? null : 'problems')} title={t('editor.problems')}>
          <TriangleAlert size={16} />
          {errors > 0 && <span class="badge bad">{errors}</span>}
          {warnings > 0 && <span class="badge warn">{warnings}</span>}
          {errors + warnings === 0 && <Check size={14} />}
        </button>
        <button class="primary" onClick={test}>
          <Play size={15} /> {t('editor.test')}
        </button>
      </div>

      <ToolRail model={model} tool={s.tool} brush={s.brush} setPalette={setPalette} />

      {(card || showInspector) && (
        <div class="ed-float ed-card">
          <div class="ed-card-head">
            <strong>{card === 'level' ? t('editor.level') : card === 'problems' ? t('editor.problems') : t('editor.inspector')}</strong>
            <button class="icon-btn ghost" onClick={() => (card ? setCard(null) : model.state.set({ selected: null }))} title="Esc">
              <X size={16} />
            </button>
          </div>
          <div class="ed-card-body">
            {card === 'level' && <LevelPanel model={model} revision={s.revision} />}
            {card === 'problems' && <Problems model={model} view={viewRef} />}
            {card === null && <Inspector model={model} selected={s.selected} revision={s.revision} />}
          </div>
        </div>
      )}

      <Dock
        model={model}
        theme={meta.theme}
        mode={meta.mode}
        category={category}
        setCategory={pickCategory}
        open={dockOpen}
        setOpen={setDockOpen}
      />

      {s.hover && hoverTile && (
        <div class={`ed-status ${dockOpen ? '' : 'low'}`}>{t('editor.tileInfo', { x: s.hover.x, y: s.hover.y, tile: tileLabel(hoverTile) })}</div>
      )}
      {s.tool === 'link' && <LinkHint model={model} selected={s.selected} />}
      {toast && <div class={`editor-toast ${toast.bad ? 'bad' : ''}`}>{toast.text}</div>}

      {openDialog && (
        <OpenDialog
          close={() => setOpenDialog(false)}
          open={level => {
            if (s.dirty && !confirm(t('editor.confirmNew'))) return;
            model.camera = null;
            model.load(level);
            setOpenDialog(false);
          }}
          play={level => onTest(testLaunch(level))}
        />
      )}
    </div>
  );
}

interface MenuItem {
  icon: JSX.Element;
  label: string;
  hint?: string;
  run: () => void;
}

/** Drop-down with the less frequent file actions. */
function FileMenu({ items }: { items: (MenuItem | null)[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div class="ed-menu" ref={ref}>
      <button class={`ghost ${open ? 'active' : ''}`} onClick={() => setOpen(!open)}>
        <MenuIcon size={16} /> {t('editor.file')}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div class="ed-menu-list">
          {items.map(item =>
            item ? (
              <button
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                {item.icon}
                <span class="grow">{item.label}</span>
                {item.hint && <kbd>{item.hint}</kbd>}
              </button>
            ) : (
              <hr />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/** Tiles along a segment (so fast brush strokes leave no gaps). */
function line(a: Point, b: Point): Point[] {
  const out: Point[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

// --- left side ----------------------------------------------------------------------------

const TOOL_ICONS: Record<EditorTool, [JSX.Element, string]> = {
  select: [<MousePointer2 size={17} />, 'V'],
  paint: [<Brush size={17} />, 'B'],
  rect: [<RectangleHorizontal size={17} />, 'R'],
  fill: [<PaintBucket size={17} />, 'G'],
  object: [<Plus size={17} />, 'O'],
  link: [<Link size={17} />, 'L'],
};

function ToolRail({ model, tool, brush, setPalette }: { model: EditorModel; tool: EditorTool; brush: number; setPalette: (p: 'tiles' | 'objects') => void }) {
  const pick = (next: EditorTool) => {
    model.state.set({ tool: next });
    if (next === 'object') setPalette('objects');
    if (next === 'paint' || next === 'rect' || next === 'fill') setPalette('tiles');
  };
  return (
    <div class="ed-float ed-rail">
      {(Object.keys(TOOL_ICONS) as EditorTool[]).map(id => (
        <button class={`tool-btn ghost ${tool === id ? 'active' : ''}`} title={`${t(`editor.${id}` as Key)} (${TOOL_ICONS[id][1]})`} onClick={() => pick(id)}>
          {TOOL_ICONS[id][0]}
        </button>
      ))}
      {tool === 'paint' && (
        <div class="rail-brush" title={t('editor.brush')}>
          {[1, 2, 3, 5].map(n => (
            <button class={`tool-btn small ghost ${brush === n ? 'active' : ''}`} onClick={() => model.state.set({ brush: n })}>
              {n}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Bottom dock: category tabs over a row of big picture cards (tiles, map objects, items).
 * Collapses to just the tabs to show more of the map.
 */
function Dock({
  model,
  theme,
  mode,
  category,
  setCategory,
  open,
  setOpen,
}: {
  model: EditorModel;
  theme: ThemeId;
  mode: LevelData['mode'];
  category: Category;
  setCategory: (c: Category) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
}) {
  useThumbnails();
  const s = useStore(model.state);
  const [team, setTeam] = useState(0);
  const template = s.template;
  const kind = templateKind(template);
  const choose = (tpl: ObjectTemplate) => model.state.set({ template: tpl, tool: 'object' });
  const pickTile = (tile: string) => model.state.set({ tile, tool: s.tool === 'rect' || s.tool === 'fill' || s.tool === 'paint' ? s.tool : 'paint' });
  const setTeamAll = (n: number) => {
    setTeam(n);
    if ((template.type === 'grunt' && !template.ai) || template.type === 'fort' || template.type === 'pad') choose({ ...template, team: n } as ObjectTemplate);
  };
  const group = TILE_GROUPS.find(g => g.id === category);
  return (
    <div class={`ed-float ed-dock ${open ? '' : 'collapsed'}`}>
      <div class="dock-tabs">
        {TILE_GROUPS.map(g => (
          <button class={`ghost ${category === g.id ? 'active' : ''}`} onClick={() => setCategory(g.id)}>
            {groupLabel(g.id)}
          </button>
        ))}
        <span class="ed-sep" />
        <button class={`ghost ${category === 'objects' ? 'active' : ''}`} onClick={() => setCategory('objects')}>
          <Shapes size={14} /> {t('editor.objects')}
        </button>
        <button class={`ghost ${category === 'items' ? 'active' : ''}`} onClick={() => setCategory('items')}>
          <Package size={14} /> {t('editor.items')}
        </button>
        <span class="grow" />
        {mode === 'battle' && (category === 'objects' || category === 'items') && (
          <span class="team-pick">
            {[0, 1, 2, 3].map(n => (
              <button class={`team-dot ${team === n ? 'active' : ''}`} style={{ background: hex(TEAM_COLORS[n]!) }} onClick={() => setTeamAll(n)} title={`${t('editor.team')} ${n + 1}`} />
            ))}
          </span>
        )}
        <button class="icon-btn ghost" onClick={() => setOpen(!open)} title={open ? t('editor.hideDock') : t('editor.showDock')}>
          {open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {open && (
        <div class="dock-row">
          {group &&
            group.tiles.map(name => (
              <button class={`dock-card ${s.tile === name && s.tool !== 'object' ? 'active' : ''}`} title={name} onClick={() => pickTile(name)}>
                <TileCardArt name={name} theme={theme} />
                <span class="dock-label">{tileLabel(name)}</span>
              </button>
            ))}
          {category === 'objects' &&
            OBJECT_KINDS.map(k => (
              <button class={`dock-card ${kind === k.id && s.tool === 'object' ? 'active' : ''}`} onClick={() => choose(k.template(team, mode))}>
                <span class="card-art">
                  <ObjectThumb id={k.id} theme={theme} obj={{ x: 0, y: 0, ...k.template(0, mode) } as LevelObject} fallback={k.icon} size={76} />
                </span>
                <span class="dock-label">{t(`editor.objectTypes.${k.id}` as Key)}</span>
              </button>
            ))}
          {category === 'items' &&
            ALL_ITEMS.map(item => (
              <button
                class={`dock-card ${template.type === 'pickup' && template.item === item && s.tool === 'object' ? 'active' : ''}`}
                onClick={() => choose({ type: 'pickup', item })}
              >
                <span class="card-art item-art">
                  <ItemImg item={item} size={60} />
                </span>
                <span class="dock-label">{itemName(item)}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}

const OBJECT_KINDS: { id: string; icon: string; template: (team: number, mode: LevelData['mode']) => ObjectTemplate }[] = [
  { id: 'grunt', icon: '🙂', template: (team, mode) => (mode === 'battle' ? { type: 'grunt', team } : { type: 'grunt' }) },
  { id: 'enemy', icon: '😠', template: () => ({ type: 'grunt', ai: 'Chaser', tool: 'CLUB' }) },
  { id: 'pickup', icon: '🎁', template: () => ({ type: 'pickup', item: 'GAUNTLETZ' }) },
  { id: 'fort', icon: '🏰', template: (team, mode) => (mode === 'battle' ? { type: 'fort', team } : { type: 'fort' }) },
  { id: 'pad', icon: '⬡', template: (team, mode) => (mode === 'battle' ? { type: 'pad', team } : { type: 'pad' }) },
  { id: 'wormhole', icon: '🌀', template: () => ({ type: 'wormhole', color: 'green', tx: 0, ty: 0 }) },
  { id: 'brickz', icon: '🧱', template: () => ({ type: 'brickz', layers: ['brown'] }) },
  { id: 'puddle', icon: '💧', template: () => ({ type: 'puddle' }) },
  { id: 'flag', icon: '🏁', template: () => ({ type: 'flag' }) },
  { id: 'ball', icon: '🎱', template: () => ({ type: 'ball', dir: 2 }) },
  { id: 'help', icon: '📖', template: () => ({ type: 'help', text: { en: '', pl: '' } }) },
  { id: 'secret', icon: '✦', template: () => ({ type: 'secret', wx: 0, wy: 0 }) },
  { id: 'giantRock', icon: '🪨', template: () => ({ type: 'giantRock' }) },
  { id: 'hazard', icon: '🌋', template: () => ({ type: 'hazard', period: 2000 }) },
  { id: 'dropper', icon: '🐦', template: () => ({ type: 'dropper', dir: 2 }) },
  { id: 'cloud', icon: '⛈', template: () => ({ type: 'cloud', points: [] }) },
  { id: 'ufo', icon: '🛸', template: () => ({ type: 'ufo', points: [] }) },
  { id: 'spotlight', icon: '🔦', template: () => ({ type: 'spotlight', radius: 2 }) },
  { id: 'slime', icon: '🟢', template: () => ({ type: 'slime', x1: 0, y1: 0 }) },
];

function templateKind(t: ObjectTemplate): string {
  if (t.type === 'grunt') return t.ai ? 'enemy' : 'grunt';
  return t.type;
}

function ItemGrid({ current, pick, items = ALL_ITEMS }: { current?: string; pick: (item: ItemId) => void; items?: readonly ItemId[] }) {
  return (
    <div class="item-grid">
      {items.map(item => (
        <button class={`item-btn ${current === item ? 'active' : ''}`} title={itemName(item)} onClick={() => pick(item)}>
          <ItemImg item={item} size={30} />
        </button>
      ))}
    </div>
  );
}

// --- canvas overlays --------------------------------------------------------------------------

function LinkHint({ model, selected }: { model: EditorModel; selected: number | null }) {
  const o = selected === null ? undefined : model.doc.objects[selected];
  const key: Key =
    o?.type === 'wormhole'
      ? 'editor.linkWormhole'
      : o?.type === 'secret'
        ? 'editor.linkSecret'
        : o?.type === 'cloud' || o?.type === 'ufo'
          ? 'editor.linkPath'
          : o?.type === 'slime'
            ? 'editor.linkSlime'
            : 'editor.linkHint';
  return <div class="editor-hint">{o && model.linksOf(selected) ? t(key) : t('editor.nothingSelected')}</div>;
}

// --- right side -------------------------------------------------------------------------------

function Field({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return (
    <label class="ed-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberInput({ value, onChange, min, max, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={e => {
        const v = Number(e.currentTarget.value);
        if (Number.isFinite(v)) onChange(v);
      }}
    />
  );
}

function Select<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T | undefined;
  options: readonly T[];
  onChange: (v: T | undefined) => void;
  label: (v: T) => string;
}) {
  return (
    <select
      value={value === undefined ? '' : String(value)}
      onChange={e => {
        const raw = e.currentTarget.value;
        if (raw === '') return onChange(undefined);
        const found = options.find(o => String(o) === raw);
        onChange(found);
      }}
    >
      <option value="">{t('editor.none')}</option>
      {options.map(o => (
        <option value={String(o)}>{label(o)}</option>
      ))}
    </select>
  );
}

const TICKS_PER_SECOND = 20;
const toSec = (ticks: number | undefined) => Math.round(((ticks ?? 0) / TICKS_PER_SECOND) * 100) / 100;
const toTicks = (sec: number) => Math.max(0, Math.round(sec * TICKS_PER_SECOND));

function Inspector({ model, selected }: { model: EditorModel; selected: number | null; revision: number }) {
  const o = selected === null ? undefined : model.doc.objects[selected];
  if (!o || selected === null) return <p class="muted pad">{t('editor.nothingSelected')}</p>;
  const mode = model.doc.meta.mode;
  const set = (patch: Record<string, unknown>) => {
    model.begin();
    model.update(selected, patch as Partial<LevelObject>);
    model.end();
  };
  const kindLabel = t(`editor.objectTypes.${o.type === 'grunt' && o.ai ? 'enemy' : o.type}` as Key);
  const teamSelect = (value: number | undefined) =>
    mode === 'battle' && (
      <Field label={t('editor.team')}>
        <div class="team-pick">
          {[0, 1, 2, 3].map(n => (
            <button class={`team-dot ${(value ?? 0) === n ? 'active' : ''}`} style={{ background: hex(TEAM_COLORS[n]!) }} onClick={() => set({ team: n })}>
              {n + 1}
            </button>
          ))}
        </div>
      </Field>
    );
  const linkButtons = (
    <div class="row">
      <button onClick={() => model.state.set({ tool: 'link' })}>🔗 {t('editor.editLinks')}</button>
      {o.type === 'switch' && (
        <button onClick={() => set({ targets: [], partners: undefined })} disabled={o.targets.length === 0 && !o.partners?.length}>
          {t('editor.clearLinks')}
        </button>
      )}
    </div>
  );

  let body: preact.ComponentChildren = null;
  switch (o.type) {
    case 'grunt':
      body = (
        <>
          {mode === 'quest' && (
            <Field label={t('editor.ai')}>
              <Select value={o.ai} options={AI_TYPES} label={aiName} onChange={v => set({ ai: v })} />
            </Field>
          )}
          {teamSelect(o.team)}
          <Field label={t('editor.tool')}>
            <Select value={o.tool} options={TOOLS as readonly CombatTool[]} label={itemName} onChange={v => set({ tool: v })} />
          </Field>
          <Field label={t('editor.toy')}>
            <Select value={o.toy} options={TOYS as readonly ToyId[]} label={itemName} onChange={v => set({ toy: v })} />
          </Field>
          {o.ai && (
            <Field label={t('editor.alert')}>
              <NumberInput value={o.alert ?? 0} min={0} max={20} onChange={v => set({ alert: v || undefined })} />
            </Field>
          )}
          <Field label={t('editor.facing')}>
            <DirPicker value={o.facing ?? 4} onChange={d => set({ facing: d === 4 ? undefined : d })} />
          </Field>
        </>
      );
      break;
    case 'pickup':
      body = (
        <>
          <Field label={t('editor.item')}>
            <span class="row">
              <ItemImg item={o.item} size={32} /> {itemName(o.item)}
            </span>
          </Field>
          <ItemGrid current={o.item} pick={item => set({ item })} />
          <label class="toggle">
            <input type="checkbox" checked={!!o.hidden} onChange={e => set({ hidden: e.currentTarget.checked || undefined })} />
            {t('editor.hidden')}
          </label>
          {(o.item === 'SCROLL' || o.item === 'WAND') && (
            <Field label={t('editor.spell')}>
              <Select value={o.spell} options={SPELLS} label={v => v} onChange={v => set({ spell: v })} />
            </Field>
          )}
          <Field label={t('editor.respawn')}>
            <NumberInput value={toSec(o.respawn)} min={0} step={1} onChange={v => set({ respawn: toTicks(v) || undefined })} />
          </Field>
        </>
      );
      break;
    case 'switch': {
      const kind = tileByName(model.tileAt(o.x, o.y) ?? 'GROUND').switchKind;
      body = (
        <>
          <p class="muted">
            {tileLabel(model.tileAt(o.x, o.y) ?? '')} · {t('editor.targets', { n: o.targets.length })}
            {kind === 'orange' ? ` · ${t('editor.partners', { n: o.partners?.length ?? 0 })}` : ''}
          </p>
          {linkButtons}
          <Field label={t('editor.delay')}>
            <NumberInput value={toSec(o.delay)} min={0} step={0.5} onChange={v => set({ delay: toTicks(v) || undefined })} />
          </Field>
          {(kind === 'time' || kind === 'secret' || kind === 'green' || kind === 'blue') && (
            <Field label={t('editor.duration')}>
              <NumberInput value={toSec(o.duration)} min={0} step={0.5} onChange={v => set({ duration: toTicks(v) || undefined })} />
            </Field>
          )}
          {(kind === 'many' || kind === 'checkpoint') && (
            <Field label={t('editor.group')}>
              <NumberInput value={o.group ?? 0} min={0} max={99} onChange={v => set({ group: v || undefined })} />
            </Field>
          )}
          {kind === 'checkpoint' && (
            <Field label={t('editor.requires')}>
              <Select value={o.requires} options={[...TOOLS, ...TOYS] as ItemId[]} label={itemName} onChange={v => set({ requires: v })} />
            </Field>
          )}
        </>
      );
      break;
    }
    case 'fort':
    case 'pad':
      body = teamSelect(o.team);
      break;
    case 'wormhole':
      body = (
        <>
          <p class="muted">{t('editor.dest', { x: o.tx, y: o.ty })}</p>
          {linkButtons}
          <Field label={t('editor.color')}>
            <div class="row">
              {(['green', 'blue', 'red'] as const).map(c => (
                <button class={`color-dot ${o.color === c ? 'active' : ''}`} style={{ background: { green: '#4ac04a', blue: '#3a7ad8', red: '#d83a3a' }[c] }} onClick={() => set({ color: c })} />
              ))}
            </div>
          </Field>
          {o.color === 'red' && (
            <label class="toggle">
              <input type="checkbox" checked={!!o.open} onChange={e => set({ open: e.currentTarget.checked || undefined })} />
              {t('editor.open2')}
            </label>
          )}
        </>
      );
      break;
    case 'brickz':
      body = (
        <Field label={t('editor.layers')}>
          <div class="brick-layers">
            {[0, 1, 2].map(i => (
              <Select
                value={o.layers[i]}
                options={BRICK_COLORS}
                label={c => itemName(c)}
                onChange={c => {
                  const layers = o.layers.slice();
                  if (c) layers[i] = c;
                  else layers.splice(i);
                  set({ layers: layers.filter(Boolean).length ? (layers.filter(Boolean) as BrickColor[]) : ['brown'] });
                }}
              />
            ))}
          </div>
        </Field>
      );
      break;
    case 'ball':
      body = (
        <>
          <Field label={t('editor.direction')}>
            <DirPicker value={o.dir} onChange={d => set({ dir: d })} />
          </Field>
          <Field label={t('editor.rate')}>
            <NumberInput value={o.rate ?? 12} min={2} max={60} onChange={v => set({ rate: v === 12 ? undefined : v })} />
          </Field>
          <Field label={t('editor.every')}>
            <NumberInput value={toSec(o.every)} min={0} step={0.5} onChange={v => set({ every: toTicks(v) || undefined })} />
          </Field>
        </>
      );
      break;
    case 'help':
      body = (
        <>
          <Field label={t('editor.textEn')}>
            <textarea rows={4} value={o.text.en} onChange={e => set({ text: { ...o.text, en: e.currentTarget.value } })} />
          </Field>
          <Field label={t('editor.textPl')}>
            <textarea rows={4} value={o.text.pl} onChange={e => set({ text: { ...o.text, pl: e.currentTarget.value } })} />
          </Field>
        </>
      );
      break;
    case 'secret':
      body = (
        <>
          <p class="muted">{t('editor.dest', { x: o.wx, y: o.wy })}</p>
          {linkButtons}
          <Field label={t('editor.duration')}>
            <NumberInput value={Math.round((o.duration ?? 8000) / 100) / 10} min={1} step={1} onChange={v => set({ duration: v === 8 ? undefined : Math.round(v * 1000) })} />
          </Field>
        </>
      );
      break;
    case 'puddle':
    case 'flag':
    case 'giantRock':
      body = null;
      break;
    case 'hazard':
      body = (
        <>
          <p class="muted">{t('editor.hazardHint')}</p>
          <Field label={t('editor.delay')}>
            <NumberInput value={(o.delay ?? 0) / 1000} min={0} step={0.5} onChange={v => set({ delay: Math.round(v * 1000) || undefined })} />
          </Field>
          <Field label={t('editor.period')}>
            <NumberInput value={(o.period ?? 2000) / 1000} min={0.5} step={0.5} onChange={v => set({ period: Math.round(v * 1000) })} />
          </Field>
        </>
      );
      break;
    case 'dropper':
      body = (
        <>
          <Field label={t('editor.direction')}>
            <div class="row">
              {([0, 2, 4, 6] as Dir[]).map(d => (
                <button class={o.dir === d ? 'active' : ''} onClick={() => set({ dir: d })}>
                  {DIR_GLYPH[d]}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t('editor.speedMs')}>
            <NumberInput value={o.rate ?? 600} min={100} step={50} onChange={v => set({ rate: v === 600 ? undefined : v })} />
          </Field>
          <Field label={t('editor.offset')}>
            <NumberInput value={o.offset ?? 0} min={0} max={200} onChange={v => set({ offset: v || undefined })} />
          </Field>
        </>
      );
      break;
    case 'cloud':
    case 'ufo':
      body = (
        <>
          <p class="muted">{t('editor.pathPoints', { n: o.points.length })}</p>
          {linkButtons}
          <Field label={t('editor.speedMs')}>
            <NumberInput value={o.rate ?? 800} min={100} step={50} onChange={v => set({ rate: v === 800 ? undefined : v })} />
          </Field>
          <Field label={t('editor.pause')}>
            <NumberInput value={(o.pause ?? 0) / 1000} min={0} step={0.5} onChange={v => set({ pause: Math.round(v * 1000) || undefined })} />
          </Field>
          {o.type === 'ufo' && (
            <label class="toggle">
              <input type="checkbox" checked={o.clockwise !== false} onChange={e => set({ clockwise: e.currentTarget.checked ? undefined : false })} />
              {t('editor.clockwise')}
            </label>
          )}
        </>
      );
      break;
    case 'spotlight':
      body = (
        <>
          <Field label={t('editor.radius')}>
            <NumberInput value={o.radius} min={1} max={10} onChange={v => set({ radius: v })} />
          </Field>
          <Field label={t('editor.turnMs')}>
            <NumberInput value={o.rate ?? 3000} min={500} step={250} onChange={v => set({ rate: v === 3000 ? undefined : v })} />
          </Field>
          <label class="toggle">
            <input type="checkbox" checked={o.clockwise !== false} onChange={e => set({ clockwise: e.currentTarget.checked ? undefined : false })} />
            {t('editor.clockwise')}
          </label>
        </>
      );
      break;
    case 'slime':
      body = (
        <>
          <p class="muted">{t('editor.slimeHint', { x: o.x1, y: o.y1 })}</p>
          {linkButtons}
          <Field label={t('editor.speedMs')}>
            <NumberInput value={o.rate ?? 1000} min={100} step={50} onChange={v => set({ rate: v === 1000 ? undefined : v })} />
          </Field>
          <label class="toggle">
            <input type="checkbox" checked={o.clockwise !== false} onChange={e => set({ clockwise: e.currentTarget.checked ? undefined : false })} />
            {t('editor.clockwise')}
          </label>
        </>
      );
      break;
  }
  return (
    <div class="inspector">
      <h3>
        {kindLabel} <span class="muted">({o.x}, {o.y})</span>
      </h3>
      {body}
      <button
        class="danger"
        onClick={() => {
          model.begin();
          model.remove(selected);
          model.end();
        }}
      >
        {t('editor.delete')}
      </button>
    </div>
  );
}

function DirPicker({ value, onChange }: { value: Dir; onChange: (d: Dir) => void }) {
  // 3x3 compass, north on top.
  const layout: (Dir | null)[] = [7, 0, 1, 6, null, 2, 5, 4, 3];
  return (
    <div class="dir-picker">
      {layout.map(d =>
        d === null ? (
          <span />
        ) : (
          <button class={value === d ? 'active' : ''} onClick={() => onChange(d)}>
            {DIR_GLYPH[d]}
          </button>
        ),
      )}
    </div>
  );
}

function LevelPanel({ model }: { model: EditorModel; revision: number }) {
  const meta = model.doc.meta;
  const [size, setSize] = useState({ w: model.width, h: model.height, anchor: 4 });
  useEffect(() => setSize(s => ({ ...s, w: model.width, h: model.height })), [model.width, model.height]);
  const set = (patch: Record<string, unknown>) => {
    model.begin();
    model.setMeta(patch);
    model.end();
  };
  const applySize = () => {
    const w = Math.max(8, Math.min(128, size.w));
    const h = Math.max(8, Math.min(128, size.h));
    const ax = size.anchor % 3;
    const ay = Math.floor(size.anchor / 3);
    const ox = ax === 0 ? 0 : ax === 1 ? Math.floor((w - model.width) / 2) : w - model.width;
    const oy = ay === 0 ? 0 : ay === 1 ? Math.floor((h - model.height) / 2) : h - model.height;
    model.begin();
    model.resize(w, h, ox, oy);
    model.end();
  };
  const list = (key: 'megaphone' | 'resources') => {
    const items = (meta[key] ?? []) as ItemId[];
    return (
      <div class="item-list">
        {items.map((item, i) => (
          <button
            class="item-chip"
            title={itemName(item)}
            onClick={() => {
              const next = items.slice();
              next.splice(i, 1);
              set({ [key]: next.length ? next : undefined });
            }}
          >
            <ItemImg item={item} size={24} />
            <span>×</span>
          </button>
        ))}
        <select
          value=""
          onChange={e => {
            const v = e.currentTarget.value as ItemId;
            if (v) set({ [key]: [...items, v] });
          }}
        >
          <option value="">{t('editor.add')}</option>
          {ALL_ITEMS.map(i => (
            <option value={i}>{itemName(i)}</option>
          ))}
          {key === 'resources' &&
            BRICK_COLORS.map(c => (
              <option value={c}>{itemName(c)}</option>
            ))}
        </select>
      </div>
    );
  };
  return (
    <div class="level-panel">
      <Field label={t('editor.id')}>
        <input value={meta.id} onChange={e => set({ id: e.currentTarget.value.trim().toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
      </Field>
      <Field label={t('editor.nameEn')}>
        <input value={meta.name.en} onChange={e => set({ name: { ...meta.name, en: e.currentTarget.value } })} />
      </Field>
      <Field label={t('editor.namePl')}>
        <input value={meta.name.pl} onChange={e => set({ name: { ...meta.name, pl: e.currentTarget.value } })} />
      </Field>
      <Field label={t('editor.mode')}>
        <select value={meta.mode} onChange={e => set({ mode: e.currentTarget.value, players: e.currentTarget.value === 'battle' ? (meta.players ?? 2) : undefined })}>
          <option value="quest">{t('editor.quest')}</option>
          <option value="battle">{t('editor.battle')}</option>
        </select>
      </Field>
      <Field label={t('editor.theme')}>
        <select value={meta.theme} onChange={e => set({ theme: e.currentTarget.value })}>
          {THEMES.map(th => (
            <option value={th}>{t(`editor.themes.${th}` as Key)}</option>
          ))}
        </select>
      </Field>
      {meta.mode === 'battle' ? (
        <Field label={t('editor.players')}>
          <NumberInput value={meta.players ?? 2} min={2} max={4} onChange={v => set({ players: Math.max(2, Math.min(4, v)) })} />
        </Field>
      ) : (
        <div class="row">
          <Field label={t('editor.worldNo')}>
            <NumberInput value={meta.world ?? 0} min={0} max={9} onChange={v => set({ world: v || undefined })} />
          </Field>
          <Field label={t('editor.index')}>
            <NumberInput value={meta.index ?? 0} min={0} max={99} onChange={v => set({ index: v || undefined })} />
          </Field>
        </div>
      )}
      <div class="row">
        <Field label={t('editor.ovens')}>
          <NumberInput value={meta.ovens ?? 3} min={0} max={6} onChange={v => set({ ovens: v === 3 ? undefined : v })} />
        </Field>
        <Field label={t('editor.autoToggle')}>
          <NumberInput value={(meta.autoToggleMs ?? 3000) / 1000} min={0.5} step={0.5} onChange={v => set({ autoToggleMs: v === 3 ? undefined : Math.round(v * 1000) })} />
        </Field>
      </div>
      {meta.mode === 'quest' ? (
        <Field label={t('editor.megaphone')}>{list('megaphone')}</Field>
      ) : (
        <Field label={t('editor.resources')}>{list('resources')}</Field>
      )}

      <h4>{t('editor.size')}</h4>
      <div class="row">
        <Field label={t('editor.width')}>
          <NumberInput value={size.w} min={8} max={128} onChange={w => setSize({ ...size, w })} />
        </Field>
        <Field label={t('editor.height')}>
          <NumberInput value={size.h} min={8} max={128} onChange={h => setSize({ ...size, h })} />
        </Field>
        <Field label={t('editor.anchor')}>
          <div class="anchor-picker">
            {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => (
              <button class={size.anchor === i ? 'active' : ''} onClick={() => setSize({ ...size, anchor: i })} />
            ))}
          </div>
        </Field>
      </div>
      <div class="row">
        <button onClick={applySize} disabled={size.w === model.width && size.h === model.height}>
          {t('editor.apply')}
        </button>
        <button
          onClick={() => {
            model.begin();
            model.mirror('x');
            model.end();
          }}
        >
          {t('editor.mirrorX')}
        </button>
        <button
          onClick={() => {
            model.begin();
            model.mirror('y');
            model.end();
          }}
        >
          {t('editor.mirrorY')}
        </button>
      </div>
    </div>
  );
}

function issueText(issue: { code: string; x?: number; y?: number }): string {
  const params: Record<string, string | number> = {};
  if (issue.y === -1 && issue.x !== undefined) params.team = issue.x + 1;
  return t(`editor.issue.${issue.code}` as Key, params);
}

function Problems({ model, view }: { model: EditorModel; view: { current: EditorView | null } }) {
  const issues = model.state.get().issues;
  if (!issues.length) return <p class="ok pad">✓ {t('editor.noProblems')}</p>;
  return (
    <ul class="issues">
      {issues.map(issue => (
        <li
          class={issue.severity}
          onClick={() => {
            if (issue.object !== undefined) model.state.set({ selected: issue.object });
            if (issue.x !== undefined && issue.y !== undefined && issue.y >= 0) view.current?.focus({ x: issue.x, y: issue.y });
          }}
        >
          <span class="issue-icon">{issue.severity === 'error' ? '⛔' : '⚠'}</span>
          <span>{issueText(issue)}</span>
          {issue.x !== undefined && issue.y !== undefined && issue.y >= 0 && (
            <span class="muted">
              {' '}
              ({issue.x}, {issue.y})
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function OpenDialog({ close, open, play }: { close: () => void; open: (l: LevelData) => void; play: (l: LevelData) => void }) {
  const [custom, setCustom] = useState(customLevels);
  const [paste, setPaste] = useState('');
  const [error, setError] = useState('');
  return (
    <div class="overlay" onClick={close}>
      <div class="panel wide editor-open" onClick={e => e.stopPropagation()}>
        <h2>{t('editor.open')}</h2>
        <div class="editor-open-cols">
          <section>
            <h4>{t('editor.custom')}</h4>
            {custom.length === 0 && <p class="muted">{t('editor.noCustom')}</p>}
            {custom.map(l => (
              <div class="open-row">
                <button class="grow" onClick={() => open(structuredClone(l))}>
                  {localized(l.name)} <span class="muted">· {l.id}</span>
                </button>
                <button onClick={() => play(l)}>▶</button>
                <button
                  class="danger"
                  onClick={() => {
                    if (!confirm(t('editor.confirmDelete', { name: localized(l.name) }))) return;
                    deleteCustomLevel(l.id);
                    setCustom(customLevels());
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </section>
          <section>
            <h4>{t('editor.builtIn')}</h4>
            {LEVELS.map(l => (
              <div class="open-row">
                <button class="grow" onClick={() => open(structuredClone(l))}>
                  {localized(l.name)} <span class="muted">· {l.id}</span>
                </button>
              </div>
            ))}
          </section>
        </div>
        <textarea placeholder="{ … JSON … }" rows={3} value={paste} onInput={e => setPaste(e.currentTarget.value)} />
        {error && <p class="error">{error}</p>}
        <div class="row">
          <button
            disabled={!paste.trim()}
            onClick={() => {
              try {
                open(parseLevelText(paste));
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {t('editor.import')}
          </button>
          <button onClick={close}>{t('menu.back')}</button>
        </div>
      </div>
    </div>
  );
}

