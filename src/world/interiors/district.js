import * as THREE from 'three';
import * as T from '../../gfx/textures.js';
import { livingWindowMaterial, seedWindowAttributes } from '../../gfx/materials.js';
import { buildInstanced, GeometryBuilder } from '../../gfx/instancing.js';
import { makeRng } from '../../util/rng.js';
import { Steam } from '../../fx/particles.js';
import { disposeSubtree } from '../../util/dispose.js';

/**
 * The `district` interior strategy - the portal between worlds (Step 8).
 *
 * Behind this door is not a room, it is the other district. Building the whole
 * of New York inside a London doorway would be absurd, so per Step 8.2 this is
 * a PREVIEW SLICE: a sky dome, three near towers with live windows, a haze
 * plane, a neon sign and some steam. Enough to make the reveal land; cheap
 * enough to sit behind a door you might never open.
 *
 * Walking through the threshold is what actually swaps districts - see
 * DoorManager, which watches for the player crossing this door's plane.
 */
export class DistrictPortalInterior {
  constructor(spec, ctx) {
    this.spec = spec;
    this.ctx = ctx;
    this.target = spec.target;
    this.root = new THREE.Group();
    this.root.name = `interior:district:${spec.target}`;
    this.triangles = 0;
    this.focused = false;
    this.isPortal = true;
    this._time = 0;
    this._built = [];
  }

