/**
 * London interiors, as recipes (Task 0.5, 1.8).
 *
 * A recipe is data: a box, a palette and a prop list. The `procedural` strategy
 * builds it; the `cubemap` strategy bakes it to six faces and throws the
 * geometry away. The same recipe therefore serves two rungs of the ladder, and
 * a real .glb or .spz can replace either without touching the street.
 *
 * Composition rule (§5.2): the fire is always off-centre, the chair is always
 * angled at it, and there is always something on a table that implies a person
 * left the room thirty seconds ago.
 */

/** 221B Baker Street. The hero room; everything else is judged against it. */
export const study = {
  id: 'baker-street-study',
  seed: 1881,
  size: [5.2, 3.1, 5.6],
  doorWidth: 1.4,
  doorHeight: 2.5,
  wallpaper: 0,
  propWood: 0,
  floorWood: 0,
  fabricColor: 0x53302a,
  trimColor: 0x1a1512,
  ceilingColor: 0x18130f,
  glowColor: '#ffcf90',
  lightPos: [1.4, 2.1, -2.2],
  lightIntensity: 2.6,
  lightRange: 8,
  warmth: 1.15,
  dustScale: 1.2,
  dustColor: '#ffd9a8',
  nightGlassColor: '#1a2636',
  fire: { pos: [-2.1, 0, -2.6], intensity: 5.4, range: 7 },
  props: [
    { type: 'fireplace', pos: [-2.1, 0, -2.72], rotY: Math.PI / 2, width: 1.6 },
    { type: 'armchair', pos: [-0.75, 0, -2.0], rotY: -1.05 },
    { type: 'armchair', pos: [-1.0, 0, -0.5], rotY: -2.2 },
    { type: 'teatable', pos: [-1.55, 0, -1.3] },
    { type: 'rug', pos: [-1.2, 0, -1.6], size: [3.0, 2.6] },
    { type: 'desk', pos: [1.5, 0, -4.6], rotY: Math.PI },
    { type: 'lamp', pos: [1.4, 0.83, -4.6], height: 0.46 },
    { type: 'chemistry', pos: [2.0, 0, -2.1], rotY: -Math.PI / 2 },
    { type: 'bookshelf', pos: [-2.3, 0, -5.3], width: 1.8, height: 2.5 },
    { type: 'bookshelf', pos: [0.2, 0, -5.3], width: 1.6, height: 2.5 },
    { type: 'clock', pos: [2.3, 0, -5.1], rotY: -0.2 },
    { type: 'hatstand', pos: [2.2, 0, -0.55], rotY: -0.6 },
    { type: 'window', pos: [0.4, 1.75, -5.55] },
    { type: 'painting', pos: [-2.55, 1.9, -3.6], rotY: Math.PI / 2, width: 0.7, height: 0.9 },
    { type: 'floorlamp', pos: [-2.3, 0, -0.7] },
  ],
};

/** The parlour behind the piano door. */
export const parlour = {
  id: 'parlour',
  seed: 1874,
  size: [5.0, 3.0, 5.0],
  wallpaper: 1,
  propWood: 3,
  floorWood: 1,
  fabricColor: 0x3a2438,
  glowColor: '#ffbe78',
  lightPos: [0, 2.2, -2.4],
  lightIntensity: 2.2,
  warmth: 0.95,
  fire: { pos: [2.0, 0, -2.4], intensity: 4.2, range: 6 },
  props: [
    { type: 'piano', pos: [-1.3, 0, -4.2], rotY: 0.16 },
    { type: 'fireplace', pos: [2.28, 0, -2.4], rotY: -Math.PI / 2, width: 1.4 },
    { type: 'sofa', pos: [0.4, 0, -1.0], rotY: Math.PI },
    { type: 'rug', pos: [0.4, 0, -2.2], size: [3.2, 2.4] },
    { type: 'sidetable', pos: [1.9, 0, -0.9] },
    { type: 'lamp', pos: [1.9, 0.64, -0.9], height: 0.4 },
    { type: 'painting', pos: [0.4, 1.95, -4.92], width: 1.1, height: 0.8 },
    { type: 'floorlamp', pos: [-2.2, 0, -1.2] },
    { type: 'window', pos: [2.3, 1.7, -4.9], rotY: 0.0 },
  ],
};

