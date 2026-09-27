import { msToTicks } from '../constants.ts';
import { BRICK_COLORS, TOOLS, TOYS, type ItemId } from '../data/items.ts';
import { T, tileDef } from '../data/tiles.ts';
import { checkIdle, isGone, kill, setAction, spawnGrunt, updateTile } from './grunt.ts';
import { addGoo, GOO_PER_GRUNT } from './tools.ts';
import type { Fort, Grunt, TeamState } from './types.ts';
import { registerTask, type Rules, type World } from './world.ts';

const WIN_MS = 4960;
const DROP_MS = 1840;
export const BATTLE_GOO_MS = 6000;
export const BATTLE_RESOURCE_MS = 18000;
const SLOTS_PER_KIND = 4;

// --- quest ----------------------------------------------------------------------------

export function questRules(playerTeam: number): Rules {
  return {
    onFortEntered(w, _fort, g) {
      if (g.team !== playerTeam || g.tool !== 'WARPSTONE') return false;
      winTeam(w, playerTeam);
      return true;
    },
    onGruntDied(w, team) {
      if (team !== playerTeam) return;
      checkQuestLost(w, playerTeam);
    },
  };
}

function checkQuestLost(w: World, playerTeam: number): void {
  const team = w.team(playerTeam);
  if (!team || team.won || team.lost) return;
  for (const g of w.all('grunt')) if (g.team === playerTeam && !isGone(g)) return;
  const canBake = team.ovens.some(o => o >= 0) || team.goo >= GOO_PER_GRUNT;
  if (!canBake) w.edit(team, { lost: true });
}

function winTeam(w: World, teamIndex: number): void {
  const team = w.team(teamIndex);
  if (!team || team.won) return;
  const ticks = msToTicks(WIN_MS);
  for (const g of w.all('grunt')) {
    if (g.team !== teamIndex || isGone(g)) continue;
    w.cancelAll(g.id);
    w.edit(g, { task: null, orders: [] });
    setAction(w, g, 'win', ticks);
  }
  w.edit(team, { won: true });
  w.fx('win', { x: 0, y: 0 }, team.id);
}

// --- battle ------------------------------------------------------------------------------

export interface BattleConfig {
  /** Items the grunt machine hands out over time. */
  resources?: ItemId[];
}

export function battleRules(config: BattleConfig = {}): Rules {
  const pool: (ItemId | (typeof BRICK_COLORS)[number])[] = config.resources?.length
    ? config.resources
    : [...TOOLS.filter(t => t !== 'WARPSTONE' && t !== 'WAND'), ...TOYS.filter(t => t !== 'SCROLL'), ...BRICK_COLORS];
  return {
    onFortEntered(w, fort, g) {
      if (fort.captured || fort.team === g.team || w.alliance(fort.team) === w.alliance(g.team)) return false;
      captureFort(w, fort, g);
      return false;
    },
    onTick(w) {
      if (w.tick === 0) {
        w.schedule(msToTicks(BATTLE_GOO_MS), 'battleGoo', 0, 'battleGoo');
        w.schedule(msToTicks(BATTLE_RESOURCE_MS), 'battleResource', 0, 'battleResource', pool);
      }
    },
  };
}

registerTask('battleGoo', w => {
  for (const t of w.all('team')) if (!t.lost) addGoo(w, t.index, 1);
  w.schedule(msToTicks(BATTLE_GOO_MS), 'battleGoo', 0, 'battleGoo');
});

registerTask('battleResource', (w, _id, pool: string[]) => {
  for (const t of w.all('team')) {
    if (t.lost) continue;
    const item = pool[w.randomInt(pool.length)]!;
    addSlot(w, t, item as ItemId);
  }
  w.schedule(msToTicks(BATTLE_RESOURCE_MS), 'battleResource', 0, 'battleResource', pool);
});

function addSlot(w: World, team: TeamState, item: TeamState['slots'][number]): void {
  const slots = team.slots.slice();
  const free = slots.indexOf(null);
  if (free >= 0) slots[free] = item;
  else if (slots.length < SLOTS_PER_KIND * 3) slots.push(item);
  else return;
  w.edit(team, { slots });
}

function captureFort(w: World, fort: Fort, g: Grunt): void {
  w.edit(fort, { captured: true });
  w.fx('fortCaptured', fort, fort.id, g.team);
  const loser = w.team(fort.team);
  if (loser) w.edit(loser, { lost: true });
  // The defeated team's gruntz blow up; its pads now belong to the conqueror.
  for (const other of w.all('grunt')) {
    if (other.team === fort.team && !isGone(other)) kill(w, other, 'EXPLODE');
  }
  for (const pad of w.all('pad')) if (pad.team === fort.team) w.edit(pad, { team: g.team });
  const alive = new Set<number>();
  for (const t of w.all('team')) if (!t.lost) alive.add(w.alliance(t.index));
  if (alive.size === 1) {
    for (const t of w.all('team')) if (!t.lost) winTeam(w, t.index);
  }
}

// --- shared: ovens, destruct ---------------------------------------------------------------

/** Drop a baked grunt from an oven onto one of the team's pads (squashes whoever is there). */
export function dropOvenGrunt(w: World, teamIndex: number, oven: number, padId: number): boolean {
  const team = w.team(teamIndex);
  const pad = w.get(padId, 'pad');
  if (!team || !pad || pad.team !== teamIndex) return false;
  const bakedAt = team.ovens[oven];
  if (bakedAt === undefined || bakedAt < 0 || w.tick < bakedAt) return false;
  const ovens = team.ovens.slice();
  ovens[oven] = -1;
  w.edit(team, { ovens });
  const squashed = w.gruntAt(pad.x, pad.y);
  if (squashed) kill(w, squashed, 'SQUASH');
  const g = spawnGrunt(w, { team: teamIndex, x: pad.x, y: pad.y });
  w.cancel(g.id, 'idle');
  const ticks = msToTicks(DROP_MS);
  setAction(w, g, 'enter', ticks, { variant: 2 });
  w.schedule(ticks, 'dropDone', g.id, 'action');
  return true;
}

registerTask('dropDone', (w, id) => {
  const g = w.get(id, 'grunt');
  if (!g) return;
  setAction(w, g, 'idle', 0);
  checkIdle(w, g);
});

registerTask('autoToggle', (w, _id, period: number) => {
  for (let y = 0; y < w.height; y++) {
    for (let x = 0; x < w.width; x++) {
      if (tileDef(w.tileAt(x, y)).traits & T.AUTO) {
        w.toggleTile(x, y);
        updateTile(w, x, y);
      }
    }
  }
  w.schedule(period, 'autoToggle', 0, 'autoToggle', period);
});

/** The red destruct button: blow up all of the team's gruntz. */
export function destruct(w: World, teamIndex: number): void {
  for (const g of w.all('grunt')) {
    if (g.team === teamIndex && !isGone(g)) kill(w, g, 'EXPLODE');
  }
}
