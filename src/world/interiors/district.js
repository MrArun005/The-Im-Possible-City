import * as THREE from 'three';
import * as T from '../../gfx/textures.js';
import { livingWindowMaterial, seedWindowAttributes } from '../../gfx/materials.js';
import { buildInstanced } from '../../gfx/instancing.js';
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

    // ---- the tunnel you look down ------------------------------------
    // A short dark throat between the door and the vista sells the depth.
    const throatDepth = preview.throat ?? 3.2;
    const throatGeo = new THREE.BoxGeometry(2.0, 2.5, throatDepth);
    throatGeo.translate(0, 1.25, -throatDepth / 2);
    const throatMat = new THREE.MeshStandardMaterial({
      map: T.stone(0),
      color: 0x4a4a52,
      roughness: 0.9,
      side: THREE.BackSide,
    });
    const throat = new THREE.Mesh(throatGeo, throatMat);
    this.root.add(throat);
    this._built.push(throatMat);

    // Tiled stair treads going down, so the subway entrance reads as a descent.
    const stepMat = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.85 });
    const steps = [];
    for (let i = 0; i < 7; i++) {
      steps.push({ position: [0, -i * 0.16, -0.5 - i * 0.34], scale: [1.9, 0.16, 0.34] });
    }
    const stepMesh = buildInstanced(new THREE.BoxGeometry(1, 1, 1), stepMat, steps);
    this.root.add(stepMesh);
    this._built.push(stepMat);

    // ---- the vista --------------------------------------------------
    const vistaZ = -throatDepth - (preview.distance ?? 9);
    const skyTex = T.skyGradient(preview.sky ?? [
      [0, '#04070f'], [0.45, '#101a2e'], [0.78, '#2a3550'], [1, '#4a3a44'],
    ]);
    const skyMat = new THREE.MeshBasicMaterial({ map: skyTex, toneMapped: false });
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(64, 34), skyMat);
    sky.position.set(0, 12, vistaZ - 14);
    this.root.add(sky);
    this._built.push(skyMat, skyTex);

    // Three near towers. Silhouette first, windows second - that is the read.
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0x0d1018, roughness: 0.94 });
    const towerPlacements = (preview.towers ?? [
      { position: [-7.5, 0, vistaZ - 2], scale: [5.5, 22, 5.5] },
      { position: [7.0, 0, vistaZ - 5], scale: [6.5, 30, 6.0] },
      { position: [0.5, 0, vistaZ - 11], scale: [8.0, 38, 7.0] },
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
      const cols = Math.max(2, Math.floor(tw / 1.1));
      const rows = Math.max(4, Math.floor(th / 1.5));
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
    seedWindowAttributes(windowMesh, rng, { litChance: 0.5, maxGlow: 1.5 });
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
      const neon = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 2.7), neonMat);
      neon.position.set(-4.6, 6.4, vistaZ + 0.6);
      neon.rotation.y = 0.24;
      this.root.add(neon);
      this._built.push(neonMat);
      this.neon = neon;
    }

    // Ground and haze: a wet street catching all that light.
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0a0c11, roughness: 0.12, metalness: 0.4,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(70, 46), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, -1.2, vistaZ - 6);
    this.root.add(ground);
    this._built.push(groundMat);

    const hazeMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(preview.hazeColor ?? '#2b3a58'),
      map: T.softDot(), transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(56, 22), hazeMat);
    haze.position.set(0, 4, vistaZ - 3);
    this.root.add(haze);
    this._built.push(hazeMat);

    if (this.ctx.quality.steamPuffs > 0) {
      this._steam = new Steam({
        sources: [[-2.2, -1.1, vistaZ + 2], [3.4, -1.1, vistaZ - 1]],
        perSource: Math.max(8, Math.round(this.ctx.quality.steamPuffs / 6)),
        height: 7,
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
