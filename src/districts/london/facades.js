import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GeometryBuilder } from '../../gfx/instancing.js';
import { facadeMaterial, stoneMaterial, trimMaterial } from '../../gfx/materials.js';
import * as T from '../../gfx/textures.js';

/**
 * Victorian facades (Tasks 1.1-1.3).
 *
 * One hero facade, five variants (Task 1.2) driven by storey count, brick
 * palette, bay windows, shopfronts and roof line. Each variant merges down to
 * two geometries - brick and trim - and is then instanced across the street
 * with a per-instance Y-scale and hue shift.
 *
 * Windows are NOT part of the merged geometry: they are returned as rects and
 * collected into the district-wide living-window InstancedMesh, so every sash
 * in London is individually lit for one draw call (see CityGrid._buildWindows).
 */

const WIDTH = 11.2;
const DEPTH = 6.2;
const STOREY = 3.05;

export function victorianArchetypes() {
  return [
    archetype({
      name: 'terrace-tall', storeys: 4, brick: 0, bay: false, shop: false,
      parapet: 'cornice', tint: 0xd8ccc0, minScale: 0.95, maxScale: 1.12,
    }),
    archetype({
      name: 'terrace-bay', storeys: 3, brick: 1, bay: true, shop: false,
      parapet: 'gable', tint: 0xe0cebc, minScale: 0.98, maxScale: 1.1,
    }),
    archetype({
      name: 'shopfront', storeys: 3, brick: 2, bay: false, shop: true,
      parapet: 'cornice', tint: 0xccc4bc, minScale: 0.94, maxScale: 1.06,
    }),
    archetype({
      name: 'townhouse', storeys: 4, brick: 3, bay: false, shop: false,
      parapet: 'balustrade', tint: 0xe8d4be, minScale: 1.0, maxScale: 1.18,
    }),
    archetype({
      name: 'warehouse', storeys: 3, brick: 4, bay: false, shop: false,
      parapet: 'flat', tint: 0xc0b8ae, minScale: 1.05, maxScale: 1.3,
    }),
  ];
}

function archetype(spec) {
  const materials = {
    walls: facadeMaterial(spec.brick),
    stone: stoneMaterial(spec.brick % 3),
    trim: trimMaterial(0x14110e),
  };

  return {
    name: spec.name,
    depth: DEPTH,
    tint: spec.tint,
    minScale: spec.minScale,
    maxScale: spec.maxScale,
    materials,
    geometry: () => buildFacade(spec),
    windows: (heightScale) => windowRects(spec, heightScale),
  };
}

