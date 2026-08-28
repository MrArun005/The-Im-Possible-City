import * as THREE from 'three';
import { GeometryBuilder } from '../../gfx/instancing.js';
import { buildInstanced } from '../../gfx/instancing.js';
import {
  facadeMaterial, stoneMaterial, trimMaterial, metalMaterial,
  livingWindowMaterial, seedWindowAttributes, emissiveMaterial,
} from '../../gfx/materials.js';
import * as T from '../../gfx/textures.js';
import { makeRng } from '../../util/rng.js';

const WIDTH = 11.2;
const DEPTH = 6.2;
const STOREY = 3.2;

/**
 * NEW YORK, street level (Task 5.3) and skyline (Tasks 5.1-5.2).
 *
 * The variant system is reused wholesale from London - same GeometryBuilder,
 * same facade-at-local-z=0 convention, same window-rect protocol - which is the
 * point of §3.2: District 2 supplies assets and a grade, not new engine code.
 */

export function brownstoneArchetypes() {
  return [
    street({
      name: 'brownstone', storeys: 4, brick: 3, stoop: true, fire: true,
      tint: 0xd8b898, minScale: 0.98, maxScale: 1.15,
    }),
    street({
      name: 'walkup', storeys: 5, brick: 0, stoop: true, fire: true,
      tint: 0xc0b0a4, minScale: 1.0, maxScale: 1.2,
    }),
    street({
      name: 'storefront', storeys: 3, brick: 2, stoop: false, fire: false, shop: true,
      tint: 0xcac4c0, minScale: 0.95, maxScale: 1.05,
    }),
    street({
      name: 'tenement', storeys: 6, brick: 4, stoop: false, fire: true,
      tint: 0xaea8a2, minScale: 1.0, maxScale: 1.3,
    }),
    tower({ name: 'tower-slab', storeys: 16, tint: 0x6a7488, minScale: 1.0, maxScale: 1.9 }),
    tower({ name: 'tower-setback', storeys: 22, setbacks: 3, tint: 0x646c80, minScale: 1.0, maxScale: 1.7 }),
    tower({ name: 'tower-spire', storeys: 26, spire: true, tint: 0x606880, minScale: 1.0, maxScale: 1.6 }),
  ];
}

// -------------------------------------------------------------- street level

function street(spec) {
  const materials = {
    walls: facadeMaterial(spec.brick),
    stone: stoneMaterial(spec.brick % 3),
    trim: trimMaterial(0x121417),
    metal: metalMaterial(0x1b1e22, { roughness: 0.55, metalness: 0.7 }),
  };

  return {
    name: spec.name,
    depth: DEPTH,
    tint: spec.tint,
    minScale: spec.minScale,
    maxScale: spec.maxScale,
    materials,
    geometry: () => buildStreetFacade(spec),
    windows: (heightScale) => streetWindowRects(spec, heightScale),
  };
}

