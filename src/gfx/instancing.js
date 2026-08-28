import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Geometry kitbashing, in code instead of in Blender (§5.2 "Kitbash").
 *
 * A `GeometryBuilder` collects boxes/planes under named material slots and
 * merges each slot into a single BufferGeometry. One facade variant therefore
 * becomes ~4 geometries (brick, stone, trim, glass) instead of ~40 meshes, and
 * those 4 can then be instanced across the whole street.
 */
export class GeometryBuilder {
  constructor() { this.slots = new Map(); }

  _slot(name) {
    if (!this.slots.has(name)) this.slots.set(name, []);
    return this.slots.get(name);
  }

  /** Adds a box. `size` and `pos` are arrays; `pos` is the box centre. */
  box(slot, size, pos, { rotation = null, uvScale = null } = {}) {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    if (uvScale) scaleUv(geo, uvScale[0], uvScale[1]);
    const m = new THREE.Matrix4();
    if (rotation) {
      m.makeRotationFromEuler(new THREE.Euler(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0));
      m.setPosition(pos[0], pos[1], pos[2]);
    } else {
      m.makeTranslation(pos[0], pos[1], pos[2]);
    }
    geo.applyMatrix4(m);
    this._slot(slot).push(geo);
    return this;
  }

  /** Adds a plane facing +Z by default. */
  plane(slot, size, pos, { rotation = null, uvScale = null } = {}) {
    const geo = new THREE.PlaneGeometry(size[0], size[1]);
    if (uvScale) scaleUv(geo, uvScale[0], uvScale[1]);
    const m = new THREE.Matrix4();
    if (rotation) {
      m.makeRotationFromEuler(new THREE.Euler(rotation[0] || 0, rotation[1] || 0, rotation[2] || 0));
      m.setPosition(pos[0], pos[1], pos[2]);
    } else {
      m.makeTranslation(pos[0], pos[1], pos[2]);
    }
    geo.applyMatrix4(m);
    this._slot(slot).push(geo);
    return this;
  }

  add(slot, geometry, matrix) {
    const geo = geometry.clone();
    if (matrix) geo.applyMatrix4(matrix);
    this._slot(slot).push(geo);
    return this;
  }

  /**
   * Builds a wall with a rectangular hole, as four boxes. This is how doorways
   * and window openings exist without CSG: cheap, and the seams never show
   * because the trim covers them.
   */
  wallWithHole(slot, { width, height, depth, hole, pos = [0, 0, 0] }) {
    const [hx, hy, hw, hh] = hole; // hole centre x/y, width, height
    const left = hx - hw / 2 + width / 2;
    const right = width / 2 - (hx + hw / 2);
    const below = hy - hh / 2;
    const above = height - (hy + hh / 2);

    if (left > 0.001) {
      this.box(slot, [left, height, depth], [pos[0] - width / 2 + left / 2, pos[1] + height / 2, pos[2]], { uvScale: [left / 2, height / 2] });
    }
    if (right > 0.001) {
      this.box(slot, [right, height, depth], [pos[0] + width / 2 - right / 2, pos[1] + height / 2, pos[2]], { uvScale: [right / 2, height / 2] });
    }
    if (below > 0.001) {
      this.box(slot, [hw, below, depth], [pos[0] + hx, pos[1] + below / 2, pos[2]], { uvScale: [hw / 2, below / 2] });
    }
    if (above > 0.001) {
      this.box(slot, [hw, above, depth], [pos[0] + hx, pos[1] + hy + hh / 2 + above / 2, pos[2]], { uvScale: [hw / 2, above / 2] });
    }
    return this;
  }

  /** Merges each slot. Returns `{ slotName: BufferGeometry }`. */
  build() {
    const out = {};
    for (const [name, geos] of this.slots) {
      if (!geos.length) continue;
      const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
      if (!merged) continue;
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      if (geos.length > 1) geos.forEach((g) => g.dispose());
      out[name] = merged;
    }
    this.slots.clear();
    return out;
  }
}

function scaleUv(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}

export { scaleUv };

/**
 * Builds an InstancedMesh from a placement list.
 * `placements`: [{ position:[x,y,z], rotationY, scale:[x,y,z]|number, color }]
 */
export function buildInstanced(geometry, material, placements, { castShadow = false, receiveShadow = false } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  let anyColor = false;

  placements.forEach((it, i) => {
    p.fromArray(it.position ?? [0, 0, 0]);
    e.set(it.rotationX ?? 0, it.rotationY ?? 0, it.rotationZ ?? 0);
    q.setFromEuler(e);
    const sc = it.scale ?? 1;
    if (typeof sc === 'number') s.setScalar(sc);
    else s.fromArray(sc);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
    if (it.color != null) anyColor = true;
  });

  if (anyColor) {
    placements.forEach((it, i) => {
      mesh.setColorAt(i, new THREE.Color(it.color ?? 0xffffff));
    });
    mesh.instanceColor.needsUpdate = true;
  }

  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = receiveShadow;
  mesh.frustumCulled = true;
  mesh.computeBoundingSphere?.();
  return mesh;
}
