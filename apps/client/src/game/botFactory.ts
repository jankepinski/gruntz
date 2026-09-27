import type { BotFactory } from '@gruntz/core';
import { BattleBot } from '@gruntz/core';

export const createBot: BotFactory = (team, level, world) => new BattleBot(team, level, world);
