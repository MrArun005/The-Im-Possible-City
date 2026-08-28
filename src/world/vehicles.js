import * as THREE from 'three';
import { GeometryBuilder } from '../gfx/instancing.js';
import { disposeSubtree } from '../util/dispose.js';
import { makeRng } from '../util/rng.js';
import { damp } from '../util/math.js';

/**
 * Vehicles and traffic lights (Step 7).
 *
 * Same path-follower pattern as the crowd, on road centrelines instead of
 * sidewalks. Traffic lights run a phase timer; each car samples a stop-point
 * ahead on its own path and eases its speed to zero when its light is red.
 *
 * Bodies are instanced per part, so twelve cabs cost five draw calls: shell,
 * glass, wheels, headlights, tail lights. The lights are emissive, never point
 * lights - "every emissive glow > every added point light".
 */

const PHASE = { green: 6, yellow: 1.5, red: 6 };
const CYCLE = PHASE.green + PHASE.yellow + PHASE.red;

export class Traffic {
  constructor({ paths, lights, count = 8, archetypes, seed = 55 }, ctx) {
    this.ctx = ctx;
    this.paths = (paths ?? []).filter((p) => p.length > 14);
    this.lights = lights ?? [];
    this.count = Math.min(count, 16);
    this.archetypes = archetypes ?? [DEFAULT_CAB];
    this.root = new THREE.Group();
    this.root.name = 'traffic';
    this.rng = makeRng(seed);
    this.cars = [];
    this.time = 0;
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this._euler = new THREE.Euler();
  }

  build() {
    if (!this.paths.length || !this.count) return this;

    // Cars, spread across paths and archetypes.
    const buckets = this.archetypes.map(() => []);
    for (let i = 0; i < this.count; i++) {
      const path = this.paths[i % this.paths.length];
      const archIndex = this.rng.int(0, this.archetypes.length - 1);
      const car = {
        path,
        length: path.length,
        curve: path.curve,
        t: this.rng(),
        speed: 0,
        targetSpeed: this.rng.range(4.5, 7.5),
        cruise: 0,
        arch: archIndex,
        index: buckets[archIndex].length,
        // Which junction axis this car obeys.
        axis: path.axis,
        color: this.archetypes[archIndex].colors
          ? this.rng.pick(this.archetypes[archIndex].colors)
          : 0xffffff,
      };
      car.cruise = car.targetSpeed;
      buckets[archIndex].push(car);
      this.cars.push(car);
    }

    // One InstancedMesh set per archetype.
    this.meshes = [];
    this.archetypes.forEach((arch, i) => {
      const cars = buckets[i];
      if (!cars.length) return;
      const { geometry, materials } = arch.build();
      const perArch = {};
      for (const [slot, geo] of Object.entries(geometry)) {
        const mat = materials[slot];
        if (!mat) continue;
        const mesh = new THREE.InstancedMesh(geo, mat, cars.length);
        mesh.name = `vehicle:${arch.name}:${slot}`;
        mesh.frustumCulled = false;
        if (slot === 'body') {
          cars.forEach((c, k) => mesh.setColorAt(k, new THREE.Color(c.color)));
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }
        this.root.add(mesh);
        perArch[slot] = mesh;
      }
      this.meshes.push({ arch, cars, slots: perArch });
    });

    this._buildLights();
    return this;
  }

