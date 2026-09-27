// The core runs in Node and in browsers (main thread and workers). Only the few globals
// both environments share are declared here, so no DOM or Node APIs leak into the sim.
declare function structuredClone<T>(value: T): T;
declare const console: {
  log(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
