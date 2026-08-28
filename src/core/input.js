import { clamp } from '../util/math.js';
import { bus } from '../util/events.js';

/**
 * One input surface for three very different devices (Tasks 1.7 / 4.5).
 * Consumers only ever read `move`, `look` and `pressed(...)`; they never know
 * whether a finger, a mouse or a keyboard produced it.
 */
export class Input {
  constructor(canvas, { touchUi } = {}) {
    this.canvas = canvas;
    this.move = { x: 0, y: 0 };     // -1..1, y+ = forward
    this.look = { x: 0, y: 0 };     // consumed (reset) every frame
    this.run = false;
    this.keys = new Set();
    this.justPressed = new Set();
    this.pointerLocked = false;
    this.hasTouch = matchMedia('(hover: none) and (pointer: coarse)').matches;
    this.lookSensitivity = 0.0022;
    this.touchLookSensitivity = 0.0038;
    this._activeTouches = new Map();
    this._destroyers = [];

    this._bindKeyboard();
    this._bindMouse();
    if (this.hasTouch) this._bindTouch(touchUi);
  }

  // ---------- keyboard ----------
  _bindKeyboard() {
    const down = (e) => {
      if (e.repeat) return;
      const code = e.code;
      this.keys.add(code);
      this.justPressed.add(code);
      if (code === 'ShiftLeft' || code === 'ShiftRight') this.run = true;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ArrowUp', 'ArrowDown'].includes(code)) {
        e.preventDefault();
      }
      bus.emit('input:key', code);
    };
    const up = (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.run = false;
    };
    const blur = () => { this.keys.clear(); this.run = false; };

    addEventListener('keydown', down, { passive: false });
    addEventListener('keyup', up);
    addEventListener('blur', blur);
    this._destroyers.push(() => {
      removeEventListener('keydown', down);
      removeEventListener('keyup', up);
      removeEventListener('blur', blur);
    });
  }

  // ---------- mouse / pointer lock ----------
  _bindMouse() {
    const canvas = this.canvas;

    const onClick = () => {
      if (this.hasTouch) return;
      if (!this.pointerLocked) canvas.requestPointerLock?.();
    };
    const onLockChange = () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      bus.emit('input:pointerlock', this.pointerLocked);
    };
    const onMove = (e) => {
      if (this.pointerLocked) {
        this.look.x += e.movementX * this.lookSensitivity;
        this.look.y += e.movementY * this.lookSensitivity;
      } else if (this._dragging) {
        this.look.x += e.movementX * this.lookSensitivity;
        this.look.y += e.movementY * this.lookSensitivity;
      }
      this.pointer = { x: (e.clientX / innerWidth) * 2 - 1, y: -(e.clientY / innerHeight) * 2 + 1 };
    };
    const onDown = (e) => { if (e.button === 0) this._dragging = true; };
    const onUp = () => { this._dragging = false; };

    canvas.addEventListener('click', onClick);
    document.addEventListener('pointerlockchange', onLockChange);
    addEventListener('mousemove', onMove);
    canvas.addEventListener('mousedown', onDown);
    addEventListener('mouseup', onUp);

    this._destroyers.push(() => {
      canvas.removeEventListener('click', onClick);
      document.removeEventListener('pointerlockchange', onLockChange);
      removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mousedown', onDown);
      removeEventListener('mouseup', onUp);
    });
  }

  // ---------- touch: left stick to walk, anywhere else to look ----------
  _bindTouch(ui) {
    const stick = ui?.stick;
    const knob = ui?.knob;
    let stickId = null;
    let stickRect = null;
    let lookId = null;
    let lastLook = null;

    const setKnob = (dx, dy) => {
      if (knob) knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };

    const onStart = (e) => {
      for (const touch of e.changedTouches) {
        const overStick = stick && isInside(stick, touch.clientX, touch.clientY);
        if (overStick && stickId === null) {
          stickId = touch.identifier;
          stickRect = stick.getBoundingClientRect();
        } else if (lookId === null) {
          lookId = touch.identifier;
          lastLook = { x: touch.clientX, y: touch.clientY };
        }
      }
    };

    const onMove = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === stickId && stickRect) {
          const cx = stickRect.left + stickRect.width / 2;
          const cy = stickRect.top + stickRect.height / 2;
          const radius = stickRect.width / 2;
          let dx = (touch.clientX - cx) / radius;
          let dy = (touch.clientY - cy) / radius;
          const len = Math.hypot(dx, dy);
          if (len > 1) { dx /= len; dy /= len; }
          this.move.x = clamp(dx, -1, 1);
          this.move.y = clamp(-dy, -1, 1);
          this.run = len > 0.86;
          setKnob(dx * radius * 0.55, dy * radius * 0.55);
        } else if (touch.identifier === lookId && lastLook) {
          this.look.x += (touch.clientX - lastLook.x) * this.touchLookSensitivity;
          this.look.y += (touch.clientY - lastLook.y) * this.touchLookSensitivity;
          lastLook = { x: touch.clientX, y: touch.clientY };
        }
      }
      e.preventDefault();
    };

    const onEnd = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === stickId) {
          stickId = null; this.move.x = 0; this.move.y = 0; this.run = false; setKnob(0, 0);
        }
        if (touch.identifier === lookId) { lookId = null; lastLook = null; }
      }
    };

    const opts = { passive: false };
    addEventListener('touchstart', onStart, opts);
    addEventListener('touchmove', onMove, opts);
    addEventListener('touchend', onEnd, opts);
    addEventListener('touchcancel', onEnd, opts);

    this._destroyers.push(() => {
      removeEventListener('touchstart', onStart);
      removeEventListener('touchmove', onMove);
      removeEventListener('touchend', onEnd);
      removeEventListener('touchcancel', onEnd);
    });

    if (ui?.action) {
      ui.action.addEventListener('click', () => this.justPressed.add('KeyE'));
    }
  }

  /** Keyboard axes are folded in here so touch state survives untouched. */
  readMove() {
    if (!this.hasTouch || this.keys.size) {
      const x = (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0)
              - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0);
      const y = (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0)
              - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0);
      if (x || y || !this.hasTouch) return { x, y };
    }
    return this.move;
  }

  consumeLook() {
    const out = { x: this.look.x, y: this.look.y };
    this.look.x = 0; this.look.y = 0;
    return out;
  }

  pressed(code) { return this.justPressed.has(code); }
  held(code) { return this.keys.has(code); }
  endFrame() { this.justPressed.clear(); }

  dispose() { this._destroyers.forEach((fn) => fn()); }
}

function isInside(el, x, y) {
  const r = el.getBoundingClientRect();
  // Generous hit area: fingers are imprecise and the stick is small on phones.
  const pad = r.width * 0.35;
  return x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
}
