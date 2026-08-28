import * as THREE from 'three';
import { smoothstep } from '../util/math.js';
import { EYE_HEIGHT } from '../core/renderer.js';
import { bus } from '../util/events.js';

/**
 * The intro rail dolly (Task 1.6).
 *
 * A CatmullRom path with a matching list of lookAt targets, eased so the move
 * starts and ends slowly. The point is not to show the city off - it is to
 * establish the eye height and the fog before you are given the keys. It hands
 * off to the Player either at the end of the rail or the moment you touch a
 * control, because a cinematic you cannot skip is a cinematic people resent.
 */
export class CameraRig {
  constructor(camera, { path, targets, duration = 12, endYaw = 0 }) {
    this.camera = camera;
    this.duration = duration;
    this.endYaw = endYaw;
    this.t = 0;
    this.running = false;
    this.finished = false;

    this.curve = new THREE.CatmullRomCurve3(
      path.map((p) => new THREE.Vector3().fromArray(p)),
      false,
      'catmullrom',
      0.25
    );
    this.targets = new THREE.CatmullRomCurve3(
      targets.map((p) => new THREE.Vector3().fromArray(p)),
      false,
      'catmullrom',
      0.4
    );
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
  }

  start() {
    this.running = true;
    this.t = 0;
    this.curve.getPointAt(0, this._pos);
    this.camera.position.copy(this._pos);
    bus.emit('intro:start');
  }

  /**
   * Skipping jumps to the END of the rail, not to wherever the camera happened
   * to be. Freezing you mid-air halfway down a dolly is worse than no intro at
   * all - you skip a cinematic to get where it was taking you.
   */
  skip() {
    if (!this.running) return;
    this.t = 1;
    this.curve.getPointAt(1, this._pos);
    this.targets.getPointAt(1, this._look);
    this.camera.position.copy(this._pos);
    this.camera.lookAt(this._look);
    this.running = false;
    this.finished = true;
    bus.emit('intro:end', { skipped: true });
  }

  update(dt) {
    if (!this.running) return false;

    this.t += dt / this.duration;
    if (this.t >= 1) {
      this.t = 1;
      this.running = false;
      this.finished = true;
      bus.emit('intro:end', { skipped: false });
    }

    // Ease both ends; a dolly that starts at full speed reads as a mistake.
    const eased = smoothstep(smoothstep(this.t));
    this.curve.getPointAt(eased, this._pos);
    this.targets.getPointAt(eased, this._look);
    this.camera.position.copy(this._pos);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this._look);
    return true;
  }

  /** Where the rail leaves you standing, for the Player to pick up. */
  endState() {
    this.curve.getPointAt(1, this._pos);
    return { position: this._pos.clone().setY(EYE_HEIGHT), yaw: this.endYaw };
  }
}
