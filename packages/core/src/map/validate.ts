import { T, tileByName, type TileDef } from '../data/tiles.ts';
import { parseHeights, type LevelData, type LevelObject } from './level.ts';
import { levelToGrid, type TileGrid } from './edit.ts';

/**
 * Checks a level for mistakes the editor can point at before anyone plays it:
 * missing forts / warpstone, links to nothing, objects stuck in walls...
 * Codes are translated by the client (editor.issue.<code>).
 */
export interface LevelIssue {
  severity: 'error' | 'warning';
  code:
    | 'badTiles'
    | 'noPlayerGrunt'
    | 'noWarpstone'
    | 'noFort'
    | 'manyForts'
    | 'fortCentre'
    | 'fortBlocked'
    | 'missingFort'
    | 'noUnits'
    | 'outOfBounds'
    | 'overlap'
    | 'gruntInWall'
    | 'switchNotOnSwitch'
    | 'switchTileNoObject'
    | 'noTargets'
    | 'badTarget'
    | 'wormholeTarget'
    | 'triggerNoWormhole'
    | 'padNotWalkable'
    | 'ballOnWall'
    | 'teamOutOfRange'
    | 'liquidHigh'
    | 'rampTop'
    | 'rampBottom'
    | 'arrowOffEdge';
  x?: number;
  y?: number;
  /** Index into level.objects. */
  object?: number;
}

const SWITCH_KINDS_WITHOUT_TARGETS = new Set(['red']);

function def(grid: TileGrid, x: number, y: number): TileDef | undefined {
  const name = grid[y]?.[x];
  return name === undefined ? undefined : tileByName(name);
}

function walkable(d: TileDef | undefined): boolean {
  return !!d && !(d.traits & (T.SOLID | T.NOGO | T.WATER | T.DEATH | T.HOLE));
}

/** Walkable now or once opened (pyramidz lowered, rockz or brickz broken, bridgez raised). */
function passable(d: TileDef | undefined): boolean {
  return walkable(d) || (!!d && (d.traits & (T.PYRAMID | T.BREAK | T.LAY | T.BRIDGE)) !== 0);
}

/** Tiles a switch can toggle: pyramids, bridges, two-way arrows (flags are objects). */
function toggleable(d: TileDef | undefined): boolean {
  if (!d) return false;
  if (d.traits & (T.PYRAMID | T.BRIDGE)) return true;
  return d.visual.kind === 'arrow' && d.visual.twoWay;
}

