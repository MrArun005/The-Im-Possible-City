import * as THREE from 'three';
import gsap from 'gsap';
import { GeometryBuilder } from '../gfx/instancing.js';
import * as T from '../gfx/textures.js';
import { disposeSubtree } from '../util/dispose.js';
import { bus } from '../util/events.js';

/**
 * The hinge door (Step 2) and the stencil portal (Step 3).
 *
 * THE ONE RULE: the door panel never rotates - its parent group does. The hinge
 * group sits on the left edge of the opening and the panel is offset so its
 * left edge lands on the pivot.
 *
 * Scene graph per door:
 *   root            - placed in the street, rotated to face out
 *   |- frame        - jambs, lintel, threshold, step, number plate (static)
 *   |- hinge        - THE pivot. rotates.
 *   |   |- panel    - never rotates on its own
 *   |- portalWindow - invisible stencil writer filling the opening
 *   |- interiorSlot - whatever strategy loaded, masked to the stencil
 *   |- spill        - additive light leaking out of the opening
 */

let NEXT_STENCIL_REF = 1;

const OPEN_DEG = 105;

export class Door {
  constructor(config, ctx) {
    const cfg = {
      width: 1.0,
      height: 2.1,
      thickness: 0.06,
      state: 'openable',
      triggerRadius: 8,
      disposeRadius: 20,
      openAngle: -THREE.MathUtils.degToRad(OPEN_DEG),
      hingeSide: 'left',
      ...config,
    };
    this.cfg = cfg;
    this.id = cfg.id;
    this.ctx = ctx;
    this.state = cfg.state;
    this.open = false;
    this.busy = false;
    this.interior = null;
    this.interiorPromise = null;
    this.hovered = false;
    this._time = 0;

    // Each door gets its own stencil ref. The instructions use ref 1, which is
    // correct for one door; with several doors visible at once, distinct refs
    // stop one doorway from unmasking another's room down the street.
    this.stencilRef = (NEXT_STENCIL_REF++ % 250) + 1;

    this.root = new THREE.Group();
    this.root.name = `door:${cfg.id}`;
    this.root.position.fromArray(cfg.position ?? [0, 0, 0]);
    this.root.rotation.y = cfg.rotationY ?? 0;

    this._buildFrame();
    this._buildPanel();
    this._buildPortalWindow();
    this._buildSpill();

    this.worldPosition = new THREE.Vector3();
    this.root.updateMatrixWorld(true);
    this.root.getWorldPosition(this.worldPosition);
    // The interaction point is head height in the doorway, not the floor.
    this.focusPoint = this.worldPosition.clone().setY(this.worldPosition.y + cfg.height * 0.55);

    if (this.state === 'ajar') this._setAjar();
  }