function buildFacade(spec) {
  const b = new GeometryBuilder();
  const storeys = spec.storeys;
  const height = storeys * STOREY;
  const groundH = spec.shop ? 3.5 : 3.2;

  // ---- the block ----
  b.box('walls', [WIDTH, height, DEPTH], [0, height / 2, -DEPTH / 2],
    { uvScale: [WIDTH / 3, height / 3] });

  // ---- ground floor in stone, so the street reads as heavier at the bottom ----
  b.box('stone', [WIDTH + 0.16, groundH, 0.3], [0, groundH / 2, 0.08],
    { uvScale: [WIDTH / 3, groundH / 3] });
  b.box('stone', [WIDTH + 0.3, 0.16, 0.5], [0, groundH + 0.08, 0.16]);

  // ---- string courses between storeys ----
  for (let s = 1; s < storeys; s++) {
    b.box('trim', [WIDTH + 0.2, 0.12, 0.24], [0, groundH + (s - 1) * STOREY + 0.06, 0.1]);
  }

  // ---- bay window box ----
  if (spec.bay) {
    const bayW = 3.4;
    const bayH = STOREY * 2 - 0.4;
    b.box('walls', [bayW, bayH, 0.9], [-2.4, groundH + bayH / 2, 0.42],
      { uvScale: [bayW / 3, bayH / 3] });
    b.box('trim', [bayW + 0.24, 0.16, 1.1], [-2.4, groundH + bayH + 0.08, 0.44]);
    b.box('trim', [bayW + 0.24, 0.14, 1.1], [-2.4, groundH - 0.06, 0.44]);
  }

  // ---- shopfront: fascia, pilasters, stall riser ----
  if (spec.shop) {
    b.box('trim', [WIDTH, 0.62, 0.42], [0, groundH - 0.42, 0.22]);
    for (const sx of [-1, 1]) {
      b.box('trim', [0.34, groundH - 0.7, 0.4], [sx * (WIDTH / 2 - 0.3), (groundH - 0.7) / 2, 0.22]);
    }
    b.box('trim', [WIDTH - 1.2, 0.5, 0.36], [0, 0.28, 0.24]);
    // Awning.
    b.box('awning', [WIDTH - 0.8, 0.1, 1.5], [0, groundH - 0.9, 0.9],
      { rotation: [0.22, 0, 0] });
  }

  // ---- roof line ----
  const top = height;
  if (spec.parapet === 'cornice') {
    b.box('trim', [WIDTH + 0.5, 0.34, 0.62], [0, top + 0.1, 0.14]);
    b.box('stone', [WIDTH + 0.2, 0.5, DEPTH * 0.4], [0, top + 0.45, -DEPTH * 0.2]);
  } else if (spec.parapet === 'gable') {
    b.box('trim', [WIDTH + 0.3, 0.24, 0.5], [0, top + 0.1, 0.1]);
    // Stepped gable in three boxes.
    for (let i = 0; i < 3; i++) {
      const w = WIDTH * (0.72 - i * 0.2);
      b.box('walls', [w, 0.7, 0.6], [0, top + 0.5 + i * 0.7, 0.02],
        { uvScale: [w / 3, 0.24] });
    }
  } else if (spec.parapet === 'balustrade') {
    b.box('stone', [WIDTH + 0.3, 0.2, 0.5], [0, top + 0.1, 0.1]);
    for (let i = 0; i < 11; i++) {
      b.box('stone', [0.16, 0.6, 0.16], [-WIDTH / 2 + 0.5 + i * (WIDTH - 1) / 10, top + 0.5, 0.1]);
    }
    b.box('stone', [WIDTH + 0.3, 0.16, 0.5], [0, top + 0.88, 0.1]);
  } else {
    b.box('stone', [WIDTH + 0.24, 0.9, 0.42], [0, top + 0.45, 0.08]);
  }

  // ---- chimney stacks and pots. The London skyline in six boxes. ----
  for (const sx of [-1, 1]) {
    b.box('walls', [1.1, 2.1, 1.1], [sx * (WIDTH / 2 - 1.1), top + 1.0, -DEPTH * 0.62],
      { uvScale: [0.4, 0.7] });
    for (let i = 0; i < 3; i++) {
      b.box('stone', [0.24, 0.5, 0.24],
        [sx * (WIDTH / 2 - 1.1) - 0.32 + i * 0.32, top + 2.3, -DEPTH * 0.62]);
    }
  }

  // ---- railings and area steps at the pavement ----
  if (!spec.shop) {
    for (let i = 0; i < 15; i++) {
      b.box('trim', [0.05, 1.0, 0.05], [-WIDTH / 2 + 0.4 + i * (WIDTH - 0.8) / 14, 0.5, 0.75]);
    }
    b.box('trim', [WIDTH - 0.6, 0.07, 0.07], [0, 1.02, 0.75]);
  }

  const slots = b.build();
  // The awning shares the trim material but wants its own colour; merge it in.
  if (slots.awning) {
    slots.trim = slots.trim
      ? mergeTwo(slots.trim, slots.awning)
      : slots.awning;
    delete slots.awning;
  }
  return slots;
}

function mergeTwo(a, b) {
  const merged = mergeGeometries([a, b], false);
  a.dispose();
  b.dispose();
  return merged;
}

/**
 * Sash-window rects, in the facade's local space. Returned rather than merged so
 * the district can put every window in the city into one instanced mesh.
 */
function windowRects(spec, heightScale) {
  const rects = [];
  const storeys = spec.storeys;
  const groundH = spec.shop ? 3.5 : 3.2;
  const cols = spec.name === 'warehouse' ? 4 : 3;
  const winW = spec.name === 'warehouse' ? 1.9 : 1.5;
  const winH = 1.85;

  for (let s = 0; s < storeys - 1; s++) {
    // Upper storeys get shorter windows - real Georgian/Victorian proportion.
    const shrink = 1 - s * 0.11;
    const y = (groundH + 0.5 + s * STOREY + (winH * shrink) / 2) * heightScale;

    for (let c = 0; c < cols; c++) {
      const x = -WIDTH / 2 + (WIDTH / cols) * (c + 0.5);
      // The bay window occupies the left two storeys, so skip behind it.
      if (spec.bay && s < 2 && x < -1.0) continue;
      rects.push({ position: [x, y, 0.17], size: [winW, winH * shrink] });
    }

    if (spec.bay && s < 2) {
      const bayY = (groundH + 0.5 + s * STOREY + winH / 2) * heightScale;
      rects.push({ position: [-2.4, bayY, 0.9], size: [2.6, winH * 0.95] });
      rects.push({ position: [-4.15, bayY, 0.44], size: [0.7, winH * 0.95], rotationY: Math.PI / 2 });
      rects.push({ position: [-0.65, bayY, 0.44], size: [0.7, winH * 0.95], rotationY: -Math.PI / 2 });
    }
  }

  // Ground floor: shop glazing, or two tall windows either side of the door.
  // Street level is always lit - it is what you actually walk past.
  if (spec.shop) {
    // Split the shopfront into bays instead of one huge pane, so a closed shop
    // still has structure and one bay can be dimmer than the next.
    for (let i = 0; i < 3; i++) {
      rects.push({
        position: [-WIDTH / 2 + (WIDTH / 3) * (i + 0.5), 1.75 * heightScale, 0.26],
        size: [WIDTH / 3 - 0.45, 2.1],
        lit: 'always',
      });
    }
  } else {
    for (const sx of [-1, 1]) {
      rects.push({ position: [sx * 3.4, 1.9 * heightScale, 0.26], size: [1.5, 2.2], lit: 'always' });
    }
  }
  return rects;
}

