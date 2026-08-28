import * as THREE from 'three';
import { buildInstanced, GeometryBuilder } from '../gfx/instancing.js';
import { makeRng } from '../util/rng.js';
import { disposeSubtree } from '../util/dispose.js';
import { BUDGETS } from '../core/budgets.js';

/**
 * The city grid (Step 6).
 *
 * A district hands over a `theme`: a tile-character layout, a set of building
 * archetypes, materials and a dressing table. This module snaps everything to
 * TILE, instances it, and hands back the things the rest of the city needs -
 * sidewalk paths for pedestrians, road centrelines for vehicles, traffic-light
 * positions, lamp positions, manholes and door anchors.
 *
 * Layout characters (KIND):
 *   C road-corner   S road-straight   T road-t   X road-intersection
 *   P plaza         B building lot    R door building lot    . empty
 *
 * Rules that make it look right, straight from the instructions:
 *   - everything snaps to TILE; rotations are only 0/90/180/270
 *   - buildings are InstancedMesh per archetype with a per-instance Y-scale and
 *     a slight hue shift via setColorAt
 *   - door buildings are unique meshes, never instanced, so the Door component
 *     can overlay their entrance
 *   - decorateSidewalk() dresses the city without a single hand-placed prop
 */

export const TILE = 12;

export const KIND = {
  C: 'road-corner',
  S: 'road-straight',
  T: 'road-t',
  X: 'road-intersection',
  P: 'plaza',
  B: 'lot',
  R: 'door-lot',
  '.': 'empty',
};

const ROAD_KINDS = new Set(['road-corner', 'road-straight', 'road-t', 'road-intersection']);

export class CityGrid {
  constructor(theme, ctx) {
    this.theme = theme;
    this.ctx = ctx;
    this.tile = theme.tile ?? TILE;
    this.root = new THREE.Group();
    this.root.name = `city:${theme.id}`;
    this.rng = makeRng(theme.seed ?? 1890);

    this.cells = [];              // [row][col] = { kind, char, centre }
    this.doorAnchors = [];        // where Door components attach
    this.sidewalkPaths = [];      // CatmullRomCurve3, closed, for pedestrians
    this.roadPaths = [];          // { curve, axis, direction }
    this.trafficLights = [];
    this.lamps = [];
    this.manholes = [];
    this.windowMeshes = [];
    this.triangles = 0;
    this._materials = [];
  }

  build() {
    this._parseLayout();
    this._buildGround();
    this._buildSidewalks();
    this._buildBuildings();
    this._buildDoorBuildings();
    this.decorateSidewalk();
    this._buildPaths();
    this._countTriangles();
    return this;
  }

