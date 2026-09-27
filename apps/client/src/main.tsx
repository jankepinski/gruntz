import { render } from 'preact';
import { App } from './ui/App.tsx';
import { audio } from './audio/audio.ts';
import { settings } from './game/store.ts';

// Audio can only start after a user gesture.
const unlock = () => audio.unlock();
window.addEventListener('pointerdown', unlock);
window.addEventListener('keydown', unlock);
const applyVolumes = () => audio.setVolumes(settings.get().volumes);
applyVolumes();
settings.subscribe(applyVolumes);

if (import.meta.env.DEV) {
  window.addEventListener('unhandledrejection', e =>
    console.warn('unhandled rejection:', (e.reason as Error)?.stack ?? e.reason),
  );
}

render(<App />, document.getElementById('app')!);
