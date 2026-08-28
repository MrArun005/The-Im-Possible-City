import * as THREE from 'three';
import { asphaltMaterial, stoneMaterial, emissiveMaterial } from '../../gfx/materials.js';
import * as T from '../../gfx/textures.js';
import {
  brownstoneArchetypes, buildNycDoorBuilding, buildBackgroundSkyline,
} from './skyline.js';
import { MODERN_DRESSING } from '../common/dressing.js';
import { DEFAULT_CAB } from '../../world/vehicles.js';
import { NYC_ROOMS } from './rooms.js';
import { makeRng } from '../../util/rng.js';

/**
 * DISTRICT 2 - NEW YORK UNDER LIGHTS.
 *
 * Reuses every system London proved: the same grid, the same variant facades,
 * the same door component, the same crowd and traffic. What changes is assets,
 * a grade, an audio bed and door configs - which is the entire promise of §3.2.
 */

const LAYOUT = [
  'BBBBBBBBB',
  'SSSSTSSSS',   // z = -36  cross street
  'BBBBSBBBB',
  'BRBRSRBRB',   // frontages on the north side of the avenue
  'SSSSXSSSS',   // z =   0  THE AVENUE
  'BRBRSRBRB',   // frontages on the south side
  'BBBPSPBBB',
  'SSSSTSSSS',   // z = +36
  'BBBBBBBBB',
];

/**
 * Door lots in the grid's row-major scan order. Only three doors have interiors
 * (Task 5.7) plus the portal home; the rest are locked frontages that still
 * carry neon, because a street where every door opens feels like a menu.
 *
 *   0 (3,1) x=-36 z=-8.8   the brownstone   gltf  -> cubemap -> procedural
 *   1 (3,3) x=-12 z=-8.8   the Blue Note    video -> cubemap -> procedural
 *   2 (3,5) x= 12 z=-8.8   the diner        cubemap (baked)
 *   3 (3,7) x= 36 z=-8.8   hotel            locked
 *   4 (5,1) x=-36 z= 8.8   bodega           locked
 *   5 (5,3) x=-12 z= 8.8   THE CROSSING     district portal back to London
 *   6 (5,5) x= 12 z= 8.8   laundromat       locked
 *   7 (5,7) x= 36 z= 8.8   walk-up          procedural
 */
