import type { GameClientMsg, GameServerMsg, LevelData, PlayerInfo } from '@gruntz/core';
import type { GameTransport, WorkerControl } from './transport.ts';

export interface WorkerInit {
  t: 'init';
  level: LevelData;
  players: PlayerInfo[];
  seed: number;
  team: number;
}

/** Single player: the authoritative simulation runs in a web worker, same protocol as the server. */
export class WorkerTransport implements GameTransport {
  private worker: Worker;
  private listeners = new Set<(msg: GameServerMsg) => void>();
  onSaved?: (data: unknown) => void;

  constructor(init: WorkerInit) {
    this.worker = new Worker(new URL('../sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = e => {
      const data = e.data as GameServerMsg | { t: 'saved'; data: unknown };
      if (data.t === 'saved') {
        this.onSaved?.(data.data);
        return;
      }
      for (const l of this.listeners) l(data);
    };
    this.worker.onerror = e => console.error('Simulation worker error', e);
    this.worker.postMessage(init);
  }

  send(msg: GameClientMsg): void {
    this.worker.postMessage(msg);
  }

  control(msg: WorkerControl): void {
    this.worker.postMessage(msg);
  }

  onMessage(fn: (msg: GameServerMsg) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close(): void {
    this.worker.terminate();
    this.listeners.clear();
  }
}
