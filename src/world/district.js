import * as THREE from 'three';
import { CityGrid } from './city.js';
import { Crowd } from './people.js';
import { Traffic } from './vehicles.js';
import { DoorManager } from './doorManager.js';
import { Weather } from './weather.js';
import { SkyDome } from './timeOfDay.js';
import { Steam, Dust } from '../fx/particles.js';
import { disposeSubtree } from '../util/dispose.js';
import { bus } from '../util/events.js';

/**
 * A district (§3.2).
 *
 * "Doors, interiors, pedestrians, streaming, controls, post-FX - all shared. A
 * district only supplies assets, a colour grade, an audio bed, and door configs."
 * That is exactly the contract here: this class contains no London and no New
 * York, only the wiring. Everything district-specific lives in
 * src/districts/{id}/index.js and arrives as data.
 */
export class District {
  constructor(config, ctx) {
    this.config = config;
    this.id = config.id;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = `district:${config.id}`;
    this.root.visible = false;
    this.loaded = false;
    this.active = false;
    this._time = 0;
    this._systems = [];
  }

  // -------------------------------------------------------------------- load
  async load(onProgress = () => {}) {
    if (this.loaded) return this;
    const cfg = this.config;
    const step = makeStepper(onProgress);

    step('Laying the streets');
    this.city = new CityGrid(cfg.city, this.ctx).build();
    this.root.add(this.city.root);

    step('Hanging the sky');
    this.sky = new SkyDome(this.ctx.timeOfDay, {
      stars: cfg.stars !== false,
      radius: cfg.skyRadius ?? 150,
    });
    this.root.add(this.sky.mesh);

    step('Fitting the doors');
    this.doors = new DoorManager({ ...this.ctx, district: this });
    // Doors come from two places: anchors the grid produced from its door lots,
    // and explicit configs the district author placed by hand.
    for (const anchor of this.city.doorAnchors) {
      this.doors.add({
        ...anchor.spec,
        id: anchor.spec.id ?? `${this.id}-door-${this.doors.doors.length}`,
        position: anchor.position,
        rotationY: anchor.rotationY,
      });
    }
    this.doors.addAll(cfg.doors);
    // The DoorManager parents doors into the scene; re-home them into the
    // district so a district swap takes its doors with it.
    for (const door of this.doors.doors) this.root.add(door.root);

    step('Filling the pavements');
    this.crowd = new Crowd(
      {
        paths: this.city.sidewalkPaths,
        count: Math.min(this.ctx.quality.pedestrians, cfg.crowd?.count ?? 18),
        ...cfg.crowd,
      },
      this.ctx
    );
    await this.crowd.load();
    this.root.add(this.crowd.root);

    if (cfg.traffic !== false) {
      step('Starting the traffic');
      this.traffic = new Traffic(
        {
          paths: this.city.roadPaths,
          lights: this.city.trafficLights,
          count: this.ctx.quality.name === 'low' ? 4 : (cfg.traffic?.count ?? 8),
          archetypes: cfg.traffic?.archetypes,
          seed: cfg.seed,
        },
        this.ctx
      ).build();
      this.root.add(this.traffic.root);
    }

    step('Setting the weather');
    this.weather = new Weather(this.root, {
      quality: this.ctx.quality,
      audio: this.ctx.audio,
      dripPoints: cfg.dripPoints ?? this.city.doorAnchors.map((a) => [
        a.position[0], 3.1, a.position[2],
      ]),
    });
    if (cfg.rain) this.weather.set(cfg.rain);
    // A thunderclap without a flash is just a noise. One exposure spike on the
    // grade, decaying over the next second, and the whole street strobes.
    this.weather.onLightning = () => {
      const post = this.ctx.postfx;
      const base = post.target.exposure;
      post.target.exposure = base * 2.4;
      setTimeout(() => { post.target.exposure = base * 1.5; }, 90);
      setTimeout(() => { post.target.exposure = base; }, 260);
    };

    step('Venting the steam');
    const steamSources = cfg.steamSources ?? this.city.manholes;
    if (steamSources.length && this.ctx.quality.steamPuffs > 0) {
      this.steam = new Steam({
        sources: steamSources,
        perSource: Math.max(6, Math.round(this.ctx.quality.steamPuffs / steamSources.length)),
        height: cfg.steam?.height ?? 6,
        color: cfg.steam?.color ?? '#c9d4dc',
        size: cfg.steam?.size ?? 1.8,
        opacity: cfg.steam?.opacity ?? 0.4,
      });
      this.root.add(this.steam.mesh);
    }

    // Airborne haze motes: the trick that makes fog feel volumetric for free.
    if (this.ctx.quality.dustMotes > 0 && cfg.airMotes !== false) {
      const span = Math.max(this.city.cols, this.city.rows) * this.city.tile * 0.5;
      this.airMotes = new Dust({
        count: Math.round(this.ctx.quality.dustMotes * 0.5),
        bounds: new THREE.Box3(
          new THREE.Vector3(-span, 0.2, -span),
          new THREE.Vector3(span, 9, span)
        ),
        color: cfg.moteColor ?? '#d8c8a8',
        size: 0.045,
        opacity: 0.35,
        drift: new THREE.Vector3(0.35, 0.05, 0.12),
      });
      this.root.add(this.airMotes.points);
    }

    step('Building the lamplight');
    this._buildLampGlows(cfg);

    if (cfg.decorate) cfg.decorate(this, this.ctx);

    this.blockers = this._computeBlockers();
    this.loaded = true;
    step('Ready');
    return this;
  }

