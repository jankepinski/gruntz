import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  BrightnessContrastEffect,
  ChromaticAberrationEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  NoiseEffect,
  PixelationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Pass,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { ColorStyle, Miniature } from './graphics.ts';

/** Which post effects run (each one on its own switch in the graphics settings). */
export interface PostOptions {
  ao: boolean;
  bloom: boolean;
  antialias: boolean;
  grading: boolean;
  colorStyle: ColorStyle;
  miniature: Miniature;
  outlines: boolean;
  sharpen: boolean;
  grain: boolean;
  aberration: boolean;
  retro: boolean;
}

/** Dark ink lines where the depth jumps: silhouettes of gruntz, cliff rims, props. */
class InkEffect extends Effect {
  constructor() {
    super(
      'InkEffect',
      /* glsl */ `
      uniform float uStrength;
      float viewDepth(const in vec2 uv) { return -getViewZ(readDepth(uv)); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        float c = -getViewZ(depth);
        vec2 t = texelSize;
        // How much farther the neighbours are on average (a Laplacian): zero on flat or evenly
        // sloping surfaces, large on the near side of a silhouette. Relative to the distance,
        // so the lines keep their weight at every zoom.
        float around = viewDepth(uv + vec2(t.x, 0.0)) + viewDepth(uv - vec2(t.x, 0.0))
                     + viewDepth(uv + vec2(0.0, t.y)) + viewDepth(uv - vec2(0.0, t.y));
        float rise = max(0.0, around * 0.25 - c) / max(c, 0.001);
        float edge = smoothstep(0.004, 0.012, rise);
        vec3 ink = inputColor.rgb * 0.28;
        outputColor = vec4(mix(inputColor.rgb, ink, edge * uStrength), inputColor.a);
      }`,
      {
        attributes: EffectAttribute.DEPTH,
        blendFunction: BlendFunction.SRC,
        uniforms: new Map([['uStrength', new THREE.Uniform(0.85)]]),
      },
    );
  }
}

/** Contrast-adaptive sharpening (a light version of AMD's CAS). */
class SharpenEffect extends Effect {
  constructor(amount = 0.35) {
    super(
      'SharpenEffect',
      /* glsl */ `
      uniform float uAmount;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 n = texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb;
        vec3 s = texture2D(inputBuffer, uv - vec2(0.0, texelSize.y)).rgb;
        vec3 e = texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb;
        vec3 w = texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0)).rgb;
        vec3 c = inputColor.rgb;
        vec3 lo = min(c, min(min(n, s), min(e, w)));
        vec3 hi = max(c, max(max(n, s), max(e, w)));
        // Less sharpening where the neighbourhood already has a lot of contrast (no halos).
        vec3 k = sqrt(clamp(min(lo, 1.0 - hi) / max(hi, 1e-4), 0.0, 1.0)) * -uAmount * 0.25;
        vec3 sharp = (c + (n + s + e + w) * k) / (1.0 + 4.0 * k);
        outputColor = vec4(clamp(sharp, 0.0, 1.0), inputColor.a);
      }`,
      {
        attributes: EffectAttribute.CONVOLUTION,
        blendFunction: BlendFunction.SRC,
        uniforms: new Map([['uAmount', new THREE.Uniform(amount)]]),
      },
    );
  }
}

interface StyleParams {
  saturation: number;
  contrast: number;
  /** + warmer (red/yellow), - cooler (blue). */
  warmth: number;
  /** Added to the shadows and to the highlights (split toning). */
  shadows: [number, number, number];
  highlights: [number, number, number];
}

const STYLES: Record<Exclude<ColorStyle, 'natural'>, StyleParams> = {
  vivid: { saturation: 0.16, contrast: 0.05, warmth: 0.0, shadows: [0, 0, 0.012], highlights: [0.005, 0.005, 0] },
  warm: {
    saturation: 0.08,
    contrast: 0.03,
    warmth: 0.055,
    shadows: [0.02, 0.005, -0.01],
    highlights: [0.03, 0.015, -0.02],
  },
  cool: {
    saturation: -0.02,
    contrast: 0.04,
    warmth: -0.05,
    shadows: [-0.01, 0.01, 0.035],
    highlights: [0.0, 0.01, 0.02],
  },
  cinematic: {
    saturation: -0.04,
    contrast: 0.1,
    warmth: 0.0,
    shadows: [-0.03, 0.02, 0.05],
    highlights: [0.05, 0.02, -0.035],
  },
};

