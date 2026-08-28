import * as THREE from 'three';
import { GeometryBuilder } from '../../gfx/instancing.js';
import * as T from '../../gfx/textures.js';
import { addProp } from './props.js';
import { makeRng } from '../../util/rng.js';
import { disposeSubtree } from '../../util/dispose.js';
import { Dust } from '../../fx/particles.js';
import { LAYER } from '../../core/budgets.js';

/**
 * The `procedural` interior strategy - a room built from a recipe.
 *
 * The room is authored in its own space: the doorway sits at local z = 0 facing
 * +Z, and the room extends into -Z. Door.js parents this straight into the
 * hinge group's frame, so an interior never knows where in the city it is.
 */
export class ProceduralInterior {
  constructor(recipe, ctx) {
    this.recipe = recipe;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = `interior:${recipe.id ?? 'room'}`;
    this.triangles = 0;
    this.focused = false;
    this._flickers = [];
    this._dust = null;
    this._time = 0;

    this._build();
  }

  _build() {
    const r = this.recipe;
    const quality = this.ctx.quality;
    const rng = makeRng(r.seed ?? 1895);
    const [w, h, d] = r.size ?? [4.2, 2.9, 4.6];
    const b = new GeometryBuilder();

    // ---- shell -------------------------------------------------------
    // Doorway at z=0; the room runs from z=0 back to z=-d. Walls are drawn
    // inward-facing by putting the box behind the visible surface.
    const t = 0.12;
    b.box('floor', [w, t, d], [0, -t / 2, -d / 2], { uvScale: [w / 2, d / 2] });
    b.box('ceiling', [w, t, d], [0, h + t / 2, -d / 2], { uvScale: [w / 2, d / 2] });
    b.box('wall', [t, h, d], [-w / 2 - t / 2, h / 2, -d / 2], { uvScale: [d / 2, h / 2] });
    b.box('wall', [t, h, d], [w / 2 + t / 2, h / 2, -d / 2], { uvScale: [d / 2, h / 2] });
    b.box('wall', [w + t * 2, h, t], [0, h / 2, -d - t / 2], { uvScale: [w / 2, h / 2] });
    // Return wall around the doorway, so you cannot see the room's own edges.
    const doorW = r.doorWidth ?? 1.2;
    b.wallWithHole('wall', {
      width: w + t * 2, height: h, depth: t,
      hole: [0, (r.doorHeight ?? 2.3) / 2, doorW + 0.1, r.doorHeight ?? 2.3],
      pos: [0, 0, t / 2],
    });

    // Skirting and picture rail: two rings of trim that make a box a room.
    b.box('trim', [w, 0.16, 0.04], [0, 0.08, -d + 0.02]);
    b.box('trim', [0.04, 0.16, d], [-w / 2 + 0.02, 0.08, -d / 2]);
    b.box('trim', [0.04, 0.16, d], [w / 2 - 0.02, 0.08, -d / 2]);
    b.box('trim', [w, 0.05, 0.03], [0, h - 0.42, -d + 0.015]);
    b.box('trim', [w, 0.09, 0.06], [0, h - 0.05, -d + 0.03]);   // cornice

    // ---- props -------------------------------------------------------
    for (const prop of r.props ?? []) addProp(b, prop.type, prop);

    // ---- merge -------------------------------------------------------
    const slots = b.build();
    const mats = buildSlotMaterials(r, quality);

    for (const [slot, geo] of Object.entries(slots)) {
      const material = mats[slot] ?? mats.wood;
      const mesh = new THREE.Mesh(geo, material);
      mesh.name = `${this.root.name}:${slot}`;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.triangles += geo.index ? geo.index.count / 3 : geo.attributes.position.count / 3;
      this.root.add(mesh);
    }
    this.materials = Object.values(mats);

    // ---- fire (Task 3.2) --------------------------------------------
    if (r.fire) this._buildFire(r.fire, quality);

    // ---- practical lights (budget: 1 per focused interior) -----------
    //
    // NOTE ON UNITS: since three r155 lights are physically based, so a
    // PointLight's intensity is candela and its contribution falls as 1/d².
    // Values that lit a room fine under the old legacy-lights model (2-5) are
    // a dim nightlight now. Room practicals want tens, not units - getting this
    // wrong is what made every interior in this project bake out black.
    //
    // AND: a room with a fireplace does not get a separate key. The fire IS the
    // key light, the lamp globes are emissive and cost nothing, and the sky
    // environment fills the rest. Creating both put hemisphere + sun + key +
    // fire on screen at once - four real-time lights against a budget of three.
    if (r.keyLight !== false && !r.fire && quality.interiorDetail !== 'flat') {
      const key = new THREE.PointLight(
        new THREE.Color(r.lightColor ?? '#ffb066'),
        0,               // raised in setFocused - an unfocused room costs nothing
        r.lightRange ?? 9,
        1.6
      );
      key.position.set(...(r.lightPos ?? [0, h * 0.72, -d * 0.45]));
      key.userData.baseIntensity = r.lightIntensity ?? 14;
      key.layers.set(LAYER.INTERIOR_LIGHT);
      this.root.add(key);
      this.keyLight = key;
    }

    // ---- dust motes in the light shaft (Task 3.1) --------------------
    if (quality.dustMotes > 0 && r.dust !== false) {
      this._dust = new Dust({
        count: Math.round(quality.dustMotes * (r.dustScale ?? 1)),
        bounds: new THREE.Box3(
          new THREE.Vector3(-w / 2, 0.1, -d),
          new THREE.Vector3(w / 2, h, 0.2)
        ),
        color: r.dustColor ?? '#ffd9a8',
        size: 0.026,
        drift: new THREE.Vector3(0.02, 0.035, 0.008),
      });
      this.root.add(this._dust.points);
      this.materials.push(this._dust.points.material);
    }

    // Every mesh in the room opts in to being lit by the room's own lights.
    // (They keep layer 0 as well, so they still render normally.)
    this.root.traverse((o) => o.layers.enable(LAYER.INTERIOR_LIGHT));

    this.root.updateMatrixWorld(true);
  }

