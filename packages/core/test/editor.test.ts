import { describe, expect, it } from 'vitest';
import {
  blankLevel,
  buildLevel,
  createWorld,
  floodRegion,
  gridToTiles,
  levelToGrid,
  mirrorLevel,
  resizeLevel,
  validateLevel,
} from '../src/index.ts';

describe('level editor helpers', () => {
  it('uses default characters and only writes extra legend entries', () => {
    const { tiles, legend } = gridToTiles([
      ['CLIFF', 'GROUND', 'PYRAMID_RED'],
      ['WATER', 'SWITCH_R', 'PYRAMID_RED'],
    ]);
    expect(tiles[0]!.slice(0, 2)).toBe('#.');
    expect(Object.values(legend).sort()).toEqual(['PYRAMID_RED', 'SWITCH_R']);
  });

  it('resize shifts objects and their links', () => {
    const level = blankLevel('quest', 10, 8);
    const grid = levelToGrid(level);
    const objects = [...level.objects, { type: 'switch' as const, x: 2, y: 2, targets: [[5, 5] as [number, number], [9, 7] as [number, number]] }];
    const { grid: g2, objects: o2 } = resizeLevel(grid, objects, 12, 8, 2, 0);
    expect(g2[0]!.length).toBe(12);
    const sw = o2.find(o => o.type === 'switch')!;
    expect(sw.type === 'switch' && sw.targets).toEqual([
      [7, 5],
      [11, 7],
    ]);
    // Cropping drops what falls outside.
    const { objects: o3 } = resizeLevel(grid, objects, 4, 4, 0, 0);
    expect(o3.every(o => o.x < 4 && o.y < 4)).toBe(true);
  });

  it('mirror flips arrows and directions', () => {
    const { grid, objects } = mirrorLevel([['ARROW_E', 'GROUND']], [{ type: 'ball', x: 0, y: 0, dir: 2 }], 'x');
    expect(grid[0]).toEqual(['GROUND', 'ARROW_W']);
    expect(objects[0]).toMatchObject({ x: 1, dir: 6 });
  });

  it('flood fill stays inside a region', () => {
    const grid = [0, 1, 2, 3, 4].map(y => [0, 1, 2, 3, 4, 5].map(x => (x === 0 || y === 0 || x === 5 || y === 4 ? 'CLIFF' : 'GROUND')));
    expect(floodRegion(grid, { x: 2, y: 2 }).length).toBe(4 * 3);
    expect(floodRegion(grid, { x: 0, y: 0 }).length).toBe(6 * 5 - 4 * 3);
  });

  it('blank levels are valid and playable', () => {
    for (const mode of ['quest', 'battle'] as const) {
      const level = blankLevel(mode);
      expect(validateLevel(level), mode).toEqual([]);
      expect(() => createWorld(level, { seed: 1, teams: [{ team: 0, name: 'a' }, { team: 1, name: 'b' }] })).not.toThrow();
    }
  });

  it('reports the obvious mistakes', () => {
    const level = blankLevel('quest', 10, 8);
    level.objects = [{ type: 'grunt', x: 0, y: 0 }, { type: 'switch', x: 3, y: 3, targets: [] }];
    const codes = validateLevel(level).map(i => i.code);
    expect(codes).toEqual(expect.arrayContaining(['gruntInWall', 'noWarpstone', 'noFort', 'switchNotOnSwitch']));
  });
});

