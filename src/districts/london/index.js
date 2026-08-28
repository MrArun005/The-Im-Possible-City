import * as THREE from 'three';
import { cobbleMaterial, stoneMaterial, puddleMaterial, trimMaterial } from '../../gfx/materials.js';
import * as T from '../../gfx/textures.js';
import { victorianArchetypes, buildLondonDoorBuilding } from './facades.js';
import { VICTORIAN_DRESSING } from '../common/dressing.js';
import { HANSOM_CAB } from '../../world/vehicles.js';
import { LONDON_ROOMS } from './rooms.js';
import { makeRng } from '../../util/rng.js';

/**
 * DISTRICT 1 - VICTORIAN LONDON.
 *
 * Everything district-specific is here: the layout, the grade, the door
 * configs, the audio bed. No engine code, by design (§3.2).
 *
 * The five live doors (Task 1.8) deliberately use five DIFFERENT interior
 * strategies, so the fallback ladder is exercised in production on every single
 * load rather than sitting in a document:
 *
 *   221B          gltf     -> falls back to a baked cubemap, then procedural
 *   The parlour   procedural (with the piano emitter behind it)
 *   Pawnbroker    cubemap  (baked from its own recipe at load)
 *   Rooming house video    -> falls back to cubemap, then procedural
 *   Sitting room  splat    -> falls back to gltf, cubemap, then procedural
 *   The Crossing  district (the portal to New York)
 *   Observatory   procedural, locked until after dark (the secret)
 */

/**
 * Layout. 'R' lots are door buildings, 'B' are instanced terraces, 'S/C/T/X'
 * are road, 'P' is a plaza. One long high street with a crossroads.
 */
const LAYOUT = [
  'BBBBBBBBB',
  'SSSSTSSSS',   // z = -36  side street
  'BBBBSBBBB',
  'BRBRSRBRB',   // door lots fronting the high street from the north
  'SSSSXSSSS',   // z =   0  THE HIGH STREET
  'BRBRSRBRB',   // door lots fronting it from the south
  'BBBPSPBBB',
  'SSSSTSSSS',   // z = +36  side street
  'BBBBBBBBB',
];

/**
 * The eight door lots, in the grid's row-major scan order. Each carries the
 * hero door that belongs in it, so positions are derived from the layout and
 * never hand-tuned - move a letter in LAYOUT and the door moves with it.
 *
 * Scan order and resulting positions (tile 12, sidewalk 2.8):
 *   0 (3,1) x=-36 z=-8.8 facing south    221B            gltf
 *   1 (3,3) x=-12 z=-8.8 facing south    the parlour     procedural (ajar)
 *   2 (3,5) x= 12 z=-8.8 facing south    the pawnbroker  cubemap
 *   3 (3,7) x= 36 z=-8.8 facing south    rooms to let    video
 *   4 (5,1) x=-36 z= 8.8 facing north    the sitting room splat
 *   5 (5,3) x=-12 z= 8.8 facing north    number 13       procedural (secret)
 *   6 (5,5) x= 12 z= 8.8 facing north    THE CROSSING    district portal
 *   7 (5,7) x= 36 z= 8.8 facing north    the chandler    procedural (locked)
 */
