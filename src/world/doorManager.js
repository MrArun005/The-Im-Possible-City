import * as THREE from 'three';
import { Door } from './door.js';
import { createInterior } from './interior.js';
import { BUDGETS } from '../core/budgets.js';
import { bus } from '../util/events.js';

/**
 * Owns every door in the active district: interaction, streaming and the
 * threshold crossing that swaps districts.
 *
 * Streaming rules (Step 4 lifecycle, §3.4 budgets):
 *   - preload the interior when the player is inside `triggerRadius` (~8m)
 *   - dispose it beyond `disposeRadius` (~20m)
 *   - never more than BUDGETS.loadedInteriors alive; the furthest is evicted
 *   - only the single nearest interior is "focused", so realtime lights stay
 *     inside the 3-light budget
 */
export class DoorManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.doors = [];
    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 4.2;
    this.pointer = new THREE.Vector2();
    this.nearest = null;
    this.focused = null;
    this._interactables = [];
    this._tmp = new THREE.Vector3();
    this._crossCheck = new THREE.Vector3();
    this._lastPlayerSide = new Map();

    this._onPointerDown = this._onPointerDown.bind(this);
    ctx.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
  }

  add(config) {
    const door = new Door(config, {
      ...this.ctx,
      loadInterior: (d) => this._loadInterior(d),
    });
    this.doors.push(door);
    this.ctx.scene.add(door.root);
    this._interactables = this.doors.flatMap((d) => d.interactables);
    return door;
  }

  addAll(configs) { return (configs ?? []).map((c) => this.add(c)); }

  get(id) { return this.doors.find((d) => d.id === id); }

  _loadInterior(door) {
    const spec = {
      id: door.id,
      size: door.cfg.interior?.size,
      ...door.cfg.interior,
    };
    return createInterior(spec, this.ctx);
  }

  // ------------------------------------------------------------ interaction
  /**
   * Click-to-open (Step 2). A pointerdown that lands on a door's panel or
   * handle toggles it, but only if the player is close enough to reach it -
   * clicking a door from across the street would feel like a cheat code.
   */
  _onPointerDown(event) {
    if (this.ctx.input?.hasTouch) return;   // touch uses the action button
    if (this.ctx.uiBlocked) return;

    const locked = document.pointerLockElement === this.ctx.renderer.domElement;
    if (locked) {
      this.pointer.set(0, 0);              // pointer-locked: aim is screen centre
    } else {
      this.pointer.set(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1
      );
    }

    this.raycaster.setFromCamera(this.pointer, this.ctx.camera);
    const hit = this.raycaster.intersectObjects(this._interactables, false)[0];
    if (!hit) return;

    const door = this.doors.find((d) => d.interactables.includes(hit.object));
    door?.toggle();
  }

  /** Keyboard/touch "use" - always acts on the nearest door in front of you. */
  activateNearest() {
    this.nearest?.toggle();
    return this.nearest;
  }

  // ----------------------------------------------------------------- update
  update(dt, playerPos) {
    let nearest = null;
    let nearestDist = Infinity;
    const candidates = [];

    for (const door of this.doors) {
      const dist = playerPos.distanceTo(door.worldPosition);
      door._dist = dist;

      // Facing test: a door you are behind should not prompt.
      this._tmp.subVectors(playerPos, door.worldPosition).normalize();
      const outward = new THREE.Vector3(0, 0, 1).applyQuaternion(door.root.quaternion);
      const facing = this._tmp.dot(outward);

      if (dist < (door.cfg.triggerRadius ?? 8)) {
        if (facing > -0.25) candidates.push(door);
        // Secret doors (Task 3.5) unlock themselves when the hour is right.
        this._updateSecret(door);
      }

      if (dist < nearestDist && dist < 3.4 && facing > 0.1) {
        nearest = door;
        nearestDist = dist;
      }

      if (dist > (door.cfg.disposeRadius ?? 20) && door.interior && !door.open) {
        door.unloadInterior();
      }

      door.update(dt, this.ctx);
      this._checkThreshold(door, playerPos);
    }

    this._stream(candidates, playerPos);
    this._setNearest(nearest);
    this._hover();
  }

  /** Preload nearest first, evict the furthest, respect the interior budget. */
  _stream(candidates, playerPos) {
    candidates.sort((a, b) => a._dist - b._dist);
    const loaded = this.doors.filter((d) => d.interior || d.interiorPromise);
    const budget = Math.min(BUDGETS.loadedInteriors, this.ctx.quality.maxLoadedInteriors);

    for (const door of candidates) {
      if (door.interior || door.interiorPromise) continue;
      if (loaded.length >= budget) {
        // Evict the furthest closed door to make room for a nearer one.
        const evictable = loaded
          .filter((d) => !d.open && d !== door)
          .sort((a, b) => b._dist - a._dist)[0];
        if (!evictable || evictable._dist <= door._dist) break;
        evictable.unloadInterior();
        loaded.splice(loaded.indexOf(evictable), 1);
      }
      door.preload();
      loaded.push(door);
    }

    // Focus exactly one interior, so lights stay inside budget.
    const focus = loaded.filter((d) => d.interior).sort((a, b) => a._dist - b._dist)[0] ?? null;
    if (focus !== this.focused) {
      this.focused?.interior?.setFocused(false);
      focus?.interior?.setFocused(true);
      this.focused = focus;
    }
  }

  _setNearest(door) {
    if (this.nearest === door) return;
    this.nearest = door;
    bus.emit('door:nearest', door
      ? {
          id: door.id,
          state: door.state,
          open: door.open,
          label: door.cfg.prompt ?? (door.open ? 'Close' : 'Open'),
        }
      : null);
  }

  /** Hover glow on handles (Task 2.7). */
  _hover() {
    this.raycaster.setFromCamera(
      this.ctx.input?.pointerLocked || this.ctx.input?.hasTouch
        ? ZERO
        : (this.ctx.input?.pointer ?? ZERO),
      this.ctx.camera
    );
    const hit = this.raycaster.intersectObjects(this._interactables, false)[0];
    const hovered = hit ? this.doors.find((d) => d.interactables.includes(hit.object)) : null;
    for (const door of this.doors) door.setHovered(door === hovered);
  }

  /** The secret door (Task 3.5): locked by day, openable after dark. */
  _updateSecret(door) {
    const secret = door.cfg.secret;
    if (!secret) return;
    const hour = this.ctx.timeOfDay?.hour ?? 22;
    const isNight = secret.afterHour <= secret.beforeHour
      ? hour >= secret.afterHour && hour < secret.beforeHour
      : hour >= secret.afterHour || hour < secret.beforeHour;
    const wanted = isNight ? 'openable' : 'locked';
    if (door.state !== wanted) {
      door.setState(wanted);
      if (isNight) bus.emit('secret:available', { id: door.id, hint: secret.hint });
    }
  }

  /**
   * District portal (Step 8.3): watch for the player crossing the plane of a
   * portal door while it is open, and fire once.
   */
  _checkThreshold(door, playerPos) {
    if (!door.interior?.isPortal || !door.open) return;
    door.root.worldToLocal(this._crossCheck.copy(playerPos));
    const inside = this._crossCheck.z < -0.05;
    const withinWidth = Math.abs(this._crossCheck.x) < door.cfg.width * 0.75;
    const was = this._lastPlayerSide.get(door.id) ?? false;
    this._lastPlayerSide.set(door.id, inside && withinWidth);

    if (!was && inside && withinWidth) {
      bus.emit('portal:cross', { id: door.id, target: door.interior.target, door });
    }
  }

  loadedInteriorCount() {
    return this.doors.filter((d) => d.interior).length;
  }

  dispose() {
    this.ctx.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    for (const door of this.doors) door.dispose();
    this.doors = [];
    this._interactables = [];
    this.nearest = null;
    this.focused = null;
  }
}

const ZERO = new THREE.Vector2(0, 0);