  // ------------------------------------------------------------------ layout
  _parseLayout() {
    const layout = this.theme.layout;
    this.rows = layout.length;
    this.cols = layout[0].length;
    // Centre the grid on the origin so the player starts in the middle of it.
    this.originX = -((this.cols - 1) * this.tile) / 2;
    this.originZ = -((this.rows - 1) * this.tile) / 2;

    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        const char = layout[r][c] ?? '.';
        row.push({
          char,
          kind: KIND[char] ?? 'empty',
          row: r,
          col: c,
          centre: new THREE.Vector3(
            this.originX + c * this.tile,
            0,
            this.originZ + r * this.tile
          ),
        });
      }
      this.cells.push(row);
    }
  }

  at(r, c) {
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return null;
    return this.cells[r][c];
  }

  isRoad(r, c) {
    const cell = this.at(r, c);
    return !!cell && ROAD_KINDS.has(cell.kind);
  }

  isLot(r, c) {
    const cell = this.at(r, c);
    return !!cell && (cell.kind === 'lot' || cell.kind === 'door-lot');
  }

  // ------------------------------------------------------------------ ground
  /**
   * One plane for the whole road surface. Roads are simply where nothing else
   * is built, which is both true of real cities and cheap to render.
   */
  _buildGround() {
    const w = this.cols * this.tile + this.tile;
    const d = this.rows * this.tile + this.tile;
    const geo = new THREE.PlaneGeometry(w, d, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = this.theme.roadMaterial();
    const ground = new THREE.Mesh(geo, mat);
    ground.name = 'road';
    ground.receiveShadow = true;
    ground.position.set(
      this.originX + ((this.cols - 1) * this.tile) / 2,
      0,
      this.originZ + ((this.rows - 1) * this.tile) / 2
    );
    this.root.add(ground);
    this.ground = ground;

    // Crossings: white bars at every junction. Reads as a city instantly.
    const stripes = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.at(r, c);
        if (cell.kind !== 'road-intersection' && cell.kind !== 'road-t') continue;
        for (const [dr, dc, axis] of [[-1, 0, 'x'], [1, 0, 'x'], [0, -1, 'z'], [0, 1, 'z']]) {
          if (!this.isRoad(r + dr, c + dc)) continue;
          for (let i = 0; i < 6; i++) {
            const off = -1.9 + i * 0.76;
            const along = this.tile * 0.36;
            stripes.push({
              position: axis === 'x'
                ? [cell.centre.x + off, 0.015, cell.centre.z + dr * along]
                : [cell.centre.x + dc * along, 0.015, cell.centre.z + off],
              scale: axis === 'x' ? [0.42, 1, 2.0] : [2.0, 1, 0.42],
            });
          }
        }
      }
    }
    if (stripes.length) {
      const stripeMat = new THREE.MeshStandardMaterial({
        color: this.theme.stripeColor ?? 0xcfc8b8,
        roughness: 0.7,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      });
      const mesh = buildInstanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), stripeMat, stripes);
      mesh.name = 'crossings';
      this.root.add(mesh);
      this._materials.push(stripeMat);
    }
  }

  /**
   * Sidewalk slabs and kerbs, placed on every lot edge that faces a road.
   * Two InstancedMeshes for the entire city.
   */
  _buildSidewalks() {
    const slabs = [];
    const kerbs = [];
    const width = this.theme.sidewalkWidth ?? 2.6;
    const half = this.tile / 2;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.at(r, c);
        const walkable = cell.kind === 'lot' || cell.kind === 'door-lot' || cell.kind === 'plaza';
        if (!walkable) continue;

        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          if (!this.isRoad(r + dr, c + dc)) continue;
          const alongX = dc === 0;
          const px = cell.centre.x + dc * (half - width / 2);
          const pz = cell.centre.z + dr * (half - width / 2);
          slabs.push({
            position: [px, 0.075, pz],
            scale: alongX ? [this.tile, 0.15, width] : [width, 0.15, this.tile],
          });
          // Kerb: a 6cm lip at the road edge. Tiny detail, huge grounding.
          const kx = cell.centre.x + dc * half;
          const kz = cell.centre.z + dr * half;
          kerbs.push({
            position: [kx - dc * 0.09, 0.09, kz - dr * 0.09],
            scale: alongX ? [this.tile, 0.19, 0.18] : [0.18, 0.19, this.tile],
          });
        }
      }
    }

    if (slabs.length) {
      const slabMat = this.theme.sidewalkMaterial();
      const box = new THREE.BoxGeometry(1, 1, 1);
      const mesh = buildInstanced(box, slabMat, slabs, { receiveShadow: true });
      mesh.name = 'sidewalks';
      this.root.add(mesh);
      this.sidewalkMesh = mesh;

      const kerbMat = this.theme.kerbMaterial?.() ?? slabMat;
      const kerbMesh = buildInstanced(new THREE.BoxGeometry(1, 1, 1), kerbMat, kerbs);
      kerbMesh.name = 'kerbs';
      this.root.add(kerbMesh);
    }
  }

  // --------------------------------------------------------------- buildings
  /**
   * Per-archetype InstancedMesh. Each archetype supplies merged geometry slots
   * (walls / trim / windows), and every instance gets its own Y-scale and a
   * small hue shift, which is what stops an instanced street looking stamped.
   */
  _buildBuildings() {
    const archetypes = this.theme.archetypes ?? [];
    if (!archetypes.length) return;

    const perArchetype = archetypes.map(() => ({ walls: [], trim: [], windows: [] }));

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.at(r, c);
        if (cell.kind !== 'lot') continue;

        // Which way does this lot face? Toward the nearest road.
        const facing = this._facingFor(r, c);
        if (facing == null) continue;

        const pick = this.rng.int(0, archetypes.length - 1);
        const arch = archetypes[pick];
        const heightScale = this.rng.range(arch.minScale ?? 0.9, arch.maxScale ?? 1.35);
        const tint = new THREE.Color(arch.tint ?? 0xffffff)
          .offsetHSL(this.rng.range(-0.02, 0.02), this.rng.range(-0.04, 0.04), this.rng.range(-0.07, 0.07));

        // Lots are deeper than they are wide: buildings sit on the road edge.
        const inset = (this.tile / 2) - (arch.depth ?? 6) / 2 - (this.theme.sidewalkWidth ?? 2.6);
        const dir = FACING_VECTORS[facing];
        const position = [
          cell.centre.x + dir[0] * inset,
          0,
          cell.centre.z + dir[1] * inset,
        ];
        const rotationY = FACING_ANGLES[facing];

        const placement = {
          position,
          rotationY,
          scale: [1, heightScale, 1],
          color: tint.getHex(),
        };
        perArchetype[pick].walls.push(placement);
        perArchetype[pick].trim.push(placement);
        perArchetype[pick].windows.push(placement);
        cell.building = { archetype: pick, heightScale, facing, position, rotationY };
      }
    }

    archetypes.forEach((arch, i) => {
      const slots = arch.geometry();
      const bucket = perArchetype[i];
      if (!bucket.walls.length) return;

      for (const [slotName, geo] of Object.entries(slots)) {
        const material = arch.materials[slotName];
        if (!material) continue;
        const mesh = buildInstanced(geo, material, bucket.walls, {
          castShadow: slotName === 'walls',
          receiveShadow: true,
        });
        mesh.name = `building:${arch.name}:${slotName}`;
        // Windows must not tint with the wall colour, so drop instanceColor.
        if (slotName === 'windows' && mesh.instanceColor) {
          mesh.instanceColor = null;
          this.windowMeshes.push(mesh);
        }
        this.root.add(mesh);
        if (arch.seedWindows && slotName === 'windows') arch.seedWindows(mesh, this.rng);
      }
    });
  }

  /** Door lots get a unique, non-instanced building so a Door can sit in it. */
  _buildDoorBuildings() {
    const slots = this.theme.doorLots ?? [];
    let index = 0;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.at(r, c);
        if (cell.kind !== 'door-lot') continue;

        const facing = this._facingFor(r, c) ?? 'south';
        const spec = slots[index % Math.max(1, slots.length)] ?? {};
        index++;

        const built = this.theme.buildDoorBuilding?.(spec, { facing, cell, rng: this.rng });
        if (!built) continue;

        const group = built.group ?? built;
        const dir = FACING_VECTORS[facing];
        const depth = built.depth ?? 6;
        const inset = (this.tile / 2) - depth / 2 - (this.theme.sidewalkWidth ?? 2.6);
        group.position.set(cell.centre.x + dir[0] * inset, 0, cell.centre.z + dir[1] * inset);
        group.rotation.y = FACING_ANGLES[facing];
        group.updateMatrixWorld(true);
        this.root.add(group);

        // Where the Door component goes: on the facade plane, facing outward.
        for (const anchor of built.doorAnchors ?? []) {
          const local = new THREE.Vector3().fromArray(anchor.offset ?? [0, 0, 0]);
          const world = local.applyMatrix4(group.matrixWorld);
          this.doorAnchors.push({
            ...anchor,
            spec: spec.doors?.[anchor.slot ?? 0] ?? anchor.door ?? {},
            position: world.toArray(),
            rotationY: FACING_ANGLES[facing] + (anchor.rotationY ?? 0),
            cell,
          });
        }
        if (built.windows) this.windowMeshes.push(...built.windows);
      }
    }
  }

  _facingFor(r, c) {
    for (const [dr, dc, name] of [
      [1, 0, 'south'], [-1, 0, 'north'], [0, 1, 'east'], [0, -1, 'west'],
    ]) {
      if (this.isRoad(r + dr, c + dc)) return name;
    }
    return null;
  }

  // ---------------------------------------------------------------- dressing
  /**
   * "One function, the city dresses itself."
   * Lamp every 2 tiles, bench near plazas, hydrant at corners, bin near door
   * buildings, manhole in the road at junctions.
   */
  decorateSidewalk() {
    const dress = this.theme.dressing;
    if (!dress) return;

    const lamps = [];
    const benches = [];
    const hydrants = [];
    const bins = [];
    const manholeSlabs = [];
    const half = this.tile / 2;
    const walkIn = half - (this.theme.sidewalkWidth ?? 2.6) * 0.42;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.at(r, c);
        const isPlaza = cell.kind === 'plaza';
        const isLot = this.isLot(r, c);
        if (!isLot && !isPlaza) {
          // Manholes belong in the road, at junctions (Task 5.5 steam sources).
          if (cell.kind === 'road-intersection' && this.rng.chance(0.7)) {
            const p = [cell.centre.x + this.rng.range(-2, 2), 0.02, cell.centre.z + this.rng.range(-2, 2)];
            manholeSlabs.push({ position: p, rotationY: this.rng() * Math.PI });
            this.manholes.push([p[0], 0.05, p[2]]);
          }
          continue;
        }

        for (const [dr, dc, name] of [
          [1, 0, 'south'], [-1, 0, 'north'], [0, 1, 'east'], [0, -1, 'west'],
        ]) {
          if (!this.isRoad(r + dr, c + dc)) continue;
          const alongX = dc === 0;
          const px = cell.centre.x + dc * walkIn;
          const pz = cell.centre.z + dr * walkIn;
          const angle = FACING_ANGLES[name];

          // Lamp every 2 tiles along the street.
          if ((alongX ? c : r) % 2 === 0) {
            const lx = alongX ? cell.centre.x - this.tile * 0.28 : px;
            const lz = alongX ? pz : cell.centre.z - this.tile * 0.28;
            lamps.push({ position: [lx, 0.15, lz], rotationY: angle });
            this.lamps.push([lx, dress.lampHeight ?? 3.4, lz]);
          }

          if (isPlaza && this.rng.chance(0.6)) {
            benches.push({ position: [px, 0.15, pz], rotationY: angle });
          }
          if (cell.kind === 'door-lot' && this.rng.chance(0.55)) {
            const bx = alongX ? cell.centre.x + this.tile * 0.3 : px;
            const bz = alongX ? pz : cell.centre.z + this.tile * 0.3;
            bins.push({ position: [bx, 0.15, bz], rotationY: this.rng() * Math.PI * 2 });
          }
        }

        // Hydrant at block corners: a lot with roads on two adjacent sides.
        const cornerish =
          (this.isRoad(r - 1, c) || this.isRoad(r + 1, c)) &&
          (this.isRoad(r, c - 1) || this.isRoad(r, c + 1));
        if (cornerish && this.rng.chance(0.7)) {
          const sx = this.isRoad(r, c + 1) ? 1 : -1;
          const sz = this.isRoad(r + 1, c) ? 1 : -1;
          hydrants.push({
            position: [cell.centre.x + sx * walkIn, 0.15, cell.centre.z + sz * walkIn],
            rotationY: this.rng() * Math.PI * 2,
          });
        }
      }
    }

    const place = (name, placements, emissiveName) => {
      if (!placements.length || !dress[name]) return;
      const { geometry, materials } = dress[name]();
      for (const [slot, geo] of Object.entries(geometry)) {
        const mat = materials[slot];
        if (!mat) continue;
        const mesh = buildInstanced(geo, mat, placements, { castShadow: slot === 'body' });
        mesh.name = `dress:${name}:${slot}`;
        this.root.add(mesh);
        if (slot === emissiveName) this.lampGlows = mesh;
      }
    };

    place('lamp', lamps, 'glow');
    place('bench', benches);
    place('hydrant', hydrants);
    place('bin', bins);
    place('manhole', manholeSlabs);
  }

  // ------------------------------------------------------------------- paths
  /**
   * Road centrelines and sidewalk loops, derived from the layout rather than
   * hand-authored - so a new layout string immediately has traffic and crowds.
   */
  _buildPaths() {
    const half = this.tile / 2;
    const laneOffset = this.theme.laneOffset ?? 2.6;
    const walkOffset = half - (this.theme.sidewalkWidth ?? 2.6) * 0.5;

    // Horizontal runs.
    for (let r = 0; r < this.rows; r++) {
      let start = null;
      for (let c = 0; c <= this.cols; c++) {
        const road = c < this.cols && this.isRoad(r, c);
        if (road && start == null) start = c;
        if (!road && start != null) {
          if (c - start >= 3) this._addRun(r, start, c - 1, 'x', laneOffset, walkOffset);
          start = null;
        }
      }
    }
    // Vertical runs.
    for (let c = 0; c < this.cols; c++) {
      let start = null;
      for (let r = 0; r <= this.rows; r++) {
        const road = r < this.rows && this.isRoad(r, c);
        if (road && start == null) start = r;
        if (!road && start != null) {
          if (r - start >= 3) this._addRun(c, start, r - 1, 'z', laneOffset, walkOffset);
          start = null;
        }
      }
    }

    // Traffic lights at junctions, one per approach.
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.at(r, c);
        if (cell.kind !== 'road-intersection') continue;
        this.trafficLights.push({
          position: [cell.centre.x, 0, cell.centre.z],
          // The two axes alternate; a car checks the phase for its own axis.
          phaseOffset: (r + c) % 2 === 0 ? 0 : 7.5,
        });
      }
    }
  }

  _addRun(fixed, from, to, axis, laneOffset, walkOffset) {
    const centreFixed = axis === 'x'
      ? this.originZ + fixed * this.tile
      : this.originX + fixed * this.tile;
    const a = (axis === 'x' ? this.originX : this.originZ) + from * this.tile - this.tile * 0.5;
    const b = (axis === 'x' ? this.originX : this.originZ) + to * this.tile + this.tile * 0.5;

    const point = (along, off, y = 0) => (axis === 'x'
      ? new THREE.Vector3(along, y, centreFixed + off)
      : new THREE.Vector3(centreFixed + off, y, along));

    // Two vehicle lanes, opposite directions.
    for (const side of [-1, 1]) {
      const pts = [];
      const steps = 6;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const along = side > 0 ? a + (b - a) * t : b - (b - a) * t;
        pts.push(point(along, side * laneOffset, 0.02));
      }
      this.roadPaths.push({
        curve: new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1),
        axis,
        side,
        length: Math.abs(b - a),
      });
    }

    // One closed pedestrian loop: up one sidewalk, back down the other.
    const walk = [];
    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      walk.push(point(a + (b - a) * (i / steps), -walkOffset, 0.16));
    }
    for (let i = steps; i >= 0; i--) {
      walk.push(point(a + (b - a) * (i / steps), walkOffset, 0.16));
    }
    this.sidewalkPaths.push(new THREE.CatmullRomCurve3(walk, true, 'catmullrom', 0.06));
  }

  _countTriangles() {
    let tris = 0;
    this.root.traverse((o) => {
      if (!o.geometry) return;
      const g = o.geometry;
      const per = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      tris += per * (o.isInstancedMesh ? o.count : 1);
    });
    this.triangles = tris;
    if (tris > BUDGETS.streetTriangles) {
      console.warn(
        `[city:${this.theme.id}] ${Math.round(tris / 1000)}k triangles in the grid, ` +
        `budget is ${BUDGETS.streetTriangles / 1000}k. Thicken the fog and cut a row.`
      );
    }
  }

  dispose() {
    disposeSubtree(this.root);
    this._materials.forEach((m) => m.dispose());
    this.windowMeshes = [];
    this.doorAnchors = [];
    this.sidewalkPaths = [];
    this.roadPaths = [];
  }
}

const FACING_VECTORS = {
  south: [0, 1], north: [0, -1], east: [1, 0], west: [-1, 0],
};
// Rotations only ever 0/90/180/270, as required.
const FACING_ANGLES = {
  south: 0, north: Math.PI, east: Math.PI / 2, west: -Math.PI / 2,
};

export { FACING_ANGLES, FACING_VECTORS };