function doorLots(rooms) {
  return [
    {
      id: 'baker-street', sign: 'Baker Street', brick: 1, storeys: 4, doorWidth: 1.4,
      doors: [{
        id: 'baker-street-221b',
        label: '221B',
        width: 1.4,
        height: 2.5,
        doorColor: 0x4a6a58,
        prompt: 'Open 221B',
        triggerRadius: 11,
        emitter: { kind: 'fireplace', gain: 0.75, maxDistance: 13 },
        // Rung 1: a real GLB, if one is present under public/districts.
        interior: {
          type: 'gltf',
          src: '/districts/london/rooms/study/room.glb',
          size: rooms.study.size,
          recipe: rooms.study,
          // The hero door skips the cubemap rung: if there is no GLB, a live
          // procedural room with dust in the lamplight and a flickering fire
          // beats a frozen bake. This is the door the project is judged on.
          ladder: ['gltf', 'procedural'],
        },
      }],
    },
    {
      id: 'parlour-house', sign: 'Wigmore & Sons', brick: 0, storeys: 3, doorWidth: 1.3,
      doors: [{
        id: 'parlour-door',
        label: '14',
        width: 1.3,
        height: 2.4,
        doorColor: 0x7a3a42,
        state: 'ajar',
        prompt: 'Push it open',
        // The muffled piano behind one specific door (Task 2.5).
        emitter: { kind: 'piano', gain: 1.0, maxDistance: 24 },
        interior: { type: 'procedural', recipe: rooms.parlour },
      }],
    },
    {
      id: 'pawnbroker', sign: 'S. Grimsby, Pawnbroker', brick: 2, storeys: 3, doorWidth: 1.25,
      doors: [{
        id: 'pawnbroker-door',
        label: '9',
        width: 1.25,
        height: 2.35,
        doorColor: 0x42586a,
        prompt: 'Open the shop door',
        // Baked cubemap: one draw call, no lights, full parallax.
        interior: {
          type: 'cubemap',
          recipe: rooms.pawnshop,
          size: rooms.pawnshop.size,
          exposure: 1.9,
          contrast: 1.4,
          saturation: 0.95,
          flicker: 0.35,
        },
      }],
    },
    {
      id: 'rooming-house', sign: 'Rooms to Let', brick: 3, storeys: 3, doorWidth: 1.3,
      doors: [{
        id: 'rooming-house-door',
        label: '31',
        width: 1.3,
        height: 2.4,
        doorColor: 0x6a4e30,
        prompt: 'Open',
        emitter: { kind: 'fireplace', gain: 0.4, maxDistance: 10 },
        // Rung 1 video. Drop a loop.mp4 in and it plays; otherwise the ladder
        // drops to a cubemap baked from the parlour recipe.
        interior: {
          type: 'video',
          src: '/districts/london/rooms/rooming-house/loop.mp4',
          plane: [1.3, 2.3],
          planeZ: -0.6,
          size: [2.4, 2.7, 1.6],
          recipe: rooms.parlour,
        },
      }],
    },
    {
      id: 'sitting-room', sign: 'No. 7', brick: 0, storeys: 3, doorWidth: 1.35,
      doors: [{
        id: 'sitting-room-door',
        label: '7',
        width: 1.35,
        height: 2.45,
        doorColor: 0x3e5464,
        prompt: 'Open',
        // Rung 1 splat - see docs/SPLAT-CAPTURE.md for the capture recipe.
        interior: {
          type: 'splat',
          src: '/districts/london/rooms/sitting-room/room.spz',
          size: [4.8, 3.0, 5.2],
          recipe: rooms.study,
          calibration: { scale: 1, quaternion: [1, 0, 0, 0], offset: [0, 0, -2.4] },
        },
      }],
    },
    {
      id: 'number-13', sign: 'XIII', brick: 2, storeys: 3, doorWidth: 1.3,
      doors: [{
        id: 'the-observatory',
        label: '13',
        width: 1.3,
        height: 2.45,
        doorColor: 0x2a3444,
        state: 'locked',
        prompt: 'Try the handle',
        lockedHint: 'Locked. Something moves behind the fanlight.',
        // The secret (Task 3.5): openable only between 8pm and 5am.
        secret: { afterHour: 20, beforeHour: 5, hint: 'Number 13 gives after dark.' },
        interior: { type: 'procedural', recipe: rooms.secretRoom },
      }],
    },
    {
      id: 'the-crossing', sign: 'Underground', brick: 4, storeys: 3, doorWidth: 1.6,
      hollow: true,
      doors: [{
        id: 'the-crossing',
        label: 'W',
        width: 1.6,
        height: 2.6,
        doorColor: 0x0e1218,
        frameColor: 0x0a0c10,
        spillColor: '#8fb8ff',
        prompt: 'Open the way through',
        triggerRadius: 13,
        // The portal (Task 5.8 / Step 8). Walking through swaps districts.
        interior: { type: 'district', ...rooms.portalVestibule },
      }],
    },
    {
      id: 'chandler', sign: 'Chandler & Wick', brick: 1, storeys: 3, doorWidth: 1.25,
      doors: [{
        id: 'chandler-door',
        label: '22',
        width: 1.25,
        height: 2.35,
        doorColor: 0x584430,
        state: 'locked',
        prompt: 'Try the handle',
        lockedHint: 'Shut for the night. A candle still burns upstairs.',
        interior: { type: 'procedural', recipe: rooms.pawnshop },
      }],
    },
  ];
}

