import * as THREE from 'three';
import {
  BloomEffect,
  BrightnessContrastEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  HueSaturationEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

/** Which post effects run (each one on its own switch in the graphics settings). */
export interface PostOptions {
  ao: boolean;
  bloom: boolean;
  antialias: boolean;
  grading: boolean;
}

/**
 * Post-processing chain: ambient occlusion (N8AO), bloom, filmic tone mapping, colour grading
 * with a vignette and SMAA, each optional. With everything off the scene renders straight to
 * the canvas (tone mapped by the renderer).
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
    if (!(options.ao || options.bloom || options.antialias || options.grading)) {
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
    const effects: Effect[] = [];
    if (options.bloom)
      effects.push(
        new BloomEffect({
          intensity: 0.45,
          luminanceThreshold: 0.8,
          luminanceSmoothing: 0.25,
          mipmapBlur: true,
          radius: 0.7,
        }),
      );
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));
    if (options.grading) {
      // A little extra colour and punch after the filmic curve, and a soft vignette.
      effects.push(
        new HueSaturationEffect({ saturation: 0.08 }),
        new BrightnessContrastEffect({ brightness: 0, contrast: 0.05 }),
        new VignetteEffect({ offset: 0.32, darkness: 0.42 }),
      );
    }
    if (options.antialias) effects.push(new SMAAEffect({ preset: SMAAPreset.HIGH }));
    composer.addPass(new EffectPass(this.camera, ...effects));
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