/**
 * A unique door building for a 'R' lot: same facade language, but with a real
 * hole for the doorway and an anchor for the Door component to sit in.
 */
export function buildLondonDoorBuilding(spec, { facing, rng }) {
  const group = new THREE.Group();
  group.name = `door-building:${spec.id ?? 'london'}`;
  const storeys = spec.storeys ?? 3;
  const height = storeys * STOREY;
  const groundH = 3.2;
  const doorW = spec.doorWidth ?? 1.4;
  const doorH = spec.doorHeight ?? 2.5;
  const doorX = spec.doorX ?? 0;

  const b = new GeometryBuilder();
  // Front wall, with a hole where the door goes.
  b.wallWithHole('walls', {
    width: WIDTH, height, depth: 0.42,
    hole: [doorX, doorH / 2, doorW, doorH],
    pos: [0, 0, -0.21],
  });
  // Sides always; back and roof only if the building is a closed box.
  //
  // A `hollow` building is one whose interior is deeper than the building -
  // the district portal, whose "room" is a 20m preview slice of New York. Its
  // own back wall would stand between you and the other city.
  b.box('walls', [0.4, height, DEPTH], [-WIDTH / 2, height / 2, -DEPTH / 2],
    { uvScale: [DEPTH / 3, height / 3] });
  b.box('walls', [0.4, height, DEPTH], [WIDTH / 2, height / 2, -DEPTH / 2],
    { uvScale: [DEPTH / 3, height / 3] });
  if (!spec.hollow) {
    b.box('walls', [WIDTH, height, 0.4], [0, height / 2, -DEPTH],
      { uvScale: [WIDTH / 3, height / 3] });
    b.box('walls', [WIDTH, 0.4, DEPTH], [0, height, -DEPTH / 2]);
  }

  // Ground-floor stone, string courses, cornice, chimneys - as the terrace.
  b.box('stone', [WIDTH + 0.16, 0.3, 0.34], [0, groundH, 0.06]);
  for (let s = 1; s < storeys; s++) {
    b.box('trim', [WIDTH + 0.2, 0.12, 0.22], [0, groundH + (s - 1) * STOREY + 0.06, 0.08]);
  }
  b.box('trim', [WIDTH + 0.5, 0.34, 0.6], [0, height + 0.1, 0.12]);
  for (const sx of [-1, 1]) {
    b.box('walls', [1.1, 2.0, 1.1], [sx * (WIDTH / 2 - 1.1), height + 1.0, -DEPTH * 0.6],
      { uvScale: [0.4, 0.7] });
  }
  // Steps up to the door, and railings either side.
  b.box('stone', [doorW + 1.4, 0.14, 0.5], [doorX, 0.07, 0.32]);
  b.box('stone', [doorW + 1.0, 0.14, 0.4], [doorX, 0.21, 0.16]);
  for (let i = 0; i < 6; i++) {
    b.box('trim', [0.05, 0.9, 0.05], [doorX - doorW / 2 - 0.4 - i * 0.28, 0.6, 0.6]);
    b.box('trim', [0.05, 0.9, 0.05], [doorX + doorW / 2 + 0.4 + i * 0.28, 0.6, 0.6]);
  }

  const slots = b.build();
  const materials = {
    walls: facadeMaterial(spec.brick ?? 1),
    stone: stoneMaterial(1),
    trim: trimMaterial(0x14110e),
  };
  for (const [slot, geo] of Object.entries(slots)) {
    const mesh = new THREE.Mesh(geo, materials[slot]);
    mesh.castShadow = slot === 'walls';
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Painted shop or practice sign over the door.
  if (spec.sign) {
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 1.05),
      new THREE.MeshStandardMaterial({ map: T.shopSign(spec.sign), roughness: 0.7 })
    );
    sign.position.set(doorX, groundH - 0.55, 0.26);
    group.add(sign);
  }

  const rects = [];
  for (let s = 0; s < storeys - 1; s++) {
    const y = groundH + 0.5 + s * STOREY + 0.95;
    for (let c = 0; c < 3; c++) {
      const x = -WIDTH / 2 + (WIDTH / 3) * (c + 0.5);
      rects.push({ position: [x, y, 0.22], size: [1.5, 1.85 * (1 - s * 0.1)] });
    }
  }
  // Fanlight over the door - a closed door that still glows.
  rects.push({ position: [doorX, doorH + 0.34, 0.22], size: [doorW * 0.92, 0.5], lit: 'always' });

  return { group, depth: DEPTH, windowRects: rects, doorAnchors: [
    { slot: 0, offset: [doorX, 0.28, 0.24], rotationY: 0 },
  ] };
}

export { WIDTH as FACADE_WIDTH, DEPTH as FACADE_DEPTH, STOREY };