export function londonDistrict() {
  return {
    id: 'london',
    name: 'Victorian London',
    subtitle: 'Baker Street · 1891 · fog after rain',
    seed: 1891,
    hour: 21.5,
    rain: 0.35,
    // Sky IBL fill. Enough that no facade is ever a black slab, low enough
    // that the gaslights and the lit windows still carry the night.
    envIntensity: 0.3,
    fadeColor: '#05070c',

    /** §3.2 grade block: fog, tonemap, bloom, ambient colour. */
    grade: {
      exposure: 1.2,
      bloomStrength: 0.82,
      bloomRadius: 0.62,
      bloomThreshold: 0.72,
      saturation: 0.86,
      contrast: 1.08,
      vignette: 1.05,
      tint: '#ffe7cc',
      lift: '#100c08',
      // Read by TimeOfDay. London is warm and hazy: the fog is a VISIBLE
      // brown-grey, not a black void. Density is the one number to reach for
      // when the city looks janky (see the risk register) - but past ~0.035 it
      // stops being atmosphere and starts being a wall.
      fog: '#3e352c',
      fogNight: 0.019,
      fogDay: 0.013,
      sunTint: '#ffc79a',
      skyTint: '#141a26',
      horizonTint: '#6a4c30',
      ambientColor: '#6a5a48',
      tintStrength: 0.6,
      // Moon low in the south-east, raking along the high street and across
      // the north row of door facades.
      lightAzimuth: 0.95,
      sunScale: 1.1,
      ambientScale: 0.95,
    },

    // A real recording, if one is ever dropped in; synthesised otherwise.
    audio: '/districts/london/ambience.mp3',
    ambience: { bedGain: 0.11 },

    lampColor: '#ffb765',
    moteColor: '#e0cba8',
    steam: { height: 4.5, color: '#9c968c', size: 0.75, opacity: 0.16 },

    // Standing on the high street, looking east down the row of doors.
    spawn: { position: [-42, 0, 1.6], yaw: -Math.PI / 2 },
    // Coming back through the portal puts you on the pavement outside it.
    portalArrival: { position: [12, 0, 13.5], yaw: 0 },

    /** Intro rail dolly (Task 1.6): down the street, then up to eye level. */
    intro: {
      duration: 13,
      endYaw: -Math.PI / 2,
      // High and wide, then down to 1.6m: the move establishes the eye height
      // and the fog before it hands you the keys, and it ends on 221B.
      path: [
        [-50, 8.5, 7.5],
        [-47, 5.4, 5.4],
        [-45, 3.2, 3.2],
        [-43, 2.0, 2.0],
        [-42, 1.6, 1.6],
      ],
      targets: [
        [-40, 4.5, -6.0],
        [-38, 3.2, -7.6],
        [-36, 2.1, -8.8],
        [-35, 1.7, -8.0],
        [-26, 1.6, -1.5],
      ],
    },

    /** ---------------------------------------------------- the city grid */
    city: {
      id: 'london',
      seed: 1891,
      tile: 12,
      layout: LAYOUT,
      sidewalkWidth: 2.8,
      laneOffset: 2.4,
      stripeColor: 0xa8a090,
      windowAtlas: () => T.windowAtlas('#ffb765'),
      windowLitChance: 0.72,
      windowMaxGlow: 2.6,
      roadMaterial: cobbleMaterial,
      sidewalkMaterial: () => stoneMaterial(0),
      kerbMaterial: () => stoneMaterial(2),
      archetypes: victorianArchetypes(),
      dressing: VICTORIAN_DRESSING,
      doorLots: doorLots(LONDON_ROOMS),
      buildDoorBuilding: buildLondonDoorBuilding,
    },

    crowd: {
      style: 'victorian',
      count: 18,
      color: '#0a0908',
      height: 1.7,
      // Drop a rigged GLB here and the crowd upgrades itself (see people.js).
      characterUrl: null,
    },

    traffic: { count: 6, archetypes: [HANSOM_CAB] },

    /**
     * Every hero door lives in its door lot above, so the grid decides where it
     * goes. This array is for anything that is not attached to a lot at all.
     */
    doors: [],

    /** Extra set dressing that is too specific for the grid to guess. */
    decorate(district, ctx) {
      const rng = makeRng(1891);
      const group = new THREE.Group();
      group.name = 'london-extras';

      // Puddles on the cobbles (Task 1.4), pooling near the kerb.
      const puddleMat = puddleMaterial();
      const puddleGeo = new THREE.PlaneGeometry(2.6, 1.7).rotateX(-Math.PI / 2);
      const puddles = new THREE.InstancedMesh(puddleGeo, puddleMat, 26);
      const m = new THREE.Matrix4();
      const flat = new THREE.Quaternion();
      for (let i = 0; i < 26; i++) {
        const x = rng.range(-48, 48);
        const z = rng.range(-48, 48);
        m.compose(
          new THREE.Vector3(x, 0.018, z),
          flat,
          new THREE.Vector3(rng.range(0.6, 1.7), 1, rng.range(0.6, 1.5))
        );
        puddles.setMatrixAt(i, m);
      }
      puddles.instanceMatrix.needsUpdate = true;
      puddles.name = 'puddles';
      group.add(puddles);

      // A hanging shop sign that swings a little, because stillness reads dead.
      const signMat = new THREE.MeshStandardMaterial({ map: T.shopSign('Tobacconist'), roughness: 0.7 });
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 0.5), signMat);
      sign.position.set(-8.6, 3.1, 6.6);
      const bracket = new THREE.Mesh(
        new THREE.BoxGeometry(1.2, 0.06, 0.06),
        trimMaterial(0x14110e)
      );
      bracket.position.set(-9.4, 3.4, 6.6);
      group.add(sign, bracket);

      district.root.add(group);
      district._extras = { sign, puddleMat };

      // Swing the sign from the district's own update hook.
      const baseUpdate = district.update.bind(district);
      district.update = (dt, playerPos) => {
        baseUpdate(dt, playerPos);
        const t = performance.now() / 1000;
        sign.rotation.z = Math.sin(t * 0.9) * 0.05 + Math.sin(t * 2.3) * 0.012;
        puddleMat.opacity = 0.45 + district.weather.amount * 0.5;
      };
    },
  };
}