function buildStreetFacade(spec) {
  const b = new GeometryBuilder();
  const height = spec.storeys * STOREY;
  const groundH = spec.shop ? 3.8 : 3.4;

  b.box('walls', [WIDTH, height, DEPTH], [0, height / 2, -DEPTH / 2],
    { uvScale: [WIDTH / 3, height / 3] });

  // Brownstone base and cornice band.
  b.box('stone', [WIDTH + 0.18, groundH, 0.3], [0, groundH / 2, 0.08],
    { uvScale: [WIDTH / 3, groundH / 3] });
  b.box('trim', [WIDTH + 0.34, 0.2, 0.46], [0, groundH + 0.1, 0.14]);
  b.box('trim', [WIDTH + 0.5, 0.42, 0.7], [0, height + 0.12, 0.18]);

  // Sill courses.
  for (let s = 1; s < spec.storeys; s++) {
    b.box('trim', [WIDTH + 0.1, 0.1, 0.2], [0, groundH + (s - 1) * STOREY + 0.05, 0.08]);
  }

  // Stoop: the New York front step.
  if (spec.stoop) {
    for (let i = 0; i < 7; i++) {
      b.box('stone', [3.0, 0.19, 0.36], [-2.6, 0.095 + i * 0.19, 1.9 - i * 0.34]);
    }
    for (const sx of [-1, 1]) {
      b.box('stone', [0.24, 1.5, 2.6], [-2.6 + sx * 1.5, 0.75, 0.72]);
    }
  }

  /**
   * Fire escape. Zig-zagging steel across a brick facade is the single most
   * "New York" silhouette there is, and in nine boxes per storey it is free.
   */
  if (spec.fire) {
    for (let s = 1; s < spec.storeys; s++) {
      const y = groundH + (s - 1) * STOREY + 0.4;
      b.box('metal', [4.6, 0.06, 1.1], [2.6, y, 0.62]);              // platform
      b.box('metal', [4.6, 0.05, 0.05], [2.6, y + 0.9, 1.14]);       // rail
      b.box('metal', [0.05, 0.9, 0.05], [0.35, y + 0.45, 1.14]);
      b.box('metal', [0.05, 0.9, 0.05], [4.85, y + 0.45, 1.14]);
      // Ladder run between platforms, leaning the opposite way each storey.
      const lean = s % 2 ? 1 : -1;
      b.box('metal', [0.08, 3.3, 0.08], [2.6 + lean * 1.7, y + 1.6, 0.9],
        { rotation: [0.32 * lean, 0, 0] });
      b.box('metal', [0.08, 3.3, 0.08], [2.6 + lean * 1.1, y + 1.6, 0.9],
        { rotation: [0.32 * lean, 0, 0] });
    }
  }

  // Shopfront glazing frame and a bulkhead awning.
  if (spec.shop) {
    b.box('trim', [WIDTH, 0.7, 0.44], [0, groundH - 0.5, 0.24]);
    b.box('metal', [WIDTH - 0.8, 0.1, 1.6], [0, groundH - 1.05, 0.98],
      { rotation: [0.2, 0, 0] });
  }

  // Roof clutter: water tank, bulkhead, vents. Reads even in silhouette.
  b.box('metal', [2.2, 2.4, 2.2], [-3.0, height + 1.6, -DEPTH * 0.45]);
  b.box('metal', [2.5, 0.7, 2.5], [-3.0, height + 3.1, -DEPTH * 0.45]);
  for (let i = 0; i < 4; i++) {
    b.box('metal', [0.2, 1.5, 0.2], [-3.9 + i * 0.6, height + 0.5, -DEPTH * 0.45]);
  }
  b.box('walls', [2.4, 2.2, 2.4], [3.2, height + 1.1, -DEPTH * 0.55], { uvScale: [0.8, 0.7] });
  for (let i = 0; i < 3; i++) {
    b.box('metal', [0.34, 0.7, 0.34], [1.0 + i * 0.8, height + 0.45, -DEPTH * 0.3]);
  }

  return b.build();
}

function streetWindowRects(spec, heightScale) {
  const rects = [];
  const groundH = spec.shop ? 3.8 : 3.4;
  const cols = 3;
  const winW = 1.55;
  const winH = 1.9;

  for (let s = 0; s < spec.storeys - 1; s++) {
    const y = (groundH + 0.55 + s * STOREY + winH / 2) * heightScale;
    for (let c = 0; c < cols; c++) {
      const x = -WIDTH / 2 + (WIDTH / cols) * (c + 0.5);
      rects.push({ position: [x, y, 0.17], size: [winW, winH] });
    }
  }

  if (spec.shop) {
    for (let i = 0; i < 3; i++) {
      rects.push({
        position: [-WIDTH / 2 + (WIDTH / 3) * (i + 0.5), 1.9 * heightScale, 0.28],
        size: [WIDTH / 3 - 0.4, 2.3],
        lit: 'always',
      });
    }
  } else {
    rects.push({ position: [2.6, 1.9 * heightScale, 0.2], size: [1.5, 2.2], lit: 'always' });
    if (!spec.stoop) {
      rects.push({ position: [-2.6, 1.9 * heightScale, 0.2], size: [1.5, 2.2], lit: 'always' });
    }
  }
  return rects;
}

// -------------------------------------------------------------------- towers

/**
 * Tower archetypes (Task 5.1): "stretched-box towers via InstancedMesh, 3 tower
 * archetypes, per-instance height/tint". The per-instance Y scale comes from
 * the grid; the archetype only decides the silhouette.
 */
