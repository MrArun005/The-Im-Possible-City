import { ProceduralInterior } from './interiors/procedural.js';
import { CubemapInterior } from './interiors/cubemap.js';
import { GltfInterior } from './interiors/gltf.js';
import { VideoInterior } from './interiors/video.js';
import { SplatInterior } from './interiors/splat.js';
import { DistrictPortalInterior } from './interiors/district.js';
import { bus } from '../util/events.js';

/**
 * The swappable interior system (§3.1 / Step 4) - and the fallback ladder that
 * is the whole philosophy of this project made executable.
 *
 * A door names the interior it *wants*. If that rung fails - file missing,
 * decoder unavailable, over the triangle budget, autoplay refused, WASM
 * blocked - we drop to the next rung and log it, loudly, but the street never
 * notices. Nothing in the city can be broken by a missing asset.
 *
 *   splat  -> gltf -> cubemap -> procedural
 *   gltf   -> cubemap -> procedural
 *   video  -> cubemap -> procedural
 *   cubemap-> procedural
 *   procedural (the floor: it needs no files at all, so it cannot fail)
 */

const STRATEGIES = {
  procedural: (spec, ctx) => new ProceduralInterior(spec.recipe ?? spec, ctx),
  cubemap: (spec, ctx) => new CubemapInterior(spec, ctx),
  gltf: (spec, ctx) => new GltfInterior(spec, ctx),
  video: (spec, ctx) => new VideoInterior(spec, ctx),
  splat: (spec, ctx) => new SplatInterior(spec, ctx),
  district: (spec, ctx) => new DistrictPortalInterior(spec, ctx),
};

const LADDERS = {
  splat: ['splat', 'gltf', 'cubemap', 'procedural'],
  gltf: ['gltf', 'cubemap', 'procedural'],
  video: ['video', 'cubemap', 'procedural'],
  cubemap: ['cubemap', 'procedural'],
  procedural: ['procedural'],
  district: ['district'],
};

/** Rungs that were actually used, for the Definition-of-Done audit. */
export const ladderLog = [];

export async function createInterior(spec, ctx) {
  const requested = spec.type ?? 'procedural';
  /**
   * A door may override its own ladder with `interior.ladder`. This matters for
   * hero doors: the default gltf ladder stops at `cubemap`, which is cheap and
   * parallax-correct but frozen - no dust in the light shaft, no fire flicker.
   * For the door the whole project is judged on, a full procedural room is the
   * better second choice even though it costs more.
   */
  const ladder = spec.ladder ?? LADDERS[requested] ?? ['procedural'];

  for (let rung = 0; rung < ladder.length; rung++) {
    const type = ladder[rung];
    const factory = STRATEGIES[type];
    if (!factory) continue;

    try {
      // A rung with no source cannot run - except `procedural` and `district`,
      // which are generated, and `cubemap`, which bakes from a recipe.
      if (needsSrc(type) && !spec.src) {
        throw new Error(`no src for "${type}" strategy`);
      }

      const interior = factory(spec, ctx);
      if (interior.load) await interior.load();
      interior.strategy = type;
      interior.requestedStrategy = requested;
      interior.fellBack = rung > 0;

      const entry = { id: spec.id, requested, used: type, rung };
      ladderLog.push(entry);
      if (rung > 0) {
        console.warn(
          `[interior:${spec.id}] fallback ladder: "${requested}" -> "${type}" (rung ${rung})`
        );
        bus.emit('ladder:fallback', entry);
      }
      return interior;
    } catch (err) {
      console.warn(`[interior:${spec.id}] rung "${type}" failed: ${err.message}`);
      if (rung === ladder.length - 1) throw err;
    }
  }
  return null;
}

function needsSrc(type) {
  return type === 'gltf' || type === 'video' || type === 'splat';
}

export { STRATEGIES, LADDERS };
