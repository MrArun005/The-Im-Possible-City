import * as THREE from 'three';
import { clamp, damp } from '../util/math.js';
import { EYE_HEIGHT } from '../core/renderer.js';

/**
 * The walk controller (Task 1.7).
 *
 * No physics engine (§2 Tech Stack: "None - nav via path constraints"). Instead
 * the district supplies axis-aligned blocker rectangles and the player is
 * pushed out of them along the shallower axis. For a city of boxes on a grid
 * this is indistinguishable from real collision and costs a few comparisons.
 *
 * Eye height is EYE_HEIGHT (1.6m) everywhere, with a walk bob on top - the bob
 * is what makes a first-person camera feel like a body rather than a drone.
 */
export class Player {
  constructor(camera, input, { bounds, blockers = [] } = {}) {
    this.camera = camera;
    this.input = input;
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.enabled = false;
    this.walkSpeed = 2.3;
    this.runSpeed = 4.4;
    this.radius = 0.42;
    this.bounds = bounds ?? null;
    this.blockers = blockers;
    this.speed = 0;
    this._bobPhase = 0;
    this._bobAmount = 0;
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._wish = new THREE.Vector3();
  }

  /** Hands control over from the intro dolly (Task 1.6). */
  takeOver(camera) {
    this.position.set(camera.position.x, 0, camera.position.z);
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = clamp(Math.asin(clamp(dir.y, -1, 1)), -1.2, 1.2);
    this.enabled = true;
  }

  setBlockers(blockers) { this.blockers = blockers ?? []; }

  update(dt) {
    if (!this.enabled) return;

    // ---- look ----
    const look = this.input.consumeLook();
    this.yaw -= look.x;
    this.pitch = clamp(this.pitch - look.y, -1.15, 1.15);

    // ---- move ----
    const axes = this.input.readMove();
    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this._wish
      .copy(this._forward).multiplyScalar(axes.y)
      .addScaledVector(this._right, axes.x);

    const wishLen = this._wish.length();
    if (wishLen > 1) this._wish.divideScalar(wishLen);

    const target = (this.input.run ? this.runSpeed : this.walkSpeed) * Math.min(1, wishLen);
    // Accelerate quickly, decelerate a little slower: weight without sluggishness.
    const rate = wishLen > 0.01 ? 9 : 7;
    this.velocity.x = damp(this.velocity.x, this._wish.x * target, rate, dt);
    this.velocity.z = damp(this.velocity.z, this._wish.z * target, rate, dt);

    const next = this.position.clone().addScaledVector(this.velocity, dt);
    this._resolve(next);
    this.position.copy(next);
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);

    // ---- bob ----
    this._bobPhase += dt * this.speed * 2.1;
    this._bobAmount = damp(this._bobAmount, this.speed > 0.3 ? 1 : 0, 6, dt);
    const bobY = Math.sin(this._bobPhase * 2) * 0.022 * this._bobAmount;
    const bobX = Math.sin(this._bobPhase) * 0.016 * this._bobAmount;
    const roll = Math.sin(this._bobPhase) * 0.006 * this._bobAmount;

    this.camera.position.set(
      this.position.x + bobX * Math.cos(this.yaw),
      EYE_HEIGHT + bobY,
      this.position.z - bobX * Math.sin(this.yaw)
    );
    this.camera.rotation.set(this.pitch, this.yaw, roll, 'YXZ');
    // Three applies Euler order per the object; set it explicitly to be safe.
    this.camera.rotation.order = 'YXZ';
  }

  /** Push out of blockers, then clamp to the district bounds. */
  _resolve(next) {
    for (const b of this.blockers) {
      const minX = b[0] - this.radius;
      const maxX = b[1] + this.radius;
      const minZ = b[2] - this.radius;
      const maxZ = b[3] + this.radius;
      if (next.x <= minX || next.x >= maxX || next.z <= minZ || next.z >= maxZ) continue;

      // Inside: eject along whichever axis needs the smaller correction.
      const dxLeft = next.x - minX;
      const dxRight = maxX - next.x;
      const dzNear = next.z - minZ;
      const dzFar = maxZ - next.z;
      const min = Math.min(dxLeft, dxRight, dzNear, dzFar);
      if (min === dxLeft) { next.x = minX; this.velocity.x = Math.min(0, this.velocity.x); }
      else if (min === dxRight) { next.x = maxX; this.velocity.x = Math.max(0, this.velocity.x); }
      else if (min === dzNear) { next.z = minZ; this.velocity.z = Math.min(0, this.velocity.z); }
      else { next.z = maxZ; this.velocity.z = Math.max(0, this.velocity.z); }
    }

    if (this.bounds) {
      next.x = clamp(next.x, this.bounds[0], this.bounds[1]);
      next.z = clamp(next.z, this.bounds[2], this.bounds[3]);
    }
  }

  teleport(x, z, yaw) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    if (yaw != null) this.yaw = yaw;
    this.camera.position.set(x, EYE_HEIGHT, z);
  }
}
