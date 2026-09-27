/** Fixed simulation step. Every duration in the simulation is expressed in ticks. */
export const TICK_MS = 50;
export const TICKS_PER_SECOND = 1000 / TICK_MS;

/** Converts an original-game duration (milliseconds) to simulation ticks (at least 1). */
export function msToTicks(ms: number): number {
  return Math.max(1, Math.round(ms / TICK_MS));
}

export const MAX_HEALTH = 20;
export const MAX_STAMINA = 20;
export const MAX_FLIGHT = 20;
export const MAX_TEAMS = 4;
/** Team id used for enemy AI gruntz in Quest levels. */
export const NEUTRAL_TEAM = 4;