  async load() {
    const spec = this.spec;
    const rng = makeRng(spec.seed ?? 1977);
    const preview = spec.preview ?? {};

    /**
     * ---- the tunnel you look down ------------------------------------
     *
     * SHORT, and the vista sits CLOSE behind it. The first version had a 3.2m
     * throat and the skyline 10m further back: through a 1.6m doorway from
     * three metres away that is a pinhole, and New York was a faint blue smudge
     * at the end of a dark corridor. Step 8.2 asks for a teaser, and a teaser
     * has to be legible - everything here is packed into the view cone the
     * doorway actually gives you.
     */
    const throatDepth = preview.throat ?? 2.0;
    const throatW = 2.0;
    const throatH = 2.5;
    const t = 0.12;

    /**
     * An OPEN-ENDED tunnel - four slabs, no end cap.
     *
     * A BackSide box looks like a tunnel from inside but it has a far face, and
     * that face is exactly where the other city is supposed to be. Five minutes
     * of confusion and one screenshot of a beautifully lit dead end.
     */
    const tb = new GeometryBuilder();
    tb.box('throat', [throatW + t * 2, t, throatDepth], [0, -t / 2, -throatDepth / 2],
      { uvScale: [1, throatDepth / 2] });
    tb.box('throat', [throatW + t * 2, t, throatDepth], [0, throatH + t / 2, -throatDepth / 2],
      { uvScale: [1, throatDepth / 2] });
    tb.box('throat', [t, throatH, throatDepth], [-throatW / 2 - t / 2, throatH / 2, -throatDepth / 2],
      { uvScale: [throatDepth / 2, 1] });
    tb.box('throat', [t, throatH, throatDepth], [throatW / 2 + t / 2, throatH / 2, -throatDepth / 2],
      { uvScale: [throatDepth / 2, 1] });

    const throatMat = new THREE.MeshStandardMaterial({
      map: T.stone(0),
      color: 0x6e727c,
      roughness: 0.9,
      // Tiled subway walls under a strip light: the descent has to read, and an
      // interior with no lights of its own needs the emissive to do it.
      emissive: new THREE.Color(preview.throatGlow ?? '#2e3a4c').multiplyScalar(0.5),
    });
    const throat = new THREE.Mesh(tb.build().throat, throatMat);
    throat.name = 'portal-throat';
    this.root.add(throat);
    this._built.push(throatMat);

    // Tiled stair treads going down, so the subway entrance reads as a descent.
    const stepMat = new THREE.MeshStandardMaterial({
      color: 0x6a6a74, roughness: 0.85,
      emissive: new THREE.Color('#3a4658').multiplyScalar(0.3),
    });
    const steps = [];
    for (let i = 0; i < 5; i++) {
      steps.push({ position: [0, -i * 0.13, -0.45 - i * 0.3], scale: [1.9, 0.13, 0.3] });
    }
    const stepMesh = buildInstanced(new THREE.BoxGeometry(1, 1, 1), stepMat, steps);
    this.root.add(stepMesh);
    this._built.push(stepMat);

    // ---- the vista --------------------------------------------------
    const vistaZ = -throatDepth - (preview.distance ?? 2.5);
    const skyTex = T.skyGradient(preview.sky ?? [
      [0, '#04070f'], [0.45, '#101a2e'], [0.78, '#2a3550'], [1, '#4a3a44'],
    ]);
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, toneMapped: false });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(52, 30), skyMat);
    sky.position.set(0, 9, vistaZ - 11);
    this.root.add(sky);
    this._built.push(skyMat, skyTex);

    // Three near towers. Silhouette first, windows second - that is the read.
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x0d1018, roughness: 0.94 });
    const towerPlacements = (preview.towers ?? [
      // Offset so you see BETWEEN them - a single slab filling the doorway is
      // a wall with windows on it, not a city.
      { position: [-4.2, 0, vistaZ - 0.5], scale: [3.6, 15, 3.6] },
      { position: [4.6, 0, vistaZ - 2.5], scale: [4.4, 19, 4.4] },
      { position: [-0.6, 0, vistaZ - 7.0], scale: [5.6, 25, 5.6] },
    ]).map((t) => ({
      ...t,
      position: [t.position[0], t.scale[1] / 2, t.position[2]],
      color: new THREE.Color(0x0d1018).offsetHSL(0, 0, rng.range(-0.02, 0.03)).getHex(),
    }));
    const towers = buildInstanced(towerGeo, towerMat, towerPlacements);
    this.root.add(towers);
    this._built.push(towerMat);

    // Live windows on the tower faces that face us.
    const winGeo = new THREE.PlaneGeometry(1, 1);
    const winMat = livingWindowMaterial(T.windowAtlas('#ffd9a0'), { cells: 4 });
    const windows = [];
    for (const tower of towerPlacements) {
      const [tw, th] = [tower.scale[0], tower.scale[1]];
      const cols = Math.max(2, Math.floor(tw / 1.0));
      const rows = Math.max(4, Math.floor(th / 1.35));
      for (let c = 0; c < cols; c++) {
        for (let r = 1; r < rows; r++) {
          windows.push({
            position: [
              tower.position[0] - tw / 2 + (c + 0.5) * (tw / cols),
              (r + 0.3) * (th / rows),
              tower.position[2] + tower.scale[2] / 2 + 0.03,
            ],
            scale: [tw / cols * 0.62, th / rows * 0.52, 1],
          });
        }
      }
    }
    const windowMesh = buildInstanced(winGeo, winMat, windows);
    // Nearly every window lit, and hot: this is a glimpse of another city
    // seen for two seconds through a doorway, not a place you will study.
    seedWindowAttributes(windowMesh, rng, { litChance: 0.88, maxGlow: 2.8 });
    this.root.add(windowMesh);

    // A neon sign, because you should be able to read the other world's name.
    if (preview.neon !== false) {
      const neonTex = T.neonSign(preview.neonLabel ?? 'BROADWAY', {
        color: preview.neonColor ?? '#ff3d7f',
      });
      const neonMat = new THREE.MeshBasicMaterial({
        map: neonTex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false,
      });
      const neon = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 1.9), neonMat);
      neon.position.set(-2.9, 3.6, vistaZ + 0.4);
      neon.rotation.y = 0.3;
      this.root.add(neon);
      this._built.push(neonMat);
      this.neon = neon;
    }

    // Ground and haze: a wet street catching all that light.
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x2a3038, roughness: 0.12, metalness: 0.4,
      emissive: new THREE.Color(preview.hazeColor ?? '#2b3a58').multiplyScalar(0.1),
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 46), groundMat);
    ground.rotation.x = -Math.PI / 2;
    // Only just below the doorstep: any lower and the city's own ground plane,
    // which is still there behind the hollow building, hides the vista's.
    ground.position.set(0, -0.25, vistaZ - 6);
    this.root.add(ground);
    this._built.push(groundMat);

    const hazeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(preview.hazeColor ?? '#2b3a58'),
      map: T.softDot(), transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    // Behind the near towers, not in front of them: a big bright additive quad
    // between you and the city reads as a wall, not as air.
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(24, 10), hazeMat);
    haze.position.set(0, 2.6, vistaZ - 5.5);
    this.root.add(haze);
    this._built.push(hazeMat);

    if (this.ctx.quality.steamPuffs > 0) {
      this._steam = new Steam({
        sources: [[-1.8, -0.2, vistaZ + 1.2], [2.4, -0.2, vistaZ - 0.6]],
        perSource: Math.max(8, Math.round(this.ctx.quality.steamPuffs / 6)),
        height: 5,
        color: '#9fb0c4',
        size: 1.2,
        opacity: 0.3,
      });
      this.root.add(this._steam.mesh);
    }

    this.root.traverse((o) => {
      if (o.isMesh || o.isInstancedMesh) {
        const g = o.geometry;
        const tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
        this.triangles += tris * (o.isInstancedMesh ? o.count : 1);
      }
    });

    return this;
  }

  setFocused(focused) { this.focused = focused; }

  update(dt) {
    this._time += dt;
    this._steam?.update(dt, this._time);
    if (this.neon) {
      // A sign with a failing tube. The flaw is what makes it real.
      const t = this._time;
      const fail = Math.sin(t * 31.0) > 0.985 ? 0.25 : 1;
      this.neon.material.opacity = fail * (0.9 + 0.1 * Math.sin(t * 3.1));
    }
  }

  activate() {}
  deactivate() {}

  dispose() {
    this._steam?.dispose();
    disposeSubtree(this.root);
  }
}