export function validateLevel(level: LevelData): LevelIssue[] {
  const issues: LevelIssue[] = [];
  let grid: TileGrid;
  try {
    grid = levelToGrid(level);
  } catch {
    return [{ severity: 'error', code: 'badTiles' }];
  }
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height;
  const add = (
    severity: LevelIssue['severity'],
    code: LevelIssue['code'],
    o?: LevelObject,
    object?: number,
    at?: { x: number; y: number },
  ) => {
    const issue: LevelIssue = { severity, code };
    const p = at ?? o;
    if (p) {
      issue.x = p.x;
      issue.y = p.y;
    }
    if (object !== undefined) issue.object = object;
    issues.push(issue);
  };

  const objects = level.objects;
  const forts = objects.map((o, i) => [o, i] as const).filter(([o]) => o.type === 'fort');
  const players = level.players ?? 4;

  // --- objects in general -----------------------------------------------------------
  const occupied = new Map<number, number>();
  objects.forEach((o, i) => {
    if (!inside(o.x, o.y)) {
      add('error', 'outOfBounds', o, i);
      return;
    }
    // Grunts and other "standing" objects can't share a tile; pickups under grunts are fine.
    const flying =
      o.type === 'dropper' || o.type === 'cloud' || o.type === 'ufo' || o.type === 'spotlight' || o.type === 'slime';
    if (o.type !== 'pickup' && o.type !== 'puddle' && o.type !== 'secret' && o.type !== 'giantRock' && !flying) {
      const key = o.y * width + o.x;
      const other = occupied.get(key);
      if (other !== undefined) add('error', 'overlap', o, i);
      else occupied.set(key, i);
    }
    const d = def(grid, o.x, o.y);
    if (o.type === 'grunt') {
      if (!walkable(d) && !(d && d.traits & T.WATER && o.tool === 'TOOB')) add('error', 'gruntInWall', o, i);
      if (level.mode === 'battle' && (o.team ?? 0) >= players) add('warning', 'teamOutOfRange', o, i);
    }
    if (o.type === 'pad' && !walkable(d)) add('error', 'padNotWalkable', o, i);
    if (o.type === 'ball' && d && d.traits & T.SOLID) add('error', 'ballOnWall', o, i);
    if (o.type === 'giantRock' && !(inside(o.x - 1, o.y - 1) && inside(o.x + 1, o.y + 1)))
      add('error', 'outOfBounds', o, i);
    if ((o.type === 'cloud' || o.type === 'ufo') && o.points.some(([x, y]) => !inside(x, y)))
      add('error', 'outOfBounds', o, i);
    if (o.type === 'slime' && !inside(o.x1, o.y1)) add('error', 'outOfBounds', o, i);
    if ((o.type === 'fort' || o.type === 'pad') && level.mode === 'battle' && (o.team ?? 0) >= players)
      add('warning', 'teamOutOfRange', o, i);
  });

  // --- forts -------------------------------------------------------------------------
  for (const [o, i] of forts) {
    if (!inside(o.x, o.y)) continue;
    const centre = def(grid, o.x, o.y);
    if (!centre || !(centre.traits & T.NOGO)) add('warning', 'fortCentre', o, i);
    let open = 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && walkable(def(grid, o.x + dx, o.y + dy))) open++;
    if (open === 0) add('error', 'fortBlocked', o, i);
  }

  // --- mode specific -------------------------------------------------------------------
  if (level.mode === 'quest') {
    if (!objects.some(o => o.type === 'grunt' && !o.ai)) add('error', 'noPlayerGrunt');
    if (
      !objects.some(
        o => (o.type === 'pickup' && o.item === 'WARPSTONE') || (o.type === 'grunt' && !o.ai && o.tool === 'WARPSTONE'),
      )
    ) {
      add('error', 'noWarpstone');
    }
    if (forts.length === 0) add('error', 'noFort');
    if (forts.length > 1) add('warning', 'manyForts');
  } else {
    for (let team = 0; team < players; team++) {
      if (!forts.some(([o]) => o.type === 'fort' && (o.team ?? 0) === team))
        add('error', 'missingFort', undefined, undefined, { x: team, y: -1 });
      const units = objects.some(o => (o.type === 'grunt' || o.type === 'pad') && (o.team ?? 0) === team);
      if (!units) add('error', 'noUnits', undefined, undefined, { x: team, y: -1 });
    }
  }

  // --- switches and links ------------------------------------------------------------------
  const switchAt = new Set<number>();
  objects.forEach((o, i) => {
    if (o.type === 'switch') {
      switchAt.add(o.y * width + o.x);
      const d = def(grid, o.x, o.y);
      if (!d || !(d.traits & T.SWITCH)) {
        add('error', 'switchNotOnSwitch', o, i);
        return;
      }
      const kind = d.switchKind!;
      // Purple and checkpoint switches act as a group: one member holding the targets is enough.
      const grouped = (kind === 'many' || kind === 'checkpoint') && (o.group ?? 0) !== 0;
      const hasTargets = grouped
        ? objects.some(s => s.type === 'switch' && s.group === o.group && s.targets.length > 0)
        : o.targets.length > 0;
      if (!SWITCH_KINDS_WITHOUT_TARGETS.has(kind) && !hasTargets) add('warning', 'noTargets', o, i);
      for (const [tx, ty] of o.targets) {
        const hasFlag = objects.some(f => f.type === 'flag' && f.x === tx && f.y === ty);
        if (!inside(tx, ty) || (!toggleable(def(grid, tx, ty)) && !hasFlag))
          add('warning', 'badTarget', o, i, { x: tx, y: ty });
      }
    }
    if (o.type === 'wormhole') {
      if (!inside(o.tx, o.ty) || !walkable(def(grid, o.tx, o.ty)) || (o.tx === o.x && o.ty === o.y))
        add('error', 'wormholeTarget', o, i);
    }
    if (o.type === 'secret') {
      if (!objects.some(w => w.type === 'wormhole' && w.x === o.wx && w.y === o.wy))
        add('error', 'triggerNoWormhole', o, i);
    }
  });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = def(grid, x, y)!;
      if (d.traits & T.SWITCH && !switchAt.has(y * width + x) && d.switchKind !== 'red') {
        add('warning', 'switchTileNoObject', undefined, undefined, { x, y });
      }
    }
  }

  // --- height levels -----------------------------------------------------------------------
  let heights: number[];
  try {
    heights = parseHeights(level, width, height);
  } catch {
    return [...issues, { severity: 'error', code: 'badTiles' }];
  }
  const lv = (x: number, y: number) => (inside(x, y) ? heights[y * width + x]! : -1);
  const STEP: Record<number, [number, number]> = { 0: [0, -1], 2: [1, 0], 4: [0, 1], 6: [-1, 0] };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = def(grid, x, y)!;
      const h = lv(x, y);
      // Water, abysses and whatever turns into them only exist on the ground level.
      if (h > 0 && d.traits & (T.WATER | T.DEATH | T.BRIDGE | T.CRUMBLE))
        add('error', 'liquidHigh', undefined, undefined, { x, y });
      if (d.ramp !== undefined) {
        const [sx, sy] = STEP[d.ramp]!;
        const top = def(grid, x + sx, y + sy);
        const bottom = def(grid, x - sx, y - sy);
        // The top side must meet walkable ground one level up (or the next flight of stairz)...
        const topLevel =
          top?.ramp === d.ramp ? lv(x + sx, y + sy) : top?.ramp === undefined ? lv(x + sx, y + sy) - 1 : -9;
        if (!passable(top) || topLevel !== h) add('warning', 'rampTop', undefined, undefined, { x, y });
        // ...and the bottom side ground on its own level.
        const bottomLevel =
          bottom?.ramp === d.ramp ? lv(x - sx, y - sy) + 1 : bottom?.ramp === undefined ? lv(x - sx, y - sy) : -9;
        if (!passable(bottom) || bottomLevel !== h) add('warning', 'rampBottom', undefined, undefined, { x, y });
      }
      if (d.visual.kind === 'arrow') {
        const [sx, sy] = STEP[d.visual.dir]!;
        const next = def(grid, x + sx, y + sy);
        if (next && next.ramp === undefined && d.ramp === undefined && lv(x + sx, y + sy) !== h && walkable(next))
          add('warning', 'arrowOffEdge', undefined, undefined, { x, y });
      }
    }
  }
  return issues;
}
