/**
 * Stub for @sparkjsdev/spark in the single-file build.
 *
 * The real splat renderer is ~4.8MB of JS plus a WASM worker. In the normal
 * build it is lazily imported and only fetched when a splat door is approached.
 * A single-file bundle has nowhere to lazily fetch from, so it is aliased to
 * this instead: the splat door's top rung throws, the fallback ladder catches
 * it, and the door opens on the next rung down. Which is the whole point of
 * having a ladder.
 */
const unavailable = () => {
  throw new Error('splat renderer is not bundled in the single-file build');
};

export class SparkRenderer { constructor() { unavailable(); } }
export class SplatMesh { constructor() { unavailable(); } }
