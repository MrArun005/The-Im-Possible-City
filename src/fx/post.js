import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GradeShader } from '../gfx/shaders/gradeShader.js';
import { damp } from '../util/math.js';
import { EXPOSURE } from '../core/renderer.js';

/**
 * Post chain: scene -> bloom -> grade(+tonemap+sRGB).
 *
 * The one non-obvious requirement: the composer's render targets MUST have a
 * stencil buffer, or the whole portal reveal silently renders nothing. Three's
 * default composer target has stencil disabled, so we build our own.
 */
export class PostFX {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.quality = quality;
    this.enabled = true;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      stencilBuffer: true,
      depthBuffer: true,
      samples: quality.name === 'high' ? 4 : quality.name === 'medium' ? 2 : 0,
    });

    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));

    if (quality.bloom) {
      // Threshold above 0.7 so ONLY emissives glow - lamps, neon, windows.
      this.bloom = new UnrealBloomPass(
        new THREE.Vector2(size.x, size.y),
        0.9 * (quality.bloomStrengthScale ?? 1),
        0.6,
        0.75
      );
      this.composer.addPass(this.bloom);
    }

    this.grade = new ShaderPass(GradeShader);
    this.grade.material.uniforms.uTint.value = new THREE.Color(1, 1, 1);
    this.grade.material.uniforms.uLift.value = new THREE.Color(0, 0, 0);
    this.grade.material.uniforms.uFadeColor.value = new THREE.Color(0, 0, 0);
    this.grade.material.uniforms.uExposure.value = EXPOSURE;
    this.grade.material.uniforms.uGrain.value = quality.grain ? 0.035 : 0;
    this.grade.material.uniforms.uChromatic.value = quality.chromatic ? 0.0012 : 0;
    this.grade.renderToScreen = true;
    this.composer.addPass(this.grade);

    // Live-tweenable targets. The render loop chases these, so a district swap
    // just writes new numbers and the picture drifts into the new mood.
    this.target = {
      exposure: EXPOSURE,
      bloomStrength: 0.9,
      bloomRadius: 0.6,
      bloomThreshold: 0.75,
      saturation: 1,
      contrast: 1.06,
      vignette: 1,
      tint: new THREE.Color(1, 1, 1),
      lift: new THREE.Color(0, 0, 0),
    };
    this._fade = 0;
    this.fadeTarget = 0;
  }

  /** Apply a district grade block (§3.2). `instant` skips the tween. */
  applyGrade(grade = {}, instant = false) {
    const t = this.target;
    if (grade.exposure != null) t.exposure = grade.exposure;
    if (grade.bloomStrength != null) t.bloomStrength = grade.bloomStrength;
    if (grade.bloomRadius != null) t.bloomRadius = grade.bloomRadius;
    if (grade.bloomThreshold != null) t.bloomThreshold = grade.bloomThreshold;
    if (grade.saturation != null) t.saturation = grade.saturation;
    if (grade.contrast != null) t.contrast = grade.contrast;
    if (grade.vignette != null) t.vignette = grade.vignette;
    if (grade.tint) t.tint.set(grade.tint);
    if (grade.lift) t.lift.set(grade.lift);
    if (instant) this.update(0, 999);
  }

  fadeTo(value, color) {
    this.fadeTarget = value;
    if (color) this.grade.material.uniforms.uFadeColor.value.set(color);
  }

  update(elapsed, dt) {
    const u = this.grade.material.uniforms;
    const t = this.target;
    const rate = 2.2;

    u.uTime.value = elapsed;
    u.uExposure.value = damp(u.uExposure.value, t.exposure, rate, dt);
    u.uSaturation.value = damp(u.uSaturation.value, t.saturation, rate, dt);
    u.uContrast.value = damp(u.uContrast.value, t.contrast, rate, dt);
    u.uVignette.value = damp(u.uVignette.value, t.vignette, rate, dt);
    u.uTint.value.lerp(t.tint, 1 - Math.exp(-rate * dt));
    u.uLift.value.lerp(t.lift, 1 - Math.exp(-rate * dt));

    this._fade = damp(this._fade, this.fadeTarget, 5.5, dt);
    u.uFade.value = this._fade;
    u.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight);

    if (this.bloom) {
      const scale = this.quality.bloomStrengthScale ?? 1;
      this.bloom.strength = damp(this.bloom.strength, t.bloomStrength * scale, rate, dt);
      this.bloom.radius = damp(this.bloom.radius, t.bloomRadius, rate, dt);
      this.bloom.threshold = damp(this.bloom.threshold, t.bloomThreshold, rate, dt);
    }
  }

  render(scene, camera) {
    if (this.enabled) this.composer.render();
    else this.renderer.render(scene, camera);
  }

  setSize(w, h) { this.composer.setSize(w, h); }
}
