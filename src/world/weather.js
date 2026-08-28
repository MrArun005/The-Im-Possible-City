import * as THREE from 'three';
import { Rain } from '../fx/particles.js';
import { globals } from '../gfx/materials.js';
import { damp } from '../util/math.js';
import * as T from '../gfx/textures.js';

/**
 * Rain mode (Task 3.3).
 *
 * One number, `amount`, drives everything: the wetness uniform every ground and
 * wall material already listens to (so roughness drops and albedo darkens with
 * no texture swap and no hitch), the rain particle opacity, the awning drips,
 * the thunder scheduler and the audio bed. Rain is a tween, not a mode switch.
 */
export class Weather {
  constructor(scene, { quality, audio, dripPoints = [] }) {
    this.scene = scene;
    this.quality = quality;
    this.audio = audio;
    this.amount = 0;
    this.target = 0;
    this._time = 0;
    this._nextThunder = 12;

    if (quality.rainDrops > 0) {
      this.rain = new Rain({
        count: quality.rainDrops,
        radius: 24,
        height: 16,
        color: '#cfe0f2',
      });
      scene.add(this.rain.mesh);
    }

    if (dripPoints.length && quality.rainDrops > 0) {
      this._buildDrips(dripPoints);
    }
  }

  /** Awning drips: short additive streaks that only exist while it rains. */
  _buildDrips(points) {
    const geo = new THREE.PlaneGeometry(0.02, 0.34);
    const mat = new THREE.MeshBasicMaterial({
      map: T.rainStreak(),
      color: new THREE.Color('#dceaf7'),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, points.length * 3);
    const m = new THREE.Matrix4();
    let i = 0;
    this._dripState = [];
    for (const p of points) {
      for (let k = 0; k < 3; k++, i++) {
        const x = p[0] + (Math.random() - 0.5) * 1.6;
        const z = p[2] + (Math.random() - 0.5) * 0.4;
        this._dripState.push({ x, y: p[1], z, t: Math.random(), speed: 2.4 + Math.random() * 2.6 });
        m.makeTranslation(x, p[1], z);
        mesh.setMatrixAt(i, m);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    mesh.name = 'drips';
    this.scene.add(mesh);
    this.drips = mesh;
    this.dripMaterial = mat;
    this._m = m;
  }

  toggle() {
    this.target = this.target > 0.5 ? 0 : 1;
    return this.target > 0.5;
  }

  set(amount) { this.target = amount; }

  update(dt, cameraPos) {
    this._time += dt;
    this.amount = damp(this.amount, this.target, 0.55, dt);

    globals.uWetness.value = this.amount;
    globals.uTime.value = this._time;

    this.rain?.update(dt, this._time, cameraPos);
    this.rain?.setIntensity(this.amount * 0.85);
    this.audio?.setRain(this.amount);

    if (this.drips) {
      this.dripMaterial.opacity = this.amount * 0.7;
      if (this.amount > 0.05) {
        for (let i = 0; i < this._dripState.length; i++) {
          const d = this._dripState[i];
          d.t += dt * d.speed;
          if (d.t > 1) d.t -= 1;
          this._m.makeTranslation(d.x, d.y - d.t * d.y, d.z);
          this.drips.setMatrixAt(i, this._m);
        }
        this.drips.instanceMatrix.needsUpdate = true;
      }
    }

    // Thunder, sparingly. Two claps in a row ruins the trick.
    if (this.amount > 0.6) {
      this._nextThunder -= dt;
      if (this._nextThunder <= 0) {
        this._nextThunder = 22 + Math.random() * 40;
        this.audio?.thunder();
        this.onLightning?.();
      }
    }
  }

  dispose() {
    this.rain?.dispose();
    if (this.drips) {
      this.drips.geometry.dispose();
      this.dripMaterial.dispose();
      this.scene.remove(this.drips);
    }
    globals.uWetness.value = 0;
  }
}
