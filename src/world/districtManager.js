import { District } from './district.js';
import { bus } from '../util/events.js';
import { clearTextureCache } from '../gfx/textures.js';
import { clearMaterialCache } from '../gfx/materials.js';

/**
 * District streaming (§3.2 "only one fully loaded at a time", Step 8.3).
 *
 * The swap sequence, in order, because the order is what makes it feel like a
 * cut in a film rather than a loading screen:
 *   1. fade to black over ~0.4s while the grade begins lerping
 *   2. deactivate the old district, load the new one behind the black
 *   3. move the player to the new spawn, apply the new grade and audio bed
 *   4. fade in; dispose the old district a beat later, off the critical path
 */
export class DistrictManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.registry = new Map();
    this.current = null;
    this.switching = false;
  }

  register(config) {
    this.registry.set(config.id, config);
    return this;
  }

  has(id) { return this.registry.has(id); }

  /** Loads and activates a district, disposing whatever was there. */
  async goTo(id, { instant = false, onProgress = () => {}, keepPlayer = false } = {}) {
    if (this.switching) return this.current;
    const config = this.registry.get(id);
    if (!config) throw new Error(`unknown district "${id}"`);
    if (this.current?.id === id) return this.current;

    this.switching = true;
    const outgoing = this.current;

    if (!instant && outgoing) {
      this.ctx.postfx.fadeTo(1, config.fadeColor ?? '#000000');
      await wait(420);
    }

    outgoing?.deactivate();

    const district = new District(config, this.ctx);
    await district.load(onProgress);
    this.ctx.scene.add(district.root);
    this.current = district;

    if (!keepPlayer) {
      const spawn = district.spawn;
      this.ctx.player?.teleport(spawn.position[0], spawn.position[2], spawn.yaw);
    }
    district.activate({ instant });

    if (!instant) {
      this.ctx.postfx.fadeTo(0);
    }

    // Dispose the old district after the fade, so the frame that reveals the
    // new one is never the frame that frees a hundred buffers.
    if (outgoing) {
      setTimeout(() => {
        outgoing.dispose();
        bus.emit('district:disposed', { id: outgoing.id });
      }, 900);
    }

    this.switching = false;
    bus.emit('district:changed', { id, name: config.name });
    return district;
  }

  /**
   * Walking through a portal door. The player arrives just inside the target
   * district's portal-arrival point, facing into it, so the transition reads as
   * continuous movement rather than a teleport.
   */
  async traversePortal(target, { onProgress } = {}) {
    const config = this.registry.get(target);
    if (!config) {
      console.warn(`[districts] portal points at unknown district "${target}"`);
      return null;
    }
    const district = await this.goTo(target, { onProgress, keepPlayer: true });
    const arrival = config.portalArrival ?? config.spawn;
    this.ctx.player?.teleport(arrival.position[0], arrival.position[2], arrival.yaw);
    return district;
  }

  update(dt, playerPos) { this.current?.update(dt, playerPos); }

  dispose() {
    this.current?.dispose();
    this.current = null;
    clearMaterialCache();
    clearTextureCache();
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