function tower(spec) {
  const materials = {
    walls: new THREE.MeshStandardMaterial({
      map: T.stone(2), color: 0xffffff, roughness: 0.78, metalness: 0.12,
    }),
    trim: trimMaterial(0x0d1015),
    metal: metalMaterial(0x1a1e26, { roughness: 0.42, metalness: 0.8 }),
  };

  return {
    name: spec.name,
    depth: DEPTH,
    tint: spec.tint,
    minScale: spec.minScale,
    maxScale: spec.maxScale,
    materials,
    geometry: () => buildTower(spec),
    windows: (heightScale) => towerWindowRects(spec, heightScale),
  };
}

function buildTower(spec) {
  const b = new GeometryBuilder();
  const height = spec.storeys * STOREY;
  const setbacks = spec.setbacks ?? 0;

  if (setbacks) {
    // Wedding-cake massing: each stage narrower and set further back.
    let y = 0;
    let w = WIDTH;
    let d = DEPTH;
    for (let i = 0; i <= setbacks; i++) {
      const stageH = height / (setbacks + 1);
      b.box('walls', [w, stageH, d], [0, y + stageH / 2, -d / 2],
        { uvScale: [w / 3, stageH / 3] });
      b.box('trim', [w + 0.3, 0.3, d + 0.3], [0, y + stageH, -d / 2]);
      y += stageH;
      w *= 0.76;
      d *= 0.82;
    }
  } else {
    b.box('walls', [WIDTH, height, DEPTH], [0, height / 2, -DEPTH / 2],
      { uvScale: [WIDTH / 3, height / 3] });
    b.box('trim', [WIDTH + 0.4, 0.4, DEPTH + 0.4], [0, height, -DEPTH / 2]);
  }

  // Ground-floor lobby band: glass and metal, brighter than the shaft.
  b.box('trim', [WIDTH + 0.2, 0.3, 0.4], [0, 4.4, 0.12]);
  b.box('metal', [WIDTH, 4.2, 0.24], [0, 2.1, 0.1]);

  if (spec.spire) {
    b.box('metal', [2.6, 6.0, 2.6], [0, height + 3.0, -DEPTH / 2]);
    b.box('metal', [1.4, 5.0, 1.4], [0, height + 8.0, -DEPTH / 2]);
    b.box('metal', [0.3, 6.0, 0.3], [0, height + 13.0, -DEPTH / 2]);
    b.box('beacon', [0.5, 0.5, 0.5], [0, height + 16.2, -DEPTH / 2]);
  }
  const slots = b.build();
  return slots;
}

function towerWindowRects(spec, heightScale) {
  const rects = [];
  const storeys = Math.floor(spec.storeys * heightScale);
  const cols = 4;
  for (let s = 1; s < storeys; s++) {
    const y = 4.6 + (s - 1) * STOREY + 1.2;
    if (y > spec.storeys * STOREY * heightScale) break;
    // Setback towers lose width as they climb.
    const shrink = spec.setbacks
      ? Math.pow(0.76, Math.floor((s / storeys) * (spec.setbacks + 1)))
      : 1;
    const w = WIDTH * shrink;
    for (let c = 0; c < cols; c++) {
      const x = -w / 2 + (w / cols) * (c + 0.5);
      rects.push({ position: [x, y, 0.17 * shrink], size: [(w / cols) * 0.66, 1.9] });
    }
  }
  return rects;
}

// -------------------------------------------------------- background skyline

/**
 * The skyline beyond the playable grid. Stretched boxes on a ring, with one
 * emissive window-grid texture whose per-instance UV offset randomises which
 * windows glow - the "living skyline for near-zero cost" of Task 5.2. Two draw
 * calls for all of Manhattan.
 */