function doorLots(rooms) {
  return [
    {
      id: 'brownstone', brick: 3, storeys: 4, stoop: true, doorWidth: 1.4, doorX: -2.4,
      doors: [{
        id: 'brownstone-door',
        label: '84',
        width: 1.4,
        height: 2.5,
        doorColor: 0x44586c,
        prompt: 'Open',
        triggerRadius: 11,
        emitter: { kind: 'fireplace', gain: 0.35, maxDistance: 9 },
        interior: {
          type: 'gltf',
          src: '/districts/nyc/rooms/apartment/room.glb',
          size: rooms.apartment.size,
          recipe: rooms.apartment,
          ladder: ['gltf', 'procedural'],
        },
      }],
    },
    {
      id: 'blue-note', brick: 0, storeys: 4, doorWidth: 1.35, doorX: -2.4,
      neon: { label: 'Blue Note', color: '#4da6ff', script: true, width: 4.8, vertical: true },
      doors: [{
        id: 'jazz-bar-door',
        label: '',
        width: 1.35,
        height: 2.45,
        doorColor: 0x342830,
        spillColor: '#ff9a5a',
        prompt: 'Open the club door',
        // The jazz bar is the room the video strategy exists for - live music
        // is the thing a still 3D room can never sell.
        emitter: { kind: 'jazz', gain: 1.1, maxDistance: 28 },
        interior: {
          type: 'video',
          src: '/districts/nyc/rooms/jazz-bar/loop.mp4',
          plane: [1.5, 2.4],
          planeZ: -0.7,
          size: [2.8, 2.9, 1.8],
          recipe: rooms.jazzBar,
        },
      }],
    },
    {
      id: 'diner', brick: 2, storeys: 3, doorWidth: 1.3, doorX: -2.6, fire: false,
      neon: { label: 'DINER', color: '#ff3d7f', width: 5.0 },
      doors: [{
        id: 'diner-door',
        label: '',
        width: 1.3,
        height: 2.4,
        doorColor: 0x4a5460,
        spillColor: '#dceaff',
        prompt: 'Open',
        interior: {
          type: 'cubemap',
          recipe: rooms.diner,
          size: rooms.diner.size,
          exposure: 1.8,
          contrast: 1.35,
          saturation: 1.1,
          tint: 0xffffff,
        },
      }],
    },
    {
      id: 'hotel', brick: 4, storeys: 6, doorWidth: 1.5, doorX: 0,
      neon: { label: 'HOTEL', color: '#ffd23d', width: 4.4, vertical: true },
      doors: [{
        id: 'hotel-door',
        label: '',
        width: 1.5,
        height: 2.6,
        doorColor: 0x3c4450,
        state: 'locked',
        prompt: 'Try the door',
        lockedHint: 'The night clerk does not look up.',
        interior: { type: 'procedural', recipe: rooms.apartment },
      }],
    },
    {
      id: 'bodega', brick: 1, storeys: 4, doorWidth: 1.3, doorX: -2.4,
      neon: { label: 'BODEGA', color: '#3dff8f', width: 4.6 },
      doors: [{
        id: 'bodega-door',
        label: '',
        width: 1.3,
        height: 2.4,
        doorColor: 0x544430,
        state: 'locked',
        prompt: 'Try the door',
        lockedHint: 'Shutters down. The cat in the window watches you go.',
        interior: { type: 'procedural', recipe: rooms.diner },
      }],
    },
    {
      id: 'the-crossing-back', brick: 4, storeys: 5, doorWidth: 1.6, doorX: 0, fire: false,
      hollow: true,
      neon: { label: 'SUBWAY', color: '#8fb8ff', width: 4.8 },
      doors: [{
        id: 'the-crossing-back',
        label: '',
        width: 1.6,
        height: 2.6,
        doorColor: 0x0e1218,
        frameColor: 0x0a0c10,
        spillColor: '#ffb765',
        prompt: 'Open the way back',
        triggerRadius: 13,
        interior: { type: 'district', ...NYC_ROOMS.portalBack },
      }],
    },
    {
      id: 'laundromat', brick: 2, storeys: 3, doorWidth: 1.3, doorX: -2.4,
      neon: { label: 'WASH', color: '#ff8a3d', width: 4.0 },
      doors: [{
        id: 'laundromat-door',
        label: '',
        width: 1.3,
        height: 2.4,
        doorColor: 0x465460,
        state: 'locked',
        prompt: 'Try the door',
        lockedHint: 'One machine is still going. Nobody is watching it.',
        interior: { type: 'procedural', recipe: rooms.diner },
      }],
    },
    {
      id: 'walkup', brick: 0, storeys: 5, stoop: true, doorWidth: 1.35, doorX: -2.4,
      doors: [{
        id: 'walkup-door',
        label: '112',
        width: 1.35,
        height: 2.45,
        doorColor: 0x684034,
        prompt: 'Open',
        interior: { type: 'procedural', recipe: rooms.apartment },
      }],
    },
  ];
}