/** The pawnbroker's back room - colder, meaner, greener light. */
export const pawnshop = {
  id: 'pawnshop',
  seed: 1866,
  size: [4.6, 2.9, 4.4],
  wallpaper: 2,
  wallStyle: 'plaster',
  propWood: 2,
  floorStyle: 'tile',
  fabricColor: 0x2a3230,
  glowColor: '#c9e2b0',
  lightPos: [0, 2.1, -2.0],
  lightIntensity: 1.6,
  warmth: 0.6,
  dustScale: 0.7,
  props: [
    { type: 'counter', pos: [0, 0, -1.4], width: 3.2 },
    { type: 'bookshelf', pos: [-1.4, 0, -4.1], width: 1.6, height: 2.4 },
    { type: 'bookshelf', pos: [0.9, 0, -4.1], width: 1.5, height: 2.4 },
    { type: 'clock', pos: [2.0, 0, -3.9], rotY: -0.3 },
    { type: 'crate', pos: [-1.9, 0, -0.7], size: 0.6 },
    { type: 'crate', pos: [-1.9, 0.6, -0.7], size: 0.45 },
    { type: 'lamp', pos: [0, 1.06, -1.5], height: 0.38 },
  ],
};

/**
 * The secret room (Task 3.5). Behind the door that only opens after dark.
 * Deliberately over-lit and over-dressed: a reward should feel like a reward.
 */
export const secretRoom = {
  id: 'the-observatory',
  seed: 1889,
  size: [5.4, 3.6, 5.4],
  wallpaper: 3,
  propWood: 3,
  floorWood: 3,
  fabricColor: 0x24304a,
  ceilingColor: 0x080a14,
  glowColor: '#a8c8ff',
  nightGlassColor: '#0b1428',
  lightColor: '#9fc0ff',
  lightPos: [0, 2.8, -2.6],
  lightIntensity: 2.0,
  warmth: 0.7,
  dustScale: 1.8,
  dustColor: '#cfe0ff',
  fire: { pos: [-2.3, 0, -1.4], intensity: 3.4, range: 5 },
  props: [
    { type: 'desk', pos: [0, 0, -4.4], rotY: Math.PI },
    { type: 'lamp', pos: [-0.6, 0.83, -4.4], height: 0.44 },
    { type: 'chemistry', pos: [2.0, 0, -3.4], rotY: -Math.PI / 2 },
    { type: 'bookshelf', pos: [-2.5, 0, -3.6], rotY: Math.PI / 2, width: 2.2, height: 3.0 },
    { type: 'armchair', pos: [1.2, 0, -1.4], rotY: -2.4 },
    { type: 'rug', pos: [0, 0, -2.4], size: [3.4, 2.8] },
    { type: 'fireplace', pos: [-2.5, 0, -1.4], rotY: Math.PI / 2, width: 1.3 },
    { type: 'window', pos: [0, 2.3, -5.35], width: 2.4, height: 1.9 },
    { type: 'clock', pos: [2.3, 0, -0.9], rotY: -0.8 },
  ],
};

/** The subway/underground vestibule that becomes the portal to New York. */
export const portalVestibule = {
  id: 'the-crossing',
  target: 'nyc',
  preview: {
    throat: 3.4,
    distance: 10,
    neonLabel: 'BROADWAY',
    neonColor: '#ff3d7f',
    hazeColor: '#2b3a58',
    sky: [[0, '#04070f'], [0.42, '#0e1a30'], [0.78, '#2c3a58'], [1, '#5a4048']],
  },
};

export const LONDON_ROOMS = { study, parlour, pawnshop, secretRoom, portalVestibule };
