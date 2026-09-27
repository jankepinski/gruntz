import { describe, expect, it } from 'vitest';
import {
  BattleBot,
  buildLevel,
  formatLevel,
  GameSession,
  levelToGrid,
  parseTiles,
  validateLevel,
  type PlayerInfo,
} from '@gruntz/core';
import { LEVELS } from '../src/levels.ts';

const levels = [...LEVELS.values()];

describe('shipped levels', () => {
  it('have no validation errors', () => {
    for (const level of levels) {
      const errors = validateLevel(level).filter(i => i.severity === 'error');
      expect(errors, level.id).toEqual([]);
    }
  });

  it('survive an editor round trip', () => {
    for (const level of levels) {
      const rebuilt = buildLevel(
        { id: level.id, name: level.name, mode: level.mode, theme: level.theme },
        levelToGrid(level),
        level.objects,
      );
      expect(parseTiles(rebuilt).tiles, level.id).toEqual(parseTiles(level).tiles);
      const text = formatLevel(level);
      expect(JSON.parse(text), level.id).toEqual(JSON.parse(JSON.stringify(level)));
    }
  });

  it('run for 30 seconds without errors', () => {
    for (const level of levels) {
      const players: PlayerInfo[] = [{ team: 0, name: 'P', alliance: 0 }];
      if (level.mode === 'battle')
        for (let i = 1; i < (level.players ?? 2); i++)
          players.push({ team: i, name: `B${i}`, alliance: i, bot: 'normal' });
      const session = new GameSession(level, players, 7, (team, bot, world) => new BattleBot(team, bot, world));
      for (let i = 0; i < 600 && !session.end; i++) session.step();
    }
  });
});

describe('battle maps', () => {
  it('bots fight every map to a finish', () => {
    for (const level of levels.filter(l => l.mode === 'battle')) {
      const players: PlayerInfo[] = [];
      for (let i = 0; i < (level.players ?? 2); i++)
        players.push({ team: i, name: `B${i}`, alliance: i, bot: i % 2 ? 'hard' : 'normal' });
      const session = new GameSession(level, players, 11, (team, bot, world) => new BattleBot(team, bot, world));
      for (let t = 0; t < 20 * 60 * 20 && !session.end; t++) session.step();
      expect(session.end?.winner, level.id).not.toBeNull();
      expect(session.end?.winner, level.id).toBeDefined();
    }
  }, 60_000);
});