  // ------------------------------------------------------------------ build
  _buildFrame() {
    const { width, height } = this.cfg;
    const b = new GeometryBuilder();
    const jamb = 0.13;
    const depth = 0.22;

    b.box('trim', [jamb, height + jamb, depth], [-width / 2 - jamb / 2, (height + jamb) / 2, 0]);
    b.box('trim', [jamb, height + jamb, depth], [width / 2 + jamb / 2, (height + jamb) / 2, 0]);
    b.box('trim', [width + jamb * 2, jamb, depth], [0, height + jamb / 2, 0]);
    // Pediment over the door - the Victorian tell.
    b.box('trim', [width + jamb * 3, 0.1, depth + 0.14], [0, height + jamb + 0.05, 0.06]);
    b.box('trim', [0.12, 0.34, 0.12], [-width / 2 - jamb, height + jamb - 0.14, 0.1]);
    b.box('trim', [0.12, 0.34, 0.12], [width / 2 + jamb, height + jamb - 0.14, 0.1]);
    // Threshold and step.
    b.box('stonework', [width + jamb * 2, 0.06, 0.34], [0, 0.03, 0.1]);
    b.box('stonework', [width + jamb * 3, 0.12, 0.42], [0, -0.06, 0.24]);

    const slots = b.build();
    this.frameMaterials = {
      trim: new THREE.MeshStandardMaterial({
        color: this.cfg.frameColor ?? 0x14100c,
        roughness: 0.6,
        metalness: 0.06,
      }),
      stonework: new THREE.MeshStandardMaterial({
        map: T.stone(2), color: 0x9c968b, roughness: 0.88,
      }),
    };

    this.frame = new THREE.Group();
    this.frame.name = 'frame';
    for (const [slot, geo] of Object.entries(slots)) {
      const mesh = new THREE.Mesh(geo, this.frameMaterials[slot]);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      this.frame.add(mesh);
    }

    // Number plate (221B and friends) - identity for one draw call.
    if (this.cfg.label) {
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.19, 0.19),
        new THREE.MeshStandardMaterial({ map: T.numberPlate(this.cfg.label), roughness: 0.5 })
      );
      plate.position.set(this.cfg.width / 2 + 0.065, this.cfg.height * 0.78, 0.115);
      this.frame.add(plate);
    }

    this.root.add(this.frame);
  }

  _buildPanel() {
    const { width, height, thickness } = this.cfg;

    // Hinge pivot sits at the LEFT EDGE of the doorway.
    this.hinge = new THREE.Group();
    this.hinge.name = 'hinge';
    this.hinge.position.x = this.cfg.hingeSide === 'right' ? width / 2 : -width / 2;
    this.root.add(this.hinge);

    const sign = this.cfg.hingeSide === 'right' ? -1 : 1;
    const b = new GeometryBuilder();
    // Panel body, offset so its hinged edge sits on the pivot.
    const cx = sign * (width / 2);
    b.box('wood', [width, height, thickness], [cx, height / 2, 0], { uvScale: [1, height / width] });

    // Four raised panels, the classic 6-panel door minus the top pair.
    const insetW = width * 0.34;
    const rows = [
      [height * 0.74, height * 0.3],
      [height * 0.4, height * 0.26],
      [height * 0.13, height * 0.16],
    ];
    for (const [cy, ph] of rows) {
      for (const sx of [-1, 1]) {
        b.box('woodpanel', [insetW, ph, thickness * 0.55],
          [cx + sx * width * 0.21, cy, thickness * 0.42]);
      }
    }
    // Mid rail and stiles.
    b.box('woodpanel', [width * 0.94, 0.05, thickness * 0.7], [cx, height * 0.56, thickness * 0.4]);
    b.box('woodpanel', [width * 0.94, 0.05, thickness * 0.7], [cx, height * 0.25, thickness * 0.4]);

    // Fanlight glass over the panel, so a closed door still leaks light.
    const slots = b.build();

    this.panelMaterials = {
      wood: new THREE.MeshStandardMaterial({
        map: T.wood(this.cfg.woodVariant ?? 0),
        normalMap: T.woodNormal(this.cfg.woodVariant ?? 0),
        normalScale: new THREE.Vector2(0.45, 0.45),
        color: this.cfg.doorColor ?? 0x8d8378,
        roughness: 0.52,
        metalness: 0.04,
      }),
      woodpanel: new THREE.MeshStandardMaterial({
        map: T.wood(this.cfg.woodVariant ?? 0),
        color: new THREE.Color(this.cfg.doorColor ?? 0x8d8378).multiplyScalar(0.82),
        roughness: 0.6,
      }),
    };

    this.panel = new THREE.Mesh(slots.wood, this.panelMaterials.wood);
    this.panel.name = 'panel';
    this.panel.castShadow = true;
    this.panel.receiveShadow = true;
    this.hinge.add(this.panel);

    if (slots.woodpanel) {
      const inserts = new THREE.Mesh(slots.woodpanel, this.panelMaterials.woodpanel);
      inserts.name = 'panel-inserts';
      this.hinge.add(inserts);
    }

    // Brass furniture: knocker, letterplate, handle. The handle is the hover
    // target, so it lives in its own mesh.
    const brass = new THREE.MeshStandardMaterial({
      color: 0x7a5c26, roughness: 0.28, metalness: 0.92,
      emissive: new THREE.Color(0xffb765), emissiveIntensity: 0,
    });
    this.brassMaterial = brass;

    const fb = new GeometryBuilder();
    const hx = cx + sign * (width * 0.36);
    fb.box('brass', [0.07, 0.07, 0.05], [hx, this.cfg.height * 0.46, thickness * 0.7]);
    fb.box('brass', [0.05, 0.14, 0.04], [hx, this.cfg.height * 0.42, thickness * 0.9]);
    fb.box('brass', [0.2, 0.04, 0.03], [cx, height * 0.36, thickness * 0.7]);   // letterplate
    fb.box('brass', [0.11, 0.11, 0.04], [cx, height * 0.66, thickness * 0.7]);  // knocker back
    fb.box('brass', [0.13, 0.04, 0.05], [cx, height * 0.63, thickness * 0.9]);  // knocker ring
    const fslots = fb.build();
    this.handle = new THREE.Mesh(fslots.brass, brass);
    this.handle.name = 'handle';
    this.hinge.add(this.handle);
  }

  /**
   * Step 3: an invisible mesh filling the doorway that writes our stencil ref.
   * `depthWrite: false` matters - if it wrote depth it would occlude the very
   * room it is revealing. `depthTest` stays ON, which is what makes the closed
   * panel hide the interior for free: the panel is nearer, the stencil never
   * gets written, the room is simply not there.
   */
  _buildPortalWindow() {
    const { width, height } = this.cfg;
    const mat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: this.stencilRef,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), mat);
    mesh.position.set(0, height / 2, 0);
    mesh.renderOrder = 1;
    mesh.name = 'portal-window';
    this.portalWindow = mesh;
    this.portalMaterial = mat;
    this.root.add(mesh);

    this.interiorSlot = new THREE.Group();
    this.interiorSlot.name = 'interior-slot';
    // Just behind the frame, so the room's front face lands in the opening.
    this.interiorSlot.position.z = -0.15;
    this.root.add(this.interiorSlot);
  }

  /** Warm light spilling out of the opening, on the ground and in the air. */
  _buildSpill() {
    const { width, height } = this.cfg;
    const color = new THREE.Color(this.cfg.spillColor ?? '#ffb765');

    const groundMat = new THREE.MeshBasicMaterial({
      color,
      map: T.softDot(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0,
    });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(width * 2.6, 2.8), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0.02, 1.3);
    ground.renderOrder = 3;
    this.root.add(ground);

    const hazeMat = new THREE.MeshBasicMaterial({
      color,
      map: T.softDot(),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      opacity: 0,
      side: THREE.DoubleSide,
    });
    /**
     * The airborne glow at the mouth of the doorway. It has to stay SMALL and
     * FAINT: this is a big additive quad a metre in front of the reveal, and at
     * arm's length an over-sized one fills the screen with orange and hides the
     * very room it is supposed to be advertising. Learned the hard way.
     */
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.15, height * 0.95), hazeMat);
    haze.position.set(0, height * 0.48, 0.1);
    haze.renderOrder = 3;
    this.root.add(haze);

    this.spill = { ground, haze, groundMat, hazeMat, target: 0 };
  }

  // ---------------------------------------------------------------- masking
  /**
   * Applies the stencil mask to loaded interior content. Materials are cloned
   * because a shared material cannot carry a per-door stencil ref.
   */
  maskInteriorContent(object3d) {
    // `?portal=geometry` takes the risk-register fallback: no stencil at all,
    // the interior sits in a box behind the wall and the wall does the masking.
    if (this.ctx.portalMode === 'geometry') {
      this.portalWindow.visible = false;
      return;
    }
    object3d.traverse((o) => {
      if (!o.isMesh && !o.isPoints && !o.isInstancedMesh) return;
      const apply = (mat) => {
        mat.stencilWrite = true;
        mat.stencilRef = this.stencilRef;
        mat.stencilFunc = THREE.EqualStencilFunc;
        mat.stencilFail = THREE.KeepStencilOp;
        mat.stencilZFail = THREE.KeepStencilOp;
        mat.stencilZPass = THREE.KeepStencilOp;
        mat.needsUpdate = true;
      };
      if (Array.isArray(o.material)) {
        o.material = o.material.map((m) => { const c = m.clone(); apply(c); return c; });
      } else if (o.material) {
        // Interiors already build private materials, so cloning again would
        // only waste programs. Clone only if the material is shared.
        if (o.material.userData.shared) o.material = o.material.clone();
        apply(o.material);
      }
      o.renderOrder = 2;
    });
  }

  // ------------------------------------------------------------------ state
  setState(state) {
    if (this.state === state) return;
    this.state = state;
    if (state === 'ajar') this._setAjar();
    else if (state === 'locked' && this.open) this.close();
    bus.emit('door:state', { id: this.id, state });
  }

  _setAjar() {
    const angle = this.cfg.openAngle * 0.14;
    gsap.to(this.hinge.rotation, { y: angle, duration: 1.6, ease: 'power2.out' });
    this.spill.target = 0.5;
    this._ensureInterior();
  }

  /**
   * Toggle (Step 2). The open ease is deliberately two-stage: a small jolt as
   * the latch lets go, a beat of stillness, then the long slow swing. That beat
   * is the whole "chills" moment; a single tween does not land the same way.
   */
  toggle() {
    if (this.busy) return this.open;

    if (this.state === 'locked') {
      this.ctx.audio?.rattle();
      gsap.fromTo(this.hinge.rotation,
        { y: 0 },
        {
          y: this.cfg.openAngle * 0.018,
          duration: 0.07,
          yoyo: true,
          repeat: 5,
          ease: 'none',
          // An odd repeat count with yoyo lands on the "to" value, leaving the
          // door a couple of degrees ajar forever. Snap it shut.
          onComplete: () => { this.hinge.rotation.y = 0; },
        });
      bus.emit('door:locked', { id: this.id, hint: this.cfg.lockedHint });
      return false;
    }

    this.open = !this.open;
    this.busy = true;

    if (this.open) {
      this._ensureInterior();
      this.ctx.audio?.creak(true);
      const tl = gsap.timeline({ onComplete: () => { this.busy = false; } });
      tl.to(this.hinge.rotation, { y: this.cfg.openAngle * 0.04, duration: 0.16, ease: 'power3.out' })
        .to(this.hinge.rotation, { y: this.cfg.openAngle * 0.055, duration: 0.22, ease: 'sine.inOut' })
        .to(this.hinge.rotation, { y: this.cfg.openAngle, duration: 1.4, ease: 'power2.out' });
      gsap.to(this.spill, { target: 1, duration: 1.6, ease: 'power2.out' });
    } else {
      this.ctx.audio?.creak(false);
      gsap.to(this.hinge.rotation, {
        y: 0, duration: 1.4, ease: 'power3.inOut',
        onComplete: () => { this.busy = false; this.interior?.deactivate?.(); },
      });
      gsap.to(this.spill, { target: 0, duration: 1.1, ease: 'power2.in' });
    }

    bus.emit('door:toggle', { id: this.id, open: this.open, door: this });
    return this.open;
  }

  close() { if (this.open) this.toggle(); }

  /** Shut with no animation - for streaming eviction and district teardown. */
  snapShut() {
    gsap.killTweensOf(this.hinge.rotation);
    gsap.killTweensOf(this.spill);
    this.open = false;
    this.busy = false;
    this.hinge.rotation.y = 0;
    this.spill.target = 0;
    this.interior?.deactivate?.();
  }

  isOpen() { return this.open; }

  // --------------------------------------------------------------- interior
  /** Lazily loads the interior. Idempotent; safe to call every frame. */
  _ensureInterior() {
    if (this.interior || this.interiorPromise) return this.interiorPromise;
    this.interiorPromise = this.ctx.loadInterior(this).then((interior) => {
      if (!interior) return null;
      this.interior = interior;
      this.interiorSlot.add(interior.root);
      // Splats cannot be stencilled; they bring their own shell instead.
      if (interior.maskable !== false) this.maskInteriorContent(interior.root);
      interior.activate?.();
      bus.emit('door:interior', { id: this.id, type: interior.strategy });
      return interior;
    }).catch((err) => {
      console.error(`[door:${this.id}] interior failed entirely`, err);
      this.interiorPromise = null;
      return null;
    });
    return this.interiorPromise;
  }

  preload() { return this._ensureInterior(); }

  unloadInterior() {
    if (!this.interior) return;
    this.interior.dispose();
    this.interior = null;
    this.interiorPromise = null;
  }

  // ----------------------------------------------------------------- update
  setHovered(hovered) {
    if (this.hovered === hovered) return;
    this.hovered = hovered;
    gsap.to(this.brassMaterial, {
      emissiveIntensity: hovered ? 0.9 : 0,
      duration: 0.35,
      ease: 'power2.out',
    });
  }

  update(dt, ctx) {
    this._time += dt;
    const s = this.spill;
    // The spill breathes slightly - firelight, not a spotlight.
    const flicker = 0.9 + 0.1 * Math.sin(this._time * 6.1) * Math.sin(this._time * 2.3);
    // The pool on the pavement can be generous; the quad in the air cannot.
    s.groundMat.opacity = s.target * 0.42 * flicker;
    s.hazeMat.opacity = s.target * 0.1 * flicker;
    s.ground.visible = s.target > 0.01;
    s.haze.visible = s.target > 0.01;
    this.interior?.update?.(dt, ctx);
  }

  /** The interaction targets a raycaster should test. */
  get interactables() {
    return [this.panel, this.handle];
  }

  dispose() {
    this.unloadInterior();
    gsap.killTweensOf(this.hinge.rotation);
    gsap.killTweensOf(this.spill);
    disposeSubtree(this.root);
  }
}

/** Factory form, matching the interface in the implementation instructions. */
export function createDoor(config, ctx) {
  return new Door(config, ctx);
}
