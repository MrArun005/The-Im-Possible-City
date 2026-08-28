import * as THREE from 'three';
import { BUDGETS } from '../../core/budgets.js';
import { disposeSubtree } from '../../util/dispose.js';

/**
 * The `video` interior strategy (Task 0.4 / Step 4).
 *
 * Hard rule from §3.4: ONE video decoding at a time. That is enforced here by
 * a module-level registry rather than by discipline - whoever plays last wins,
 * everyone else is paused. A paused, off-screen <video> costs nothing.
 */

const active = new Set();

function claimDecode(video) {
  for (const other of active) {
    if (other !== video) { other.pause(); active.delete(other); }
  }
  active.add(video);
}

function releaseDecode(video) {
  video.pause();
  active.delete(video);
}

export function activeVideoCount() { return active.size; }

export class VideoInterior {
  constructor(spec, ctx) {
    this.spec = spec;
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = `interior:video:${spec.id ?? ''}`;
    this.triangles = 4;
    this.focused = false;
    this._time = 0;
  }

  async load() {
    const spec = this.spec;
    const video = document.createElement('video');
    Object.assign(video, {
      src: spec.src,
      loop: true,
      muted: true,          // autoplay policy: muted + playsInline is the deal
      playsInline: true,
      crossOrigin: 'anonymous',
      preload: 'auto',
    });
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');

    // Fail fast so the fallback ladder can drop a rung instead of hanging.
    await new Promise((resolve, reject) => {
      const ok = () => { cleanup(); resolve(); };
      const bad = () => { cleanup(); reject(new Error(`video not playable: ${spec.src}`)); };
      const cleanup = () => {
        video.removeEventListener('loadeddata', ok);
        video.removeEventListener('error', bad);
        clearTimeout(timer);
      };
      const timer = setTimeout(bad, spec.timeout ?? 6000);
      video.addEventListener('loadeddata', ok);
      video.addEventListener('error', bad);
      video.load();
    });

    const texture = new THREE.VideoTexture(video);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const [w, h] = spec.plane ?? [1.2, 2.2];
    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshBasicMaterial({
      map: texture,
      toneMapped: false,
      side: THREE.FrontSide,
    });
    const plane = new THREE.Mesh(geo, mat);
    // Set back from the doorway so the frame parallaxes slightly over it.
    plane.position.set(0, (spec.planeY ?? h / 2), spec.planeZ ?? -0.55);
    this.root.add(plane);

    // A dark shell behind the plane so the street never shows around its edges.
    if (spec.shell !== false) {
      const [bw, bh, bd] = spec.size ?? [2.2, 2.6, 1.4];
      const shellGeo = new THREE.BoxGeometry(bw, bh, bd);
      shellGeo.translate(0, bh / 2, -bd / 2);
      const shellMat = new THREE.MeshBasicMaterial({
        color: spec.shellColor ?? 0x05040a,
        side: THREE.BackSide,
      });
      this.root.add(new THREE.Mesh(shellGeo, shellMat));
      this.shellMaterial = shellMat;
    }

    this.video = video;
    this.texture = texture;
    this.plane = plane;
    this.material = mat;
    return this;
  }

  setFocused(focused) { this.focused = focused; }

  /** Play on approach (Task 0.4). */
  activate() {
    if (!this.video || active.has(this.video)) return;
    if (active.size >= BUDGETS.videoDecodes) claimDecode(this.video);
    else active.add(this.video);
    this.video.play().catch(() => {
      // Autoplay refused despite muted+playsInline: freeze on the first frame.
      // The poster path in the risk register, without needing a poster file.
      console.warn(`[video:${this.spec.id}] autoplay blocked; holding first frame`);
    });
  }

  /** Pause on close (Task 0.4). */
  deactivate() {
    if (this.video) releaseDecode(this.video);
    this.focused = false;
  }

  update(dt) { this._time += dt; }

  dispose() {
    if (this.video) {
      releaseDecode(this.video);
      this.video.removeAttribute('src');
      this.video.load();
    }
    this.texture?.dispose();
    disposeSubtree(this.root);
  }
}