  /** Signal posts: a mast and three lenses, only one of which is emissive. */
  _buildLights() {
    if (!this.lights.length) return;
    const b = new GeometryBuilder();
    b.box('post', [0.14, 3.4, 0.14], [0, 1.7, 0]);
    b.box('post', [0.34, 0.9, 0.28], [0, 3.6, 0]);
    const slots = b.build();

    const postMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.65, metalness: 0.4 });
    const placements = [];
    for (const light of this.lights) {
      // One signal per junction corner, facing the road.
      placements.push({ position: [light.position[0] + 4.6, 0, light.position[2] + 4.6], rotationY: -Math.PI / 4 });
      placements.push({ position: [light.position[0] - 4.6, 0, light.position[2] - 4.6], rotationY: (Math.PI * 3) / 4 });
    }
    const post = new THREE.InstancedMesh(slots.post, postMat, placements.length);
    placements.forEach((p, i) => {
      this._m.compose(
        new THREE.Vector3().fromArray(p.position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rotationY, 0)),
        new THREE.Vector3(1, 1, 1)
      );
      post.setMatrixAt(i, this._m);
    });
    post.instanceMatrix.needsUpdate = true;
    post.name = 'traffic-posts';
    this.root.add(post);

    // Lenses as three additive quads per signal; we tint them per frame.
    const lensGeo = new THREE.PlaneGeometry(0.16, 0.16);
    this.lensMaterials = ['red', 'yellow', 'green'].map((name, i) =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color([0xff2a1a, 0xffb020, 0x30ff70][i]),
        toneMapped: false,
        transparent: true,
        opacity: 0.15,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );

    this.lensMeshes = this.lensMaterials.map((mat, li) => {
      const mesh = new THREE.InstancedMesh(lensGeo, mat, placements.length);
      placements.forEach((p, i) => {
        const dir = new THREE.Vector3(0, 0, 0.16).applyEuler(new THREE.Euler(0, p.rotationY, 0));
        this._m.compose(
          new THREE.Vector3(p.position[0] + dir.x, 3.88 - li * 0.28, p.position[2] + dir.z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, p.rotationY, 0)),
          new THREE.Vector3(1, 1, 1)
        );
        mesh.setMatrixAt(i, this._m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = `traffic-lens:${li}`;
      this.root.add(mesh);
      return mesh;
    });
    this._lightPlacements = placements;
  }

  /** Phase for a junction on a given axis. */
  phaseFor(light, axis) {
    const offset = axis === 'x' ? light.phaseOffset : light.phaseOffset + CYCLE / 2;
    const t = (this.time + offset) % CYCLE;
    if (t < PHASE.green) return 'green';
    if (t < PHASE.green + PHASE.yellow) return 'yellow';
    return 'red';
  }

  update(dt) {
    this.time += dt;

    for (const car of this.cars) {
      // Sample a stop-point ahead: where will I be in ~1.6 s?
      const lookAhead = Math.min(0.25, (car.cruise * 1.6) / car.length);
      const aheadT = (car.t + lookAhead) % 1;
      car.curve.getPointAt(aheadT, this._look);

      let stop = false;
      for (const light of this.lights) {
        const dx = this._look.x - light.position[0];
        const dz = this._look.z - light.position[2];
        if (Math.abs(dx) < 5.4 && Math.abs(dz) < 5.4) {
          const phase = this.phaseFor(light, car.axis);
          if (phase !== 'green') stop = true;
          break;
        }
      }

      car.targetSpeed = stop ? 0 : car.cruise;
      // Ease, don't snap: braking and pulling away are both gradual.
      car.speed = damp(car.speed, car.targetSpeed, stop ? 2.6 : 1.4, dt);
      car.t = (car.t + (car.speed * dt) / car.length) % 1;

      car.curve.getPointAt(car.t, this._p);
      car.curve.getPointAt((car.t + 0.004) % 1, this._look);
      const heading = Math.atan2(this._look.x - this._p.x, this._look.z - this._p.z);
      this._euler.set(0, heading, 0);
      this._q.setFromEuler(this._euler);
      this._m.compose(this._p, this._q, this._s);

      const bucket = this.meshes.find((m) => m.arch === this.archetypes[car.arch]);
      if (!bucket) continue;
      for (const mesh of Object.values(bucket.slots)) {
        mesh.setMatrixAt(car.index, this._m);
        mesh.instanceMatrix.needsUpdate = true;
      }
      // Brake lights come on when actually braking.
      const brake = bucket.slots.tail;
      if (brake) {
        brake.material.opacity = car.speed < car.cruise * 0.55 ? 1 : 0.35;
      }
    }

    // Signal lenses.
    if (this.lensMeshes && this._lightPlacements) {
      for (let li = 0; li < 3; li++) {
        const name = ['red', 'yellow', 'green'][li];
        // Two lenses per junction, both showing the x-axis phase from the post
        // facing the x road. Good enough at street level, and free.
        const phase = this.lights.length ? this.phaseFor(this.lights[0], 'x') : 'green';
        this.lensMaterials[li].opacity = phase === name ? 1 : 0.12;
      }
    }
  }

  dispose() { disposeSubtree(this.root); this.cars = []; }
}

/**
 * Default vehicle: a New York cab. Twelve boxes, and the checker stripe and
 * roof light do all the identifying work.
 */