export function buildBackgroundSkyline({
  count = 90, innerRadius = 84, outerRadius = 168, seed = 5150, maxHeight = 120,
} = {}) {
  const rng = makeRng(seed);
  const group = new THREE.Group();
  group.name = 'skyline';

  const shellMat = new THREE.MeshStandardMaterial({
    color: 0x39445c, roughness: 0.95, metalness: 0.05,
  });
  const placements = [];
  const windows = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + rng.range(-0.03, 0.03);
    const radius = rng.range(innerRadius, outerRadius);
    const t = (radius - innerRadius) / (outerRadius - innerRadius);
    // Further towers are taller, so the skyline reads as a bowl around you.
    const h = rng.range(24, maxHeight) * (0.55 + t * 0.75);
    const w = rng.range(9, 22);
    const d = rng.range(9, 22);
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;

    placements.push({
      position: [x, h / 2, z],
      rotationY: angle + Math.PI / 2,
      scale: [w, h, d],
      color: new THREE.Color(0x39445c).offsetHSL(0, 0, rng.range(-0.03, 0.05)).getHex(),
    });

    // One window plane on the face pointing inward, at the tower's full size.
    const inward = -1;
    windows.push({
      position: [
        x + Math.cos(angle) * (d / 2) * inward,
        h / 2,
        z + Math.sin(angle) * (d / 2) * inward,
      ],
      rotationY: angle + Math.PI / 2 + Math.PI,
      scale: [w * 0.94, h * 0.94, 1],
    });
  }

  const shells = buildInstanced(new THREE.BoxGeometry(1, 1, 1), shellMat, placements);
  shells.name = 'skyline:shells';
  group.add(shells);

  const winMat = livingWindowMaterial(T.towerWindows(), { cells: 4 });
  const winMesh = buildInstanced(new THREE.PlaneGeometry(1, 1), winMat, windows);
  winMesh.name = 'skyline:windows';
  if (winMesh.instanceColor) winMesh.instanceColor = null;
  // litChance 1 so no background tower goes fully dark - a black tooth in the
  // skyline reads as a bug, not as an empty building.
  seedWindowAttributes(winMesh, rng, { cells: 4, litChance: 1, maxGlow: 1.15 });
  group.add(winMesh);

  // Aircraft-warning beacons on the tallest few. Tiny, and the eye finds them.
  const beacons = placements
    .filter((p) => p.scale[1] > maxHeight * 0.8)
    .map((p) => ({ position: [p.position[0], p.scale[1] + 1.2, p.position[2]], scale: 1.2 }));
  if (beacons.length) {
    const beaconMesh = buildInstanced(
      new THREE.PlaneGeometry(1, 1),
      emissiveMaterial('#ff3a2a', 2.4, { additive: true, map: T.softDot() }),
      beacons
    );
    beaconMesh.name = 'skyline:beacons';
    group.add(beaconMesh);
    group.userData.beacons = beaconMesh;
  }

  group.userData.windowMaterial = winMat;
  return group;
}

// ------------------------------------------------------------ door buildings