/** Colour look: saturation, contrast, warmth and split toning (teal shadows, orange lights...). */
class ColorStyleEffect extends Effect {
  constructor(p: StyleParams) {
    super(
      'ColorStyleEffect',
      /* glsl */ `
      uniform float uSaturation;
      uniform float uContrast;
      uniform float uWarmth;
      uniform vec3 uShadows;
      uniform vec3 uHighlights;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        // The grading before can push dark, saturated colours slightly below zero.
        vec3 c = clamp(inputColor.rgb, 0.0, 1.0);
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 1.0 + uSaturation);
        c = (c - 0.5) * (1.0 + uContrast) + 0.5;
        c += vec3(uWarmth, uWarmth * 0.35, -uWarmth);
        c += uShadows * (1.0 - smoothstep(0.0, 0.45, l)) + uHighlights * smoothstep(0.4, 1.0, l);
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`,
      {
        blendFunction: BlendFunction.SRC,
        uniforms: new Map<string, THREE.Uniform>([
          ['uSaturation', new THREE.Uniform(p.saturation)],
          ['uContrast', new THREE.Uniform(p.contrast)],
          ['uWarmth', new THREE.Uniform(p.warmth)],
          ['uShadows', new THREE.Uniform(new THREE.Vector3(...p.shadows))],
          ['uHighlights', new THREE.Uniform(new THREE.Vector3(...p.highlights))],
        ]),
      },
    );
  }
}

/**
 * Miniature look (tilt-shift): a sharp band across the middle of the screen, the picture
 * blurring softly towards the top and bottom, as if the map were a small model on a table.
 */
class MiniatureEffect extends Effect {
  constructor(band: number, feather: number, radius: number) {
    super(
      'MiniatureEffect',
      /* glsl */ `
      uniform float uBand;
      uniform float uFeather;
      uniform float uRadius;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        // The focus sits a little below the middle, where the camera looks at the ground.
        float d = abs(uv.y - 0.47);
        float amount = smoothstep(uBand, uBand + uFeather, d);
        if (amount < 0.01) {
          outputColor = inputColor;
          return;
        }
        vec2 r = texelSize * uRadius * amount;
        vec3 sum = inputColor.rgb;
        // Golden-angle spiral: an even disc of 16 taps.
        for (int i = 0; i < 16; i++) {
          float f = float(i) + 0.5;
          float a = f * 2.39996;
          sum += texture2D(inputBuffer, uv + vec2(cos(a), sin(a)) * sqrt(f / 16.0) * r).rgb;
        }
        outputColor = vec4(sum / 17.0, inputColor.a);
      }`,
      {
        attributes: EffectAttribute.CONVOLUTION,
        blendFunction: BlendFunction.SRC,
        uniforms: new Map([
          ['uBand', new THREE.Uniform(band)],
          ['uFeather', new THREE.Uniform(feather)],
          ['uRadius', new THREE.Uniform(radius)],
        ]),
      },
    );
  }
}

/** Fewer colour steps, like a 16-bit colour screen (goes with the chunky pixels of retro mode). */
class PosterizeEffect extends Effect {
  constructor(levels = 24) {
    super(
      'PosterizeEffect',
      /* glsl */ `
      uniform float uLevels;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = pow(clamp(inputColor.rgb, 0.0, 1.0), vec3(1.0 / 2.2));
        c = floor(c * uLevels + 0.5) / uLevels;
        outputColor = vec4(pow(c, vec3(2.2)), inputColor.a);
      }`,
      { blendFunction: BlendFunction.SRC, uniforms: new Map([['uLevels', new THREE.Uniform(levels)]]) },
    );
  }
}

