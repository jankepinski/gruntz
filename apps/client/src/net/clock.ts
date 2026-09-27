import { TICK_MS } from '@gruntz/core';

/**
 * Render timeline that follows the stream of ticks coming from the simulation. It runs
 * slightly behind the newest tick (a small jitter buffer) and gently speeds up or slows
 * down to stay there, so movement looks smooth even when packets arrive unevenly.
 */
export class TickClock {
  /** Fractional tick being rendered. */
  renderTick = 0;
  private latest = -1;
  private latestAt = 0;
  private arrivalJitter = 0;
  speed = 1;

  /** Buffer in ticks; adapts to the measured jitter (min 1 tick). */
  get buffer(): number {
    return Math.min(4, 1 + this.arrivalJitter / TICK_MS);
  }

  reset(tick: number): void {
    this.latest = tick;
    this.renderTick = tick;
    this.latestAt = performance.now();
  }

  onTick(tick: number): void {
    const now = performance.now();
    if (this.latest >= 0 && tick > this.latest) {
      const expected = ((tick - this.latest) * TICK_MS) / this.speed;
      const error = Math.abs(now - this.latestAt - expected);
      this.arrivalJitter = this.arrivalJitter * 0.9 + error * 0.1;
    }
    if (tick > this.latest) {
      this.latest = tick;
      this.latestAt = now;
    }
  }

  /** Newest simulated tick plus the time elapsed since it arrived (extrapolated). */
  get serverTick(): number {
    return this.latest + 1 + Math.min(1, ((performance.now() - this.latestAt) * this.speed) / TICK_MS);
  }

  update(dtMs: number, paused: boolean): void {
    if (paused) return;
    const target =
      this.latest + 1 - this.buffer + Math.min(1, ((performance.now() - this.latestAt) * this.speed) / TICK_MS);
    let next = this.renderTick + (dtMs * this.speed) / TICK_MS;
    const diff = target - next;
    if (Math.abs(diff) > 10)
      next = target; // way off (tab switch): snap
    else next += diff * 0.1;
    this.renderTick = Math.min(next, this.latest + 1);
  }
}
