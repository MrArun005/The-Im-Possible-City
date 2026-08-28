/**
 * New York interiors (Task 5.7): a brownstone apartment, a jazz bar and a
 * diner. Deliberately three DIFFERENT strategies, same as London - the district
 * changes the assets and the grade, never the machinery.
 */

/** The brownstone apartment. Warm lamp, cold TV, one radiator ticking. */
export const apartment = {
  id: 'brownstone-apartment',
  seed: 1977,
  size: [5.4, 2.9, 5.2],
  doorWidth: 1.4,
  doorHeight: 2.5,
  wallpaper: 3,
  wallStyle: 'plaster',
  wallColor: 0xa89a86,
  propWood: 1,
  floorWood: 1,
  fabricColor: 0x3a3a48,
  ceilingColor: 0x1a1a20,
  glowColor: '#ffd39a',
  nightGlassColor: '#2a3a58',
  lightPos: [1.6, 2.2, -2.0],
  lightIntensity: 2.2,
  warmth: 0.9,
  dustColor: '#e0d8c8',
  props: [
    { type: 'sofa', pos: [-1.2, 0, -1.4], rotY: 0.2 },
    { type: 'television', pos: [-1.2, 0, -4.2], rotY: 0 },
    { type: 'rug', pos: [-1.2, 0, -2.6], size: [2.8, 2.2] },
    { type: 'sidetable', pos: [0.6, 0, -1.1] },
    { type: 'lamp', pos: [0.6, 0.64, -1.1], height: 0.44 },
    { type: 'kitchenette', pos: [2.0, 0, -4.6], rotY: Math.PI, width: 2.0 },
    { type: 'radiator', pos: [-2.4, 0, -3.2], rotY: Math.PI / 2 },
    { type: 'bookshelf', pos: [2.2, 0, -1.4], rotY: -Math.PI / 2, width: 1.5, height: 2.0 },
    { type: 'window', pos: [0.2, 1.7, -5.15], width: 1.2, height: 1.7 },
    { type: 'painting', pos: [-2.6, 1.8, -2.0], rotY: Math.PI / 2, width: 0.6, height: 0.8 },
    { type: 'crate', pos: [1.9, 0, -0.7], size: 0.45 },
  ],
};

/** The jazz bar. The room the video strategy exists for. */
export const jazzBar = {
  id: 'jazz-bar',
  seed: 1959,
  size: [6.0, 3.0, 5.6],
  wallpaper: 1,
  propWood: 3,
  floorWood: 2,
  fabricColor: 0x3a1a20,
  ceilingColor: 0x120a0c,
  glowColor: '#ff9a5a',
  lightColor: '#ff7a4a',
  lightPos: [0, 2.3, -3.0],
  lightIntensity: 1.8,
  warmth: 1.1,
  dustScale: 1.6,
  dustColor: '#ffbf90',
  bakeBackground: 0x0a0406,
  props: [
    { type: 'bar', pos: [-1.4, 0, -4.6], width: 3.4 },
    { type: 'booth', pos: [2.2, 0, -2.4], rotY: -Math.PI / 2 },
    { type: 'jukebox', pos: [-2.6, 0, -1.0], rotY: 0.4 },
    { type: 'piano', pos: [1.4, 0, -5.0], rotY: -0.5 },
    { type: 'rug', pos: [-0.6, 0, -2.4], size: [3.0, 2.4] },
    { type: 'floorlamp', pos: [-2.7, 0, -3.6] },
    { type: 'neonprop', pos: [0.4, 1.9, -5.5], width: 1.6, height: 0.7 },
  ],
};

/** The diner. Chrome, formica, and one long counter. */
export const diner = {
  id: 'corner-diner',
  seed: 1962,
  size: [6.4, 3.0, 5.0],
  wallStyle: 'plaster',
  wallColor: 0xbfc4c8,
  propWood: 2,
  floorStyle: 'tile',
  floorColor: 0xd8d4cc,
  fabricColor: 0x8c2a30,
  ceilingColor: 0x2a2e32,
  glowColor: '#eaf4ff',
  lightColor: '#dceaff',
  lightPos: [0, 2.6, -2.4],
  lightIntensity: 2.8,
  warmth: 0.4,
  dustScale: 0.5,
  bakeBackground: 0x0d1116,
  props: [
    { type: 'counter', pos: [-0.4, 0, -3.8], width: 4.6 },
    { type: 'booth', pos: [2.4, 0, -1.6], rotY: -Math.PI / 2 },
    { type: 'booth', pos: [-2.4, 0, -1.6], rotY: Math.PI / 2 },
    { type: 'jukebox', pos: [2.6, 0, -4.2], rotY: -0.7 },
    { type: 'neonprop', pos: [0, 2.3, -4.9], width: 2.2, height: 0.9 },
    { type: 'window', pos: [-2.0, 1.7, -0.1], width: 1.6, height: 1.6 },
  ],
};

/** The portal back to London - a service door behind the diner. */
export const portalBack = {
  id: 'the-crossing-back',
  target: 'london',
  preview: {
    throat: 3.0,
    distance: 8,
    neon: false,
    hazeColor: '#3a2a1e',
    sky: [[0, '#0a0c12'], [0.45, '#1a1712'], [0.8, '#3a2a1c'], [1, '#5a3f28']],
    // London through a New York doorway: gaslight and brick, not neon.
    towers: [
      { position: [-6.5, 0, -12], scale: [7.0, 13, 6.0] },
      { position: [6.0, 0, -14], scale: [7.5, 15, 6.5] },
      { position: [0.0, 0, -19], scale: [9.0, 12, 7.0] },
    ],
  },
};

export const NYC_ROOMS = { apartment, jazzBar, diner, portalBack };