/**
 * Post-processing chain: ambient occlusion (N8AO), ink outlines, bloom, filmic tone mapping,
 * colour grading and colour styles, anti-aliasing, sharpening, the miniature (tilt-shift)
 * blur, retro pixels, and lens touches (grain, colour fringes). Each part is optional; with
 * everything off the scene renders straight to the canvas (tone mapped by the renderer).
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private ao: N8AOPostPass | null = null;
  private key = '';

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {}

  configure(options: PostOptions, width: number, height: number): void {
    const key = JSON.stringify(options);
    if (key === this.key) return;
    this.key = key;
    this.composer?.dispose();
    this.composer = null;
    this.ao = null;
    const any =
      options.ao ||
      options.bloom ||
      options.antialias ||
      options.grading ||
      options.colorStyle !== 'natural' ||
      options.miniature !== 'off' ||
      options.outlines ||
      options.sharpen ||
      options.grain ||
      options.aberration ||
      options.retro;
    if (!any) {
      // EffectComposer turns autoClear off; plain rendering needs it back.
      this.renderer.autoClear = true;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      return;
    }
    this.renderer.toneMapping = THREE.NoToneMapping;
    const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);
    if (options.ao) {
      // Soft contact shadows where things meet (cliff feet, grunts on the ground).
      const ao = new N8AOPostPass(this.scene, this.camera, width, height);
      ao.configuration.aoRadius = 1.2;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.6;
      ao.configuration.color = new THREE.Color(0x2a1c24);
      ao.configuration.halfRes = true;
      ao.setQualityMode('Medium');
      composer.addPass(ao);
      this.ao = ao;
    }
    // Every pass holds at most one effect that samples its neighbours (postprocessing's rule).
    const passes: Pass[] = [];
    if (options.outlines) passes.push(new EffectPass(this.camera, new InkEffect()));

    const main: Effect[] = [];
    if (options.bloom)
      main.push(
        new BloomEffect({
          intensity: 0.45,
          luminanceThreshold: 0.8,
          luminanceSmoothing: 0.25,
          mipmapBlur: true,
          radius: 0.7,
        }),
      );
    main.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
    if (options.grading) {
      // A little extra colour and punch after the filmic curve.
      main.push(
        new HueSaturationEffect({ saturation: 0.08 }),
        new BrightnessContrastEffect({ brightness: 0, contrast: 0.05 }),
      );
    }
    if (options.grading) main.push(new VignetteEffect({ offset: 0.32, darkness: 0.42 }));
    if (options.antialias && !options.retro) main.push(new SMAAEffect({ preset: SMAAPreset.HIGH }));
    passes.push(new EffectPass(this.camera, ...main));
    // The colour style gets a pass of its own: merged into the pass above (with SMAA, bloom
    // and tone mapping) it blacked out the darkest pixels on some GPUs.
    if (options.colorStyle !== 'natural')
      passes.push(new EffectPass(this.camera, new ColorStyleEffect(STYLES[options.colorStyle])));

    if (options.sharpen && !options.retro) passes.push(new EffectPass(this.camera, new SharpenEffect()));
    if (options.miniature !== 'off') {
      const strong = options.miniature === 'strong';
      // Blur size follows the screen height so it looks the same at any resolution.
      // Only the outer edges of the screen blur; the "subtle" setting just softens them.
      const radius = (strong ? 5.5 : 3) * Math.max(1, height / 1080) * this.renderer.getPixelRatio();
      passes.push(new EffectPass(this.camera, new MiniatureEffect(strong ? 0.24 : 0.32, strong ? 0.2 : 0.18, radius)));
    }
    if (options.retro)
      passes.push(
        new EffectPass(
          this.camera,
          new PixelationEffect(Math.max(3, Math.round((height / 270) * this.renderer.getPixelRatio()))),
          new PosterizeEffect(),
        ),
      );
    const lens: Effect[] = [];
    if (options.aberration)
      lens.push(
        new ChromaticAberrationEffect({
          offset: new THREE.Vector2(0.0011, 0.0008),
          radialModulation: true,
          modulationOffset: 0.35,
        }),
      );
    if (options.grain) {
      const grain = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
      grain.blendMode.opacity.value = 0.14;
      lens.push(grain);
    }
    if (lens.length) passes.push(new EffectPass(this.camera, ...lens));
    for (const p of passes) composer.addPass(p);
    // Never let the composer touch the canvas CSS size (the page layout owns it).
    composer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.composer = composer;
  }

  setCamera(camera: THREE.Camera): void {
    if (camera === this.camera) return;
    this.camera = camera;
    if (this.renderPass) this.renderPass.mainCamera = camera;
    if (this.ao) this.ao.camera = camera;
    this.composer?.passes.forEach(p => {
      (p as unknown as { mainCamera?: THREE.Camera }).mainCamera = camera;
    });
  }

  setSize(width: number, height: number): void {
    this.composer?.setSize(width, height, false);
  }

  render(dt: number): void {
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.composer?.dispose();
  }
}