  _buildFire(fire, quality) {
    const group = new THREE.Group();
    group.position.set(...(fire.pos ?? [0, 0, 0]));

    // Sprite flames: a few additive quads that scale and shear on noise.
    const flameMat = new THREE.MeshBasicMaterial({
      map: T.flame(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    });
    const count = quality.interiorDetail === 'flat' ? 2 : 5;
    for (let i = 0; i < count; i++) {
      const flame = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.42), flameMat);
      flame.position.set((i - (count - 1) / 2) * 0.11, 0.16, i % 2 ? 0.02 : -0.02);
      flame.userData.phase = i * 1.37;
      group.add(flame);
      this._flickers.push(flame);
    }

    // Embers.
    const emberMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ff5a1e').multiplyScalar(2.2),
      toneMapped: false,
    });
    const embers = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.06, 0.26), emberMat);
    embers.position.y = 0.08;
    group.add(embers);

    // The flickering point light. Costs one of the three realtime lights, and
    // only while this interior is the focused one.
    const light = new THREE.PointLight(new THREE.Color('#ff8a3c'), 0, fire.range ?? 8, 1.8);
    light.position.set(0, 0.5, 0.3);
    // Carries the room on its own now that there is no separate key.
    light.userData.baseIntensity = (fire.intensity ?? 22) * 1.25;
    light.layers.set(LAYER.INTERIOR_LIGHT);
    group.add(light);
    this.fireLight = light;

    this.root.add(group);
    this.materials.push(flameMat, emberMat);
    this._fireGroup = group;
  }

  /** Only the nearest interior gets real lights - see §3.4 "≤ 3 lights". */
  setFocused(focused) {
    if (this.focused === focused) return;
    this.focused = focused;
    for (const light of [this.keyLight, this.fireLight]) {
      if (light) light.intensity = focused ? light.userData.baseIntensity : 0;
    }
  }

  update(dt, ctx) {
    this._time += dt;
    if (this._dust) this._dust.update(dt, this._time);

    if (this._flickers.length && this.focused) {
      const t = this._time;
      for (const flame of this._flickers) {
        const p = flame.userData.phase;
        const wobble = 0.78 + 0.34 * Math.sin(t * 7.3 + p) * Math.sin(t * 3.1 + p * 2.2);
        flame.scale.set(0.85 + 0.25 * Math.sin(t * 5.1 + p), wobble, 1);
        flame.rotation.z = 0.09 * Math.sin(t * 4.2 + p);
        flame.position.y = 0.16 + 0.02 * wobble;
      }
      if (this.fireLight) {
        const base = this.fireLight.userData.baseIntensity;
        this.fireLight.intensity =
          base * (0.72 + 0.34 * Math.sin(t * 9.1) * Math.sin(t * 3.7) + 0.08 * Math.random());
      }
    }
  }

  /** Video interiors need this; procedural ones have nothing to pause. */
  activate() {}
  deactivate() { this.setFocused(false); }

  dispose() {
    this._dust?.dispose();
    disposeSubtree(this.root);
    this._flickers = [];
  }
}