export const DEFAULT_CAB = {
  name: 'cab',
  colors: [0xf5b301, 0xf7c331, 0xe8a800],
  build() {
    const b = new GeometryBuilder();
    b.box('body', [1.86, 0.68, 4.5], [0, 0.72, 0]);
    b.box('body', [1.74, 0.56, 2.3], [0, 1.32, -0.18]);
    b.box('body', [1.9, 0.16, 1.1], [0, 0.5, 1.9]);
    b.box('glass', [1.62, 0.48, 0.08], [0, 1.34, 0.92]);
    b.box('glass', [1.62, 0.44, 0.08], [0, 1.32, -1.34]);
    b.box('glass', [0.06, 0.42, 1.9], [-0.86, 1.34, -0.2]);
    b.box('glass', [0.06, 0.42, 1.9], [0.86, 1.34, -0.2]);
    b.box('roof', [0.62, 0.2, 0.3], [0, 1.7, 0.2]);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        b.box('wheels', [0.26, 0.62, 0.62], [sx * 0.9, 0.34, sz * 1.5]);
      }
    }
    b.box('head', [0.4, 0.16, 0.06], [-0.6, 0.78, 2.26]);
    b.box('head', [0.4, 0.16, 0.06], [0.6, 0.78, 2.26]);
    b.box('tail', [0.34, 0.14, 0.06], [-0.66, 0.86, -2.26]);
    b.box('tail', [0.34, 0.14, 0.06], [0.66, 0.86, -2.26]);
    const geometry = b.build();

    return {
      geometry,
      materials: {
        body: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.5 }),
        glass: new THREE.MeshStandardMaterial({
          color: 0x0a1018, roughness: 0.08, metalness: 0.2, transparent: true, opacity: 0.72,
        }),
        roof: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd070).multiplyScalar(2.2), toneMapped: false }),
        wheels: new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.9 }),
        head: new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xfff2d0).multiplyScalar(3.2), toneMapped: false,
        }),
        tail: new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xff2a12).multiplyScalar(2.6), toneMapped: false,
          transparent: true, opacity: 0.6,
        }),
      },
    };
  },
};

/** London: a hansom cab silhouette. Same follower, different century. */
export const HANSOM_CAB = {
  name: 'hansom',
  colors: [0x1a1614, 0x231c18],
  build() {
    const b = new GeometryBuilder();
    b.box('body', [1.5, 1.24, 2.1], [0, 1.0, -0.2]);
    b.box('body', [1.3, 0.5, 0.7], [0, 1.86, -0.5]);
    b.box('body', [0.9, 0.14, 1.9], [0, 0.5, 1.5]);
    b.box('glass', [1.1, 0.6, 0.06], [0, 1.2, 0.86]);
    for (const sx of [-1, 1]) {
      b.box('wheels', [0.12, 1.24, 1.24], [sx * 0.82, 0.62, -0.7]);
      b.box('wheels', [0.1, 0.72, 0.72], [sx * 0.72, 0.36, 1.2]);
    }
    // The horse, in five boxes. In fog, five boxes is plenty.
    b.box('body', [0.62, 0.86, 1.9], [0, 1.15, 2.9]);
    b.box('body', [0.42, 0.7, 0.5], [0, 1.5, 3.9]);
    for (const sx of [-1, 1]) {
      b.box('wheels', [0.16, 0.9, 0.16], [sx * 0.2, 0.45, 2.3]);
      b.box('wheels', [0.16, 0.9, 0.16], [sx * 0.2, 0.45, 3.5]);
    }
    b.box('head', [0.14, 0.22, 0.1], [-0.72, 1.5, 0.9]);
    b.box('head', [0.14, 0.22, 0.1], [0.72, 1.5, 0.9]);
    const geometry = b.build();

    return {
      geometry,
      materials: {
        body: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.68, metalness: 0.1 }),
        glass: new THREE.MeshStandardMaterial({
          color: 0x2a2418, roughness: 0.2, transparent: true, opacity: 0.55,
        }),
        wheels: new THREE.MeshStandardMaterial({ color: 0x14100c, roughness: 0.86 }),
        head: new THREE.MeshBasicMaterial({
          color: new THREE.Color(0xffb765).multiplyScalar(2.4), toneMapped: false,
        }),
      },
    };
  },
};
