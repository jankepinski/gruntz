import type { GameClientMsg, GameServerMsg } from '@gruntz/core';

/** A connection to whoever runs the authoritative simulation (web worker or server). */
export interface GameTransport {
  send(msg: GameClientMsg): void;
  onMessage(fn: (msg: GameServerMsg) => void): () => void;
  close(): void;
  /** Single player only: pause / change game speed. */
  control?(msg: WorkerControl): void;
}

export type WorkerControl =
  | { t: 'pause'; paused: boolean }
  | { t: 'speed'; speed: number }
  | { t: 'save' }
  | { t: 'load'; data: import('@gruntz/core').WorldSnapshot };