/**
 * Materials are built per interior rather than pulled from the shared cache,
 * because each interior needs its own stencil ref. Textures stay shared.
 */
function buildSlotMaterials(recipe, quality) {
  const wallpaperVariant = recipe.wallpaper ?? 0;
  const floorVariant = recipe.floorWood ?? 0;
  const warm = recipe.warmth ?? 1;

  const std = (opts) => new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.85, ...opts });

  // §5.3: bake the lighting into the materials - here, an emissive floor tied to the
  // room's own warmth, so a room reads as lit even before its practicals are
  // focused, and never renders as a black box.
  const ambient = new THREE.Color(recipe.ambientTint ?? '#ff9a52').multiplyScalar(
    0.075 * (recipe.warmth ?? 1)
  );

  const mats = {
    wall: std({
      map: recipe.wallStyle === 'plaster' ? T.stone(1) : T.wallpaper(wallpaperVariant),
      color: recipe.wallColor ?? 0xffffff,
      roughness: 0.92,
      side: THREE.DoubleSide,
      emissive: ambient.clone().multiplyScalar(0.9),
    }),
    floor: std({
      map: recipe.floorStyle === 'tile' ? T.stone(0) : T.wood(floorVariant),
      color: recipe.floorColor ?? 0xffffff,
      roughness: 0.6,
      metalness: 0.05,
      emissive: ambient.clone().multiplyScalar(1.1),
    }),
    ceiling: std({ color: recipe.ceilingColor ?? 0x171310, roughness: 0.96, side: THREE.DoubleSide }),
    trim: std({ color: recipe.trimColor ?? 0x1d1a16, roughness: 0.55 }),
    wood: std({
      map: T.wood(recipe.propWood ?? 0), roughness: 0.66, metalness: 0.03,
      emissive: ambient.clone().multiplyScalar(0.7),
    }),
    fabric: std({
      color: recipe.fabricColor ?? 0x4a2b28, roughness: 0.97,
      emissive: ambient.clone().multiplyScalar(0.8),
    }),
    dark: std({ color: 0x14110f, roughness: 0.72 }),
    metal: std({ color: 0x35322e, roughness: 0.4, metalness: 0.8 }),
    brass: std({ color: 0x8a6a2e, roughness: 0.32, metalness: 0.9 }),
    paper: std({ color: 0xc8bda0, roughness: 0.9 }),
    stonework: std({ map: T.stone(2), color: 0xbdb6ab, roughness: 0.86 }),
    books: std({ map: T.books(), roughness: 0.88, emissive: ambient.clone().multiplyScalar(0.8) }),
    rug: std({ map: T.rug(), roughness: 0.99, emissive: ambient.clone().multiplyScalar(0.9) }),
    glass: new THREE.MeshStandardMaterial({
      color: 0x9fc4c8, roughness: 0.06, metalness: 0.1,
      transparent: true, opacity: 0.42,
    }),
    glow: new THREE.MeshBasicMaterial({
      color: new THREE.Color(recipe.glowColor ?? '#ffcf90').multiplyScalar(4.2 * warm),
      toneMapped: false,
    }),
    coldglow: new THREE.MeshBasicMaterial({
      color: new THREE.Color('#8fc6ff').multiplyScalar(1.9),
      toneMapped: false,
    }),
    neon: new THREE.MeshBasicMaterial({
      map: recipe.neonMap ?? T.neonSign('OPEN', { color: '#ff3d7f' }),
      transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
    }),
    nightglass: new THREE.MeshBasicMaterial({
      color: new THREE.Color(recipe.nightGlassColor ?? '#1b2b3d'),
      toneMapped: false, side: THREE.DoubleSide,
    }),
  };

  // Low tier: swap PBR for unlit. Looks flatter, runs everywhere.
  if (quality.interiorDetail === 'flat') {
    for (const [key, mat] of Object.entries(mats)) {
      if (!mat.isMeshStandardMaterial) continue;
      mats[key] = new THREE.MeshBasicMaterial({
        map: mat.map ?? null,
        color: mat.color.clone().multiplyScalar(0.62),
        side: mat.side,
        transparent: mat.transparent,
        opacity: mat.opacity,
      });
      mat.dispose();
    }
  }

  return mats;
}
