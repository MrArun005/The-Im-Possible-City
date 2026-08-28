/**
 * The prop library (§5.2 "Kitbash", Task 0.5).
 *
 * DEVIATION FROM THE PLAN: the plan kitbashes rooms in Blender from downloaded
 * Victorian furniture. This repo cannot ship third-party GLBs, so the kitbash
 * happens here instead - low-poly furniture assembled from boxes into shared
 * material slots. Composition and lighting over asset quality, exactly as §5.2
 * demands; a fireplace made of eleven boxes with the right firelight on it
 * outreads a 40k-triangle armchair lit flat. The `gltf` interior strategy is
 * still wired up and preferred whenever a real .glb is present.
 *
 * Every builder writes into slots on a shared GeometryBuilder, so an entire
 * room merges down to roughly six draw calls.
 */

const PI = Math.PI;

/** Adds a prop by name. Unknown names are ignored rather than thrown. */
export function addProp(b, type, o = {}) {
  const fn = PROPS[type];
  if (!fn) {
    console.warn(`[props] unknown prop "${type}"`);
    return;
  }
  const at = o.pos ?? [0, 0, 0];
  const rot = o.rotY ?? 0;
  fn(new Placer(b, at, rot), o);
}

/**
 * Places boxes in a prop's local frame and rotates them into the room.
 * Props are authored facing +Z at the origin and never worry about placement.
 */
class Placer {
  constructor(builder, origin, rotY) {
    this.b = builder;
    this.o = origin;
    this.r = rotY;
    this.cos = Math.cos(rotY);
    this.sin = Math.sin(rotY);
  }

  box(slot, size, pos, opts = {}) {
    const [x, y, z] = pos;
    const wx = x * this.cos + z * this.sin;
    const wz = -x * this.sin + z * this.cos;
    this.b.box(slot, size, [this.o[0] + wx, this.o[1] + y, this.o[2] + wz], {
      rotation: [0, this.r + (opts.tilt ?? 0), 0],
      ...opts,
    });
    return this;
  }

  /** A box with a free rotation, for tilted things: chair backs, leaning books. */
  tilted(slot, size, pos, rotation, opts = {}) {
    const [x, y, z] = pos;
    const wx = x * this.cos + z * this.sin;
    const wz = -x * this.sin + z * this.cos;
    this.b.box(slot, size, [this.o[0] + wx, this.o[1] + y, this.o[2] + wz], {
      rotation: [rotation[0] || 0, (rotation[1] || 0) + this.r, rotation[2] || 0],
      ...opts,
    });
    return this;
  }

  plane(slot, size, pos, rotation = [0, 0, 0], opts = {}) {
    const [x, y, z] = pos;
    const wx = x * this.cos + z * this.sin;
    const wz = -x * this.sin + z * this.cos;
    this.b.plane(slot, size, [this.o[0] + wx, this.o[1] + y, this.o[2] + wz], {
      rotation: [rotation[0] || 0, (rotation[1] || 0) + this.r, rotation[2] || 0],
      ...opts,
    });
    return this;
  }

  /** Four legs under a top of size [w, d] at height h. */
  legs(slot, w, d, h, thickness = 0.05) {
    const hx = w / 2 - thickness;
    const hz = d / 2 - thickness;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        this.box(slot, [thickness, h, thickness], [sx * hx, h / 2, sz * hz]);
      }
    }
  }
}

