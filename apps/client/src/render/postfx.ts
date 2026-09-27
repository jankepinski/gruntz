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
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export type Quality = 'low' | 'medium' | 'high';

/**
 * Post-processing chain. High: ambient occlusion (N8AO) + bloom + SMAA; medium: bloom +
 * SMAA; low: plain render with the WebGL context's MSAA.
 */
export class PostFX {
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private ao: N8AOPostPass | null = null;
  private quality: Quality = 'low';

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {}

  setQuality(quality: Quality, width: number, height: number): void {
    if (quality === this.quality && this.composer) return;
    this.quality = quality;
    this.composer?.dispose();
    this.composer = null;
    this.ao = null;
    if (quality === 'low') {
      // EffectComposer turns autoClear off; plain rendering needs it back.
      this.renderer.autoClear = true;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      return;
    }
    this.renderer.toneMapping = THREE.NoToneMapping;
    const composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(this.renderPass);
    if (quality === 'high') {
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
    const bloom = new BloomEffect({ intensity: 0.45, luminanceThreshold: 0.8, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    // A little extra colour and punch after the filmic curve, and a soft vignette.
    const grade = new HueSaturationEffect({ saturation: 0.08 });
    const contrast = new BrightnessContrastEffect({ brightness: 0, contrast: 0.05 });
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    const smaa = new SMAAEffect({ preset: SMAAPreset.HIGH });
    composer.addPass(new EffectPass(this.camera, bloom, tone, grade, contrast, vignette, smaa));
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