  /**
   * Gaslight / streetlight pools (Task 1.5). Additive sprites on the ground and
   * in the air around each lamp - no point lights, so the 3-light budget holds
   * however many lamps the street has.
   */
  _buildLampGlows(cfg) {
    const lamps = this.city.lamps;
    if (!lamps.length) return;

    const { softDot } = this.ctx.textures;
    const colour = new THREE.Color(cfg.lampColor ?? '#ffb765');

    // Air glow: wide and weak. A small bright disc reads as a sprite; a big
    // faint one reads as light hanging in fog. The multiplier below 1 keeps it
    // under the bloom threshold so it feeds the bloom instead of blowing out.
    const airMat = new THREE.MeshBasicMaterial({
      color: colour.clone().multiplyScalar(0.55), map: softDot(), transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });
    const poolMat = new THREE.MeshBasicMaterial({
      color: colour.clone().multiplyScalar(0.75), map: softDot(), transparent: true, opacity: 0.42,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
    });

    const air = new THREE.InstancedMesh(new THREE.PlaneGeometry(6.5, 6.5), airMat, lamps.length);
    const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(8.5, 8.5), poolMat, lamps.length);
    const m = new THREE.Matrix4();
    const flatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const one = new THREE.Vector3(1, 1, 1);

    lamps.forEach((p, i) => {
      m.compose(new THREE.Vector3(p[0], p[1], p[2]), IDENTITY_Q, one);
      air.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(p[0], 0.04, p[2]), flatQ, one);
      pool.setMatrixAt(i, m);
    });
    air.instanceMatrix.needsUpdate = true;
    pool.instanceMatrix.needsUpdate = true;
    air.name = 'lamp-air';
    pool.name = 'lamp-pool';
    // Air glows must face the camera; they are billboarded in update().
    this.lampAir = air;
    this.lampPool = pool;
    this.lampMaterials = [airMat, poolMat];
    this.root.add(air, pool);
    this._lampPositions = lamps;
    this._lampMatrix = new THREE.Matrix4();
  }

  /** Collision rectangles from the grid's buildings: [minX, maxX, minZ, maxZ]. */
  _computeBlockers() {
    const out = [];
    const tile = this.city.tile;
    for (const row of this.city.cells) {
      for (const cell of row) {
        if (cell.kind !== 'lot' && cell.kind !== 'door-lot') continue;
        const inset = (this.config.city.sidewalkWidth ?? 2.6);
        out.push([
          cell.centre.x - tile / 2 + inset,
          cell.centre.x + tile / 2 - inset,
          cell.centre.z - tile / 2 + inset,
          cell.centre.z + tile / 2 - inset,
        ]);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ active
  activate({ instant = false } = {}) {
    this.active = true;
    this.root.visible = true;
    this.ctx.postfx.applyGrade(this.config.grade, instant);
    this.ctx.timeOfDay.setDistrictGrade(this.config.grade);
    if (this.config.hour != null) this.ctx.timeOfDay.setHour(this.config.hour, instant);
    this.ctx.audio?.setDistrict(this.config);
    this.ctx.player?.setBlockers(this.blockers);
    bus.emit('district:active', {
      id: this.id,
      name: this.config.name,
      subtitle: this.config.subtitle,
    });
  }

  deactivate() {
    this.active = false;
    this.root.visible = false;
    for (const door of this.doors?.doors ?? []) {
      door.close();
      door.unloadInterior();
    }
  }

  get spawn() { return this.config.spawn ?? { position: [0, 0, 0], yaw: 0 }; }
  get intro() { return this.config.intro; }

  // ------------------------------------------------------------------ update
  update(dt, playerPos) {
    if (!this.active) return;
    this._time += dt;

    this.sky?.update(this.ctx.camera);
    this.doors?.update(dt, playerPos);
    this.crowd?.update(dt, this.ctx);
    this.traffic?.update(dt);
    this.weather?.update(dt, playerPos);
    this.steam?.update(dt, this._time);
    this.airMotes?.update(dt, this._time);

    // Lamp glows: billboard the air sprites and fade the whole rig with night.
    if (this.lampAir) {
      const night = this.ctx.timeOfDay.state.night;
      this.lampMaterials[0].opacity = 0.34 * night;
      // A wet road throws MORE light back, not less.
      this.lampMaterials[1].opacity = 0.42 * night * (1 + this.weather.amount * 0.5);
      const camQ = this.ctx.camera.quaternion;
      const one = SCRATCH_ONE;
      this._lampPositions.forEach((p, i) => {
        this._lampMatrix.compose(SCRATCH_V.set(p[0], p[1], p[2]), camQ, one);
        this.lampAir.setMatrixAt(i, this._lampMatrix);
      });
      this.lampAir.instanceMatrix.needsUpdate = true;
    }
  }

  /** Positional emitters this district wants alive near the player (Task 2.5). */
  emitterRequests() {
    const requests = [];
    for (const door of this.doors?.doors ?? []) {
      if (!door.cfg.emitter) continue;
      requests.push({
        id: `door:${door.id}`,
        position: door.worldPosition,
        kind: door.cfg.emitter.kind,
        // An open door is louder and less muffled - the plan's "ajar" state.
        gain: (door.cfg.emitter.gain ?? 1) * (door.open ? 1.9 : 0.85),
        maxDistance: door.cfg.emitter.maxDistance ?? 26,
      });
    }
    for (const [i, lamp] of (this.city?.lamps ?? []).entries()) {
      if (i % 3) continue;
      requests.push({
        id: `lamp:${i}`,
        position: new THREE.Vector3(lamp[0], lamp[1], lamp[2]),
        kind: 'gaslight',
        gain: 0.5,
        maxDistance: 9,
      });
    }
    for (const [i, hole] of (this.city?.manholes ?? []).entries()) {
      requests.push({
        id: `steam:${i}`,
        position: new THREE.Vector3(hole[0], hole[1], hole[2]),
        kind: 'steam',
        gain: 0.8,
        maxDistance: 14,
      });
    }
    return requests;
  }

  dispose() {
    this.doors?.dispose();
    this.crowd?.dispose();
    this.traffic?.dispose();
    this.weather?.dispose();
    this.steam?.dispose();
    this.airMotes?.dispose();
    this.sky?.dispose();
    this.city?.dispose();
    this.lampMaterials?.forEach((m) => m.dispose());
    disposeSubtree(this.root);
    this.loaded = false;
  }
}

/** Factory form, matching §3.2's `createDistrict({...})`. */
export function createDistrict(config, ctx) {
  return new District(config, ctx);
}

function makeStepper(onProgress) {
  const total = 9;
  let i = 0;
  return (label) => onProgress(Math.min(1, ++i / total), label);
}

const IDENTITY_Q = new THREE.Quaternion();
const SCRATCH_V = new THREE.Vector3();
const SCRATCH_ONE = new THREE.Vector3(1, 1, 1);