export function nycDistrict() {
  return {
    id: 'nyc',
    name: 'New York Under Lights',
    subtitle: 'The Avenue · 2 a.m. · after rain',
    seed: 1977,
    hour: 2,
    rain: 0.55,
    // New York's sky glow is brighter than London's fog, so it fills more.
    envIntensity: 0.45,
    fadeColor: '#04060a',
    skyRadius: 165,

    /** §5.6 NYC grade: cooler tonemap, higher bloom, light haze not fog. */
    grade: {
      exposure: 1.14,
      bloomStrength: 1.0,
      bloomRadius: 0.72,
      bloomThreshold: 0.7,
      saturation: 1.08,
      contrast: 1.12,
      vignette: 0.9,
      tint: '#dce8ff',
      lift: '#0a1020',
      fog: '#1a2436',
      // Haze rather than fog: you can see the skyline, it just glows.
      fogNight: 0.013,
      fogDay: 0.010,
      sunTint: '#8fa8ff',
      skyTint: '#080f20',
      horizonTint: '#46608e',
      ambientColor: '#54689a',
      tintStrength: 0.65,
      // Sky-glow from the south-west, down the avenue.
      lightAzimuth: 2.15,
      sunScale: 0.9,
      ambientScale: 1.05,
    },

    audio: '/districts/nyc/ambience.mp3',
    ambience: { bedGain: 0.17 },

    lampColor: '#ffe3b0',
    moteColor: '#b8c8e0',
    steam: { height: 7.0, color: '#9fb0c4', size: 1.1, opacity: 0.2 },

    spawn: { position: [-42, 0, 1.6], yaw: -Math.PI / 2 },
    portalArrival: { position: [-12, 0, 13.5], yaw: 0 },

    intro: {
      duration: 12,
      endYaw: -Math.PI / 2,
      // Up among the fire escapes, then down to the wet asphalt.
      path: [
        [-50, 15.0, 9.0],
        [-47, 9.5, 6.5],
        [-45, 4.8, 3.6],
        [-43, 2.2, 2.0],
        [-42, 1.6, 1.6],
      ],
      targets: [
        [-36, 16.0, -10.0],
        [-35, 9.0, -9.0],
        [-34, 3.2, -8.8],
        [-32, 1.8, -8.0],
        [-25, 1.6, -1.5],
      ],
    },

    city: {
      id: 'nyc',
      seed: 1977,
      tile: 12,
      layout: LAYOUT,
      sidewalkWidth: 3.0,
      laneOffset: 2.8,
      stripeColor: 0xd8d2c0,
      windowAtlas: () => T.windowAtlas('#ffd9a0'),
      windowLitChance: 0.8,
      windowMaxGlow: 3.0,
      roadMaterial: asphaltMaterial,
      sidewalkMaterial: () => stoneMaterial(1),
      kerbMaterial: () => stoneMaterial(0),
      archetypes: brownstoneArchetypes(),
      dressing: MODERN_DRESSING,
      doorLots: doorLots(NYC_ROOMS),
      buildDoorBuilding: buildNycDoorBuilding,
    },

    crowd: {
      style: 'modern',
      count: 20,
      color: '#0a0b12',
      height: 1.74,
      characterUrl: null,
    },

    traffic: { count: 10, archetypes: [DEFAULT_CAB] },

    /** ---------------------------------------------------- extra dressing */
    decorate(district, ctx) {
      const rng = makeRng(1977);
      const group = new THREE.Group();
      group.name = 'nyc-extras';

      // The skyline beyond the grid (Tasks 5.1-5.2).
      const skyline = buildBackgroundSkyline({
        count: ctx.quality.name === 'low' ? 44 : 92,
        innerRadius: 86,
        outerRadius: 172,
        maxHeight: ctx.quality.name === 'low' ? 80 : 120,
        seed: 5150,
      });
      group.add(skyline);

      /**
       * Wet asphalt (Task 5.3).
       *
       * The plan offers a mirrored render or SSR-lite, with "static reflection
       * cubemap -> plain roughness map with strong speculars" as the fallback.
       * A second full scene render costs more than the whole rest of the
       * district, so this deliberately takes the middle rung: a cubemap is
       * baked ONCE at load from the sky and the near neon and used as the
       * asphalt's envMap. Neon smears down the avenue and it costs one frame,
       * once. `?reflect=off` drops to the bottom rung.
       */
      if (ctx.quality.reflections && new URLSearchParams(location.search).get('reflect') !== 'off') {
        district._reflectionTarget = bakeStreetReflection(ctx, district, group);
      }

      // Hero neon signs that are not attached to a door building (Task 5.4).
      const signs = [
        { label: 'JAZZ', color: '#ff3d7f', pos: [-24, 6.4, -9.2], rotY: 0, w: 4.2 },
        { label: 'COFFEE', color: '#ffd23d', pos: [24, 5.6, -9.2], rotY: 0, w: 4.6 },
        { label: 'LIQUOR', color: '#3dffd2', pos: [-24, 5.8, 9.2], rotY: Math.PI, w: 4.6 },
        { label: 'PIZZA', color: '#ff8a3d', pos: [24, 6.2, 9.2], rotY: Math.PI, w: 4.0 },
        { label: 'Broadway', color: '#ff6ba8', pos: [0, 9.5, -33.0], rotY: 0, w: 8.0, script: true },
      ];
      const neonMeshes = [];
      for (const s of signs) {
        const mat = new THREE.MeshBasicMaterial({
          map: T.neonSign(s.label, { color: s.color, script: s.script }),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.w * 0.5), mat);
        mesh.position.fromArray(s.pos);
        mesh.rotation.y = s.rotY;
        mesh.userData.phase = rng() * 10;
        // Every neon sign has a twin glow behind it, spread wide - that halo is
        // what makes bloom read as light in air rather than as a filter.
        const halo = new THREE.Mesh(
          new THREE.PlaneGeometry(s.w * 1.9, s.w * 1.2),
          emissiveMaterial(s.color, 0.5, { additive: true, map: T.softDot() })
        );
        halo.position.copy(mesh.position);
        halo.rotation.y = s.rotY;
        group.add(mesh, halo);
        neonMeshes.push(mesh);
      }

      district.root.add(group);
      district._nyc = { neonMeshes, skyline };

      const baseUpdate = district.update.bind(district);
      district.update = (dt, playerPos) => {
        baseUpdate(dt, playerPos);
        const t = performance.now() / 1000;
        // Failing tubes and buzzing transformers: the flaw sells the sign.
        for (const mesh of neonMeshes) {
          const p = mesh.userData.phase;
          const buzz = 0.92 + 0.08 * Math.sin(t * 34 + p);
          const fail = Math.sin(t * 7.3 + p) > 0.993 ? 0.2 : 1;
          mesh.material.opacity = buzz * fail;
        }
        const beacons = skyline.userData.beacons;
        if (beacons) {
          beacons.material.opacity = Math.sin(t * 1.7) > 0.4 ? 1 : 0.05;
        }
      };
    },
  };
}

/**
 * One-time cube bake of the near street, used as the asphalt's envMap. This is
 * the "static reflection cubemap" rung of the wet-asphalt fallback ladder.
 */
function bakeStreetReflection(ctx, district, extras) {
  const size = ctx.quality.name === 'high' ? 256 : 128;
  const target = new THREE.WebGLCubeRenderTarget(size, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    type: THREE.HalfFloatType,
  });
  const cam = new THREE.CubeCamera(0.5, 240, target);
  cam.position.set(0, 3.2, 0);
  district.root.add(extras);          // the skyline must be in the bake
  district.root.add(cam);

  const prev = ctx.renderer.getRenderTarget();
  // Doors and interiors are not loaded yet at this point, which is exactly what
  // we want in a reflection: the street, the neon and the sky, nothing that moves.
  cam.update(ctx.renderer, ctx.scene);
  ctx.renderer.setRenderTarget(prev);
  district.root.remove(cam);

  const asphalt = asphaltMaterial();
  asphalt.envMap = target.texture;
  asphalt.envMapIntensity = 1.5;
  asphalt.needsUpdate = true;
  return target;
}
