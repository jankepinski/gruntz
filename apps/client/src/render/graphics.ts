/**
 * Graphics options: every expensive effect can be switched on or off on its own; the presets
 * just fill them in. "custom" means the player changed something by hand.
 */

export type GrassMode = 'off' | 'tufts' | 'tuftsShadow' | 'velvet';
export type ShadowQuality = 'off' | 'low' | 'high';
export type Scenery = 'reduced' | 'full';
export type GraphicsPreset = 'low' | 'medium' | 'high' | 'custom';
/** Miniature look: blur towards the top and bottom of the screen (tilt-shift). */
export type Miniature = 'off' | 'subtle' | 'strong';
/** Colour look laid over the picture. */
export type ColorStyle = 'natural' | 'vivid' | 'warm' | 'cool' | 'cinematic';

export interface Graphics {
  preset: GraphicsPreset;
  /** Render resolution as a share of the screen's native resolution (0.5, 0.75 or 1). */
  resolution: number;
  shadows: ShadowQuality;
  /** Ambient occlusion (soft contact shadows). */
  ao: boolean;
  bloom: boolean;
  antialias: boolean;
  /** Colour grading and vignette. */
  grading: boolean;
  colorStyle: ColorStyle;
  miniature: Miniature;
  /** Dark ink lines around shapes (cartoon look). */
  outlines: boolean;
  /** Crisper details (contrast-adaptive sharpening). */
  sharpen: boolean;
  /** Film grain. */
  grain: boolean;
  /** Colour fringes towards the screen edges (lens look). */
  aberration: boolean;
  /** Chunky pixels and fewer colours, like a game from 1999. */
  retro: boolean;
  grass: GrassMode;
  scenery: Scenery;
  /** On-screen frame counter. */
  fps: boolean;
}

export type GraphicsLook = Omit<Graphics, 'preset' | 'fps'>;

export const GRAPHICS_PRESETS: Record<Exclude<GraphicsPreset, 'custom'>, GraphicsLook> = {
  low: {
    resolution: 0.5,
    shadows: 'off',
    ao: false,
    bloom: false,
    antialias: false,
    grading: false,
    colorStyle: 'natural',
    miniature: 'off',
    outlines: false,
    sharpen: false,
    grain: false,
    aberration: false,
    retro: false,
    grass: 'off',
    scenery: 'reduced',
  },
  medium: {
    resolution: 0.75,
    shadows: 'low',
    ao: false,
    bloom: true,
    antialias: true,
    grading: true,
    colorStyle: 'natural',
    miniature: 'off',
    outlines: false,
    sharpen: true,
    grain: false,
    aberration: false,
    retro: false,
    grass: 'velvet',
    scenery: 'full',
  },
  high: {
    resolution: 1,
    shadows: 'high',
    ao: true,
    bloom: true,
    antialias: true,
    grading: true,
    colorStyle: 'natural',
    miniature: 'subtle',
    outlines: false,
    sharpen: true,
    grain: false,
    aberration: false,
    retro: false,
    grass: 'velvet',
    scenery: 'full',
  },
};

/** Options added after the first release, filled in from a preset for older saves. */
export const LATER_OPTIONS = [
  'colorStyle',
  'miniature',
  'outlines',
  'sharpen',
  'grain',
  'aberration',
  'retro',
] as const satisfies readonly (keyof GraphicsLook)[];

export const RESOLUTIONS = [0.5, 0.75, 1] as const;

/** Pixel ratio to render at: a share of the display's own (capped at 2x, never below 0.75x). */
export function pixelRatio(resolution: number): number {
  return Math.max(0.75, Math.min(2, window.devicePixelRatio) * Math.min(1, resolution));
}

export function presetGraphics(preset: Exclude<GraphicsPreset, 'custom'>, fps = false): Graphics {
  return { preset, ...GRAPHICS_PRESETS[preset], fps };
}

/** Which preset (if any) a set of options matches. */
export function matchPreset(g: Graphics): GraphicsPreset {
  for (const [name, look] of Object.entries(GRAPHICS_PRESETS) as [Exclude<GraphicsPreset, 'custom'>, GraphicsLook][]) {
    if ((Object.keys(look) as (keyof GraphicsLook)[]).every(k => look[k] === g[k])) return name;
  }
  return 'custom';
}

/** Options that change what the terrain is built from (need a rebuild when they change). */
export interface TerrainOptions {
  grass: GrassMode;
  scenery: Scenery;
}