/** A brownstone / diner / jazz-bar frontage with a real doorway hole. */
export function buildNycDoorBuilding(spec, { facing, rng }) {
  const group = new THREE.Group();
  group.name = `door-building:${spec.id ?? 'nyc'}`;
  const storeys = spec.storeys ?? 4;
  const height = storeys * STOREY;
  const groundH = spec.groundHeight ?? 3.8;
  const doorW = spec.doorWidth ?? 1.4;
  const doorH = spec.doorHeight ?? 2.5;
  const doorX = spec.doorX ?? -2.4;

  const b = new GeometryBuilder();
  b.wallWithHole('walls', {
    width: WIDTH, height, depth: 0.42,
    hole: [doorX, doorH / 2 + (spec.stoop ? 1.34 : 0), doorW, doorH],
    pos: [0, 0, -0.21],
  });
  // See the note in the London builder: a `hollow` frontage omits its back
  // wall and roof, because the district portal's interior is deeper than the
  // building that holds it.
  b.box('walls', [0.4, height, DEPTH], [-WIDTH / 2, height / 2, -DEPTH / 2],
    { uvScale: [DEPTH / 3, height / 3] });
  b.box('walls', [0.4, height, DEPTH], [WIDTH / 2, height / 2, -DEPTH / 2],
    { uvScale: [DEPTH / 3, height / 3] });
  if (!spec.hollow) {
    b.box('walls', [WIDTH, height, 0.4], [0, height / 2, -DEPTH],
      { uvScale: [WIDTH / 3, height / 3] });
    b.box('walls', [WIDTH, 0.4, DEPTH], [0, height, -DEPTH / 2]);
  }

  b.box('stone', [WIDTH + 0.18, 0.3, 0.32], [0, groundH, 0.06]);
  b.box('trim', [WIDTH + 0.5, 0.42, 0.66], [0, height + 0.12, 0.16]);
  for (let s = 1; s < storeys; s++) {
    b.box('trim', [WIDTH + 0.1, 0.1, 0.2], [0, groundH + (s - 1) * STOREY + 0.05, 0.07]);
  }

  // Stoop up to the door, if this frontage has one.
  if (spec.stoop) {
    for (let i = 0; i < 7; i++) {
      b.box('stone', [doorW + 1.3, 0.19, 0.36], [doorX, 0.095 + i * 0.19, 1.9 - i * 0.34]);
    }
    for (const sx of [-1, 1]) {
      b.box('metal', [0.06, 1.0, 2.4], [doorX + sx * (doorW / 2 + 0.5), 1.9, 0.8]);
    }
  } else {
    b.box('stone', [doorW + 1.0, 0.12, 0.5], [doorX, 0.06, 0.3]);
  }

  // Fire escape over the door bay - the New York read again.
  if (spec.fire !== false) {
    for (let s = 1; s < storeys; s++) {
      const y = groundH + (s - 1) * STOREY + 0.4;
      b.box('metal', [4.4, 0.06, 1.1], [2.8, y, 0.62]);
      b.box('metal', [4.4, 0.05, 0.05], [2.8, y + 0.9, 1.14]);
      b.box('metal', [0.05, 0.9, 0.05], [0.6, y + 0.45, 1.14]);
      b.box('metal', [0.05, 0.9, 0.05], [5.0, y + 0.45, 1.14]);
    }
  }

  b.box('metal', [2.2, 2.4, 2.2], [-3.2, height + 1.6, -DEPTH * 0.45]);
  b.box('metal', [2.5, 0.7, 2.5], [-3.2, height + 3.1, -DEPTH * 0.45]);

  const slots = b.build();
  const materials = {
    walls: facadeMaterial(spec.brick ?? 3),
    stone: stoneMaterial(1),
    trim: trimMaterial(0x121417),
    metal: metalMaterial(0x1b1e22, { roughness: 0.55, metalness: 0.7 }),
  };
  for (const [slot, geo] of Object.entries(slots)) {
    const mesh = new THREE.Mesh(geo, materials[slot]);
    mesh.castShadow = slot === 'walls';
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // The neon sign over the frontage (Task 5.4). Emissive plus bloom, no light.
  if (spec.neon) {
    const tex = T.neonSign(spec.neon.label, {
      color: spec.neon.color ?? '#ff3d7f',
      script: spec.neon.script,
    });
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      // Below white on purpose: additive over an already-lit brick wall
      // saturates instantly, and a sign you cannot read is not a sign.
      color: 0xb4b4b4,
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    });
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(spec.neon.width ?? 4.6, (spec.neon.width ?? 4.6) * 0.5),
      mat
    );
    const vertical = spec.neon.vertical;
    if (vertical) {
      sign.position.set(WIDTH / 2 - 0.4, groundH + 2.6, 0.9);
      sign.rotation.y = -Math.PI / 2;
    } else {
      sign.position.set(2.0, groundH - 0.9, 0.5);
    }
    sign.name = 'neon';
    group.add(sign);
    group.userData.neon = sign;
  }

  const rects = [];
  for (let s = 0; s < storeys - 1; s++) {
    const y = groundH + 0.55 + s * STOREY + 0.95;
    for (let c = 0; c < 3; c++) {
      const x = -WIDTH / 2 + (WIDTH / 3) * (c + 0.5);
      rects.push({ position: [x, y, 0.2], size: [1.55, 1.9] });
    }
  }
  // Frontage glazing beside the door, split into bays. One 4.4m pane is a
  // slab; three bays with different atlas cells is a frontage, and each is
  // forced lit because street level is what you actually walk past.
  for (let i = 0; i < 3; i++) {
    rects.push({
      position: [1.35 + i * 1.55, 1.95, 0.24],
      size: [1.35, 2.3],
      lit: 'always',
    });
  }

  return {
    group,
    depth: DEPTH,
    windowRects: rects,
    doorAnchors: [
      { slot: 0, offset: [doorX, spec.stoop ? 1.34 : 0.12, 0.04], rotationY: 0 },
    ],
  };
}

export { WIDTH as NYC_WIDTH, DEPTH as NYC_DEPTH, STOREY as NYC_STOREY };