const PROPS = {
  // ------------------------------------------------------------- Victorian
  /** Wingback armchair, angled at the fire. The hero prop of the study. */
  armchair(p) {
    p.box('fabric', [0.78, 0.16, 0.74], [0, 0.42, 0]);              // seat
    p.tilted('fabric', [0.78, 0.9, 0.14], [0, 0.86, -0.32], [-0.1, 0, 0]); // back
    p.box('fabric', [0.13, 0.44, 0.72], [-0.36, 0.62, 0]);          // arms
    p.box('fabric', [0.13, 0.44, 0.72], [0.36, 0.62, 0]);
    p.box('fabric', [0.1, 0.62, 0.2], [-0.36, 1.0, -0.24]);         // wings
    p.box('fabric', [0.1, 0.62, 0.2], [0.36, 1.0, -0.24]);
    p.box('wood', [0.09, 0.34, 0.09], [-0.3, 0.17, 0.28]);
    p.box('wood', [0.09, 0.34, 0.09], [0.3, 0.17, 0.28]);
    p.box('wood', [0.09, 0.34, 0.09], [-0.3, 0.17, -0.28]);
    p.box('wood', [0.09, 0.34, 0.09], [0.3, 0.17, -0.28]);
    p.box('fabric', [0.5, 0.1, 0.4], [0, 0.55, 0.06]);              // cushion
  },

  /** Writing desk with a drawer bank and a scatter of papers. */
  desk(p) {
    p.box('wood', [1.5, 0.07, 0.72], [0, 0.76, 0]);
    p.box('wood', [0.42, 0.66, 0.66], [-0.5, 0.4, 0]);
    p.box('wood', [0.42, 0.66, 0.66], [0.5, 0.4, 0]);
    for (let i = 0; i < 3; i++) {
      p.box('dark', [0.36, 0.16, 0.03], [-0.5, 0.22 + i * 0.2, 0.34]);
      p.box('brass', [0.05, 0.05, 0.04], [-0.5, 0.22 + i * 0.2, 0.36]);
    }
    p.box('paper', [0.3, 0.008, 0.22], [0.18, 0.8, 0.06], { tilt: 0.12 });
    p.box('paper', [0.28, 0.006, 0.2], [0.3, 0.81, -0.04], { tilt: -0.3 });
    p.box('dark', [0.07, 0.09, 0.07], [-0.1, 0.84, -0.1]);          // inkwell
  },

  /** Floor-to-ceiling bookcase. The books texture does the heavy lifting. */
  bookshelf(p, o) {
    const h = o.height ?? 2.2;
    const w = o.width ?? 1.4;
    p.box('wood', [w, h, 0.06], [0, h / 2, -0.14]);
    p.box('wood', [0.07, h, 0.32], [-w / 2, h / 2, 0]);
    p.box('wood', [0.07, h, 0.32], [w / 2, h / 2, 0]);
    p.box('wood', [w, 0.05, 0.32], [0, h - 0.03, 0]);
    const shelves = Math.max(2, Math.round(h / 0.42));
    for (let i = 1; i < shelves; i++) {
      p.box('wood', [w - 0.14, 0.04, 0.3], [0, (h / shelves) * i, 0]);
    }
    // Book faces, offset slightly forward so the spines catch the lamplight.
    for (let i = 0; i < shelves; i++) {
      p.plane('books', [w - 0.18, h / shelves - 0.1], [0, (h / shelves) * (i + 0.5) - 0.02, 0.02], [0, 0, 0]);
    }
  },

  /** Fireplace: mantel, surround, grate, and a hearth for the firelight. */
  fireplace(p, o) {
    const w = o.width ?? 1.5;
    p.box('stonework', [w, 0.12, 0.34], [0, 1.16, 0]);               // mantel
    p.box('stonework', [0.26, 1.1, 0.3], [-w / 2 + 0.13, 0.55, 0]);  // jambs
    p.box('stonework', [0.26, 1.1, 0.3], [w / 2 - 0.13, 0.55, 0]);
    p.box('stonework', [w - 0.52, 0.22, 0.3], [0, 0.99, 0]);         // lintel
    p.box('dark', [w - 0.52, 0.86, 0.42], [0, 0.43, -0.2]);          // firebox
    p.box('stonework', [w + 0.2, 0.06, 0.7], [0, 0.03, 0.2]);        // hearth stone
    for (let i = 0; i < 5; i++) {
      p.box('metal', [0.035, 0.3, 0.035], [-0.28 + i * 0.14, 0.2, 0.02]); // grate
    }
    p.box('dark', [0.5, 0.14, 0.26], [0, 0.16, -0.06]);              // coal bed
    // On the mantel: a clock and two candlesticks. Silhouette detail.
    p.box('wood', [0.2, 0.26, 0.12], [0, 1.35, 0]);
    p.box('brass', [0.05, 0.18, 0.05], [-w / 2 + 0.24, 1.31, 0]);
    p.box('brass', [0.05, 0.18, 0.05], [w / 2 - 0.24, 1.31, 0]);
  },

  /** Oil/gas lamp. The emissive globe is the room's key light. */
  lamp(p, o) {
    const h = o.height ?? 0.42;
    p.box('brass', [0.16, 0.03, 0.16], [0, 0.015, 0]);
    p.box('brass', [0.05, h * 0.5, 0.05], [0, h * 0.28, 0]);
    p.box('glow', [0.2, h * 0.42, 0.2], [0, h * 0.72, 0]);          // shade / globe
    p.box('brass', [0.22, 0.02, 0.22], [0, h * 0.94, 0]);
  },

  /** Standing floor lamp, for the far corner of a room. */
  floorlamp(p) {
    p.box('brass', [0.24, 0.04, 0.24], [0, 0.02, 0]);
    p.box('brass', [0.05, 1.42, 0.05], [0, 0.72, 0]);
    p.box('glow', [0.34, 0.3, 0.34], [0, 1.56, 0]);
  },

  sidetable(p) {
    p.box('wood', [0.52, 0.05, 0.52], [0, 0.62, 0]);
    p.legs('wood', 0.52, 0.52, 0.6, 0.045);
    p.box('wood', [0.44, 0.04, 0.44], [0, 0.24, 0]);
  },

  /** Round tea table with a cup - the "someone was just here" detail. */
  teatable(p) {
    p.box('wood', [0.66, 0.05, 0.66], [0, 0.58, 0]);
    p.box('wood', [0.1, 0.56, 0.1], [0, 0.28, 0]);
    p.box('wood', [0.4, 0.04, 0.4], [0, 0.03, 0]);
    p.box('paper', [0.09, 0.07, 0.09], [0.12, 0.64, 0.04]);
    p.box('paper', [0.16, 0.01, 0.16], [0.12, 0.61, 0.04]);
    p.box('paper', [0.24, 0.005, 0.3], [-0.14, 0.61, -0.02], { tilt: 0.4 });
  },

  /** Chesterfield sofa. */
  sofa(p) {
    p.box('fabric', [1.9, 0.18, 0.82], [0, 0.44, 0]);
    p.tilted('fabric', [1.9, 0.66, 0.16], [0, 0.78, -0.36], [-0.12, 0, 0]);
    p.box('fabric', [0.16, 0.5, 0.8], [-0.94, 0.63, 0]);
    p.box('fabric', [0.16, 0.5, 0.8], [0.94, 0.63, 0]);
    for (let i = -1; i <= 1; i++) p.box('fabric', [0.56, 0.12, 0.5], [i * 0.6, 0.58, 0.06]);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      p.box('wood', [0.08, 0.3, 0.08], [sx * 0.82, 0.15, sz * 0.32]);
    }
  },

  /** Upright piano - and, behind the right door, the source of the music. */
  piano(p) {
    p.box('dark', [1.5, 1.2, 0.6], [0, 0.6, 0]);
    p.box('dark', [1.5, 0.1, 0.24], [0, 0.78, 0.36]);
    p.box('paper', [1.16, 0.03, 0.16], [0, 0.8, 0.42]);            // keys
    for (let i = 0; i < 16; i++) p.box('dark', [0.03, 0.03, 0.1], [-0.55 + i * 0.073, 0.83, 0.4]);
    p.box('dark', [1.54, 0.08, 0.66], [0, 1.24, 0]);
    p.box('brass', [0.12, 0.12, 0.03], [0.5, 0.62, 0.31]);
    p.box('wood', [0.5, 0.05, 0.34], [0, 0.5, 0.66]);              // stool
    p.legs('wood', 0.5, 0.34, 0.48, 0.04);
  },

  /** Persian rug: one plane, huge payoff. */
  rug(p, o) {
    p.plane('rug', [o.size?.[0] ?? 2.4, o.size?.[1] ?? 1.8], [0, 0.012, 0], [-PI / 2, 0, 0]);
  },

  /** Framed painting or mirror on a wall. */
  painting(p, o) {
    const w = o.width ?? 0.6;
    const h = o.height ?? 0.78;
    p.box('brass', [w + 0.08, h + 0.08, 0.05], [0, 0, 0]);
    p.plane(o.slot ?? 'paper', [w, h], [0, 0, 0.032], [0, 0, 0]);
  },

  /** Tall case clock. A silhouette that instantly says "old house". */
  clock(p) {
    p.box('wood', [0.42, 2.0, 0.28], [0, 1.0, 0]);
    p.box('dark', [0.3, 0.9, 0.04], [0, 0.9, 0.15]);
    p.box('paper', [0.28, 0.28, 0.03], [0, 1.72, 0.15]);
    p.box('wood', [0.5, 0.16, 0.34], [0, 2.06, 0]);
    p.box('brass', [0.1, 0.1, 0.04], [0, 1.72, 0.18]);
  },

  /** Hat stand by the door - the prop that implies a person just left. */
  hatstand(p) {
    p.box('wood', [0.3, 0.04, 0.3], [0, 0.02, 0]);
    p.box('wood', [0.06, 1.72, 0.06], [0, 0.86, 0]);
    p.box('wood', [0.34, 0.05, 0.05], [0, 1.6, 0]);
    p.box('dark', [0.3, 0.1, 0.3], [0.1, 1.66, 0]);                // hat brim
    p.box('dark', [0.2, 0.18, 0.2], [0.1, 1.78, 0]);               // crown
    p.box('fabric', [0.18, 0.7, 0.12], [-0.14, 1.2, 0]);           // hanging coat
  },

  /** Chemistry bench - the detail that makes a study *his* study. */
  chemistry(p) {
    p.box('wood', [1.1, 0.06, 0.5], [0, 0.86, 0]);
    p.legs('wood', 1.1, 0.5, 0.84, 0.05);
    p.box('glass', [0.1, 0.22, 0.1], [-0.3, 1.0, 0]);
    p.box('glass', [0.08, 0.3, 0.08], [-0.12, 1.04, 0.06]);
    p.box('glass', [0.14, 0.14, 0.14], [0.1, 0.96, -0.04]);
    p.box('glow', [0.05, 0.06, 0.05], [0.1, 0.86, -0.04]);         // burner flame
    p.box('metal', [0.04, 0.3, 0.04], [0.3, 1.01, 0]);
    p.box('metal', [0.2, 0.02, 0.14], [0.3, 1.15, 0]);
  },

  /** Sash window with night behind it - lets an interior have an outside. */
  window(p, o) {
    const w = o.width ?? 0.9;
    const h = o.height ?? 1.5;
    p.box('trim', [w + 0.16, 0.1, 0.12], [0, h / 2 + 0.05, 0]);
    p.box('trim', [w + 0.16, 0.1, 0.12], [0, -h / 2 - 0.05, 0]);
    p.box('trim', [0.1, h, 0.12], [-w / 2 - 0.05, 0, 0]);
    p.box('trim', [0.1, h, 0.12], [w / 2 + 0.05, 0, 0]);
    p.box('trim', [w, 0.06, 0.08], [0, 0, 0]);
    p.box('trim', [0.05, h, 0.08], [0, 0, 0]);
    p.plane('nightglass', [w, h], [0, 0, -0.05], [0, 0, 0]);
    p.box('fabric', [0.2, h + 0.2, 0.1], [-w / 2 - 0.08, 0, 0.12]);
    p.box('fabric', [0.2, h + 0.2, 0.1], [w / 2 + 0.08, 0, 0.12]);
  },

  // ------------------------------------------------------------------ NYC
  /** Diner booth. */
  booth(p) {
    p.box('fabric', [1.5, 0.16, 0.62], [0, 0.42, -0.5]);
    p.tilted('fabric', [1.5, 0.82, 0.14], [0, 0.84, -0.78], [-0.08, 0, 0]);
    p.box('fabric', [1.5, 0.16, 0.62], [0, 0.42, 0.5]);
    p.tilted('fabric', [1.5, 0.82, 0.14], [0, 0.84, 0.78], [0.08, 0, 0]);
    p.box('paper', [1.3, 0.05, 0.7], [0, 0.74, 0]);
    p.box('metal', [0.1, 0.72, 0.1], [0, 0.36, 0]);
  },

  /** Diner counter with stools and a chrome edge. */
  counter(p, o) {
    const w = o.width ?? 3.4;
    p.box('paper', [w, 0.08, 0.78], [0, 0.98, 0]);
    p.box('metal', [w, 0.06, 0.84], [0, 1.03, 0]);
    p.box('fabric', [w, 0.92, 0.6], [0, 0.46, -0.1]);
    const stools = Math.floor(w / 0.7);
    for (let i = 0; i < stools; i++) {
      const x = -w / 2 + 0.45 + i * 0.7;
      p.box('metal', [0.07, 0.62, 0.07], [x, 0.31, 0.62]);
      p.box('fabric', [0.32, 0.09, 0.32], [x, 0.66, 0.62]);
    }
  },

  /** Bar with bottles behind - a jazz-bar back wall in nine boxes. */
  bar(p, o) {
    const w = o.width ?? 3.0;
    p.box('wood', [w, 1.06, 0.66], [0, 0.53, 0]);
    p.box('dark', [w, 0.07, 0.8], [0, 1.09, 0]);
    p.box('wood', [w, 1.9, 0.3], [0, 0.95, -1.1]);
    for (let i = 0; i < 3; i++) p.box('wood', [w, 0.05, 0.3], [0, 0.6 + i * 0.5, -0.95]);
    for (let i = 0; i < 14; i++) {
      const x = -w / 2 + 0.2 + (i % 7) * (w / 7.4);
      const shelf = Math.floor(i / 7);
      p.box('glass', [0.09, 0.3, 0.09], [x, 0.79 + shelf * 0.5, -0.95]);
    }
    p.box('glow', [w - 0.3, 0.04, 0.06], [0, 1.62, -0.82]);        // shelf strip light
  },

  jukebox(p) {
    p.box('wood', [0.8, 1.3, 0.5], [0, 0.65, 0]);
    p.box('glow', [0.6, 0.44, 0.06], [0, 0.92, 0.26]);
    p.box('dark', [0.6, 0.3, 0.06], [0, 0.5, 0.26]);
    p.box('glow', [0.06, 0.9, 0.06], [-0.4, 0.75, 0.24]);
    p.box('glow', [0.06, 0.9, 0.06], [0.4, 0.75, 0.24]);
  },

  /** Cheap city bed - a rented room, not a hotel. */
  bed(p) {
    p.box('wood', [1.42, 0.28, 2.0], [0, 0.24, 0]);
    p.box('fabric', [1.4, 0.2, 1.98], [0, 0.46, 0]);
    p.box('paper', [1.3, 0.1, 1.2], [0, 0.58, 0.3]);
    p.box('paper', [0.66, 0.16, 0.36], [-0.3, 0.63, -0.76]);
    p.box('wood', [1.46, 0.7, 0.08], [0, 0.55, -1.02]);
  },

  radiator(p) {
    for (let i = 0; i < 9; i++) p.box('metal', [0.07, 0.62, 0.18], [-0.32 + i * 0.08, 0.36, 0]);
    p.box('metal', [0.78, 0.07, 0.18], [0, 0.68, 0]);
    p.box('metal', [0.78, 0.07, 0.18], [0, 0.06, 0]);
  },

  /** Kitchenette: stove, sink, a bulb over it. */
  kitchenette(p, o) {
    const w = o.width ?? 1.8;
    p.box('dark', [w, 0.9, 0.62], [0, 0.45, 0]);
    p.box('metal', [w, 0.06, 0.66], [0, 0.93, 0]);
    p.box('dark', [0.6, 0.04, 0.44], [-w / 2 + 0.4, 0.96, 0]);
    for (const [dx, dz] of [[-0.14, -0.1], [0.14, -0.1], [-0.14, 0.12], [0.14, 0.12]]) {
      p.box('metal', [0.14, 0.02, 0.14], [-w / 2 + 0.4 + dx, 0.99, dz]);
    }
    p.box('metal', [0.5, 0.1, 0.4], [w / 2 - 0.45, 0.9, 0]);
    p.box('metal', [0.04, 0.3, 0.04], [w / 2 - 0.45, 1.08, -0.16]);
    p.box('glow', [0.16, 0.12, 0.16], [0, 1.92, 0]);
    p.box('dark', [0.02, 0.5, 0.02], [0, 2.2, 0]);
  },

  /** TV, on, in a dark room. Cold blue against warm tungsten. */
  television(p) {
    p.box('dark', [0.9, 0.62, 0.5], [0, 0.65, 0]);
    p.box('coldglow', [0.7, 0.44, 0.04], [0, 0.7, 0.26]);
    p.box('dark', [0.24, 0.34, 0.24], [0, 0.17, 0]);
    p.box('metal', [0.02, 0.4, 0.02], [0.2, 1.14, -0.1], { tilt: 0.3 });
  },

  /** Neon sign hung inside a window, seen from the street too. */
  neonprop(p, o) {
    p.plane('neon', [o.width ?? 1.1, o.height ?? 0.5], [0, 0, 0], [0, 0, 0]);
  },

  crate(p, o) {
    const s = o.size ?? 0.5;
    p.box('wood', [s, s, s], [0, s / 2, 0]);
    p.box('dark', [s + 0.02, 0.03, s + 0.02], [0, s * 0.8, 0]);
    p.box('dark', [s + 0.02, 0.03, s + 0.02], [0, s * 0.2, 0]);
  },
};

export const PROP_NAMES = Object.keys(PROPS);
