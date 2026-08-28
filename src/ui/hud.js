import { bus } from '../util/events.js';

/**
 * The HUD (Tasks 2.7 / 4.5). Deliberately almost nothing: a door prompt, a
 * toast, a district title card, and the touch controls. Everything it shows is
 * driven by events from the world, so no system needs to know the DOM exists.
 */
export class Hud {
  constructor({ input, hasTouch }) {
    this.root = document.getElementById('hud');
    this.prompt = document.getElementById('prompt');
    this.promptKey = document.getElementById('prompt-key');
    this.promptLabel = document.getElementById('prompt-label');
    this.toast = document.getElementById('toast');
    this.card = document.getElementById('district-card');
    this.cardName = document.getElementById('district-name');
    this.cardSub = document.getElementById('district-sub');
    this.hint = document.getElementById('controls-hint');
    this.touch = document.getElementById('touch');
    this.input = input;
    this._toastTimer = null;
    this._hintTimer = null;

    this.root.hidden = false;
    if (hasTouch) {
      this.touch.hidden = false;
      this.promptKey.textContent = 'TAP';
    }

    this._wire();
  }

  _wire() {
    bus.on('door:nearest', (near) => this.setPrompt(near));
    bus.on('door:locked', ({ hint }) => { if (hint) this.showToast(hint); });
    bus.on('secret:available', ({ hint }) => this.showToast(hint, 5200));
    bus.on('district:active', ({ name, subtitle }) => this.showCard(name, subtitle));
    bus.on('ladder:fallback', ({ id, requested, used }) => {
      // Surfacing this is the point: the fallback ladder should be visible in
      // production, not a thing that quietly happens in a console somewhere.
      this.showToast(`${id}: ${requested} unavailable — using ${used}`, 4200);
    });
    bus.on('intro:start', () => this.fadeHint(false));
    bus.on('intro:end', () => {
      this.fadeHint(true);
      clearTimeout(this._hintTimer);
      this._hintTimer = setTimeout(() => this.fadeHint(false), 14000);
    });
    bus.on('portal:cross', () => this.showToast('Crossing over…', 2600));
  }

  setPrompt(near) {
    if (!near || near.state === 'none') {
      this.prompt.hidden = true;
      return;
    }
    this.prompt.hidden = false;
    this.promptLabel.textContent = near.label ?? 'Open';
  }

  showToast(text, ms = 3200) {
    this.toast.textContent = text;
    this.toast.hidden = false;
    requestAnimationFrame(() => this.toast.classList.add('is-on'));
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.toast.classList.remove('is-on');
      setTimeout(() => { this.toast.hidden = true; }, 420);
    }, ms);
  }

  showCard(name, subtitle) {
    this.cardName.textContent = name ?? '';
    this.cardSub.textContent = subtitle ?? '';
    this.card.hidden = false;
    requestAnimationFrame(() => this.card.classList.add('is-on'));
    setTimeout(() => this.card.classList.remove('is-on'), 6500);
  }

  fadeHint(show) {
    this.hint.classList.toggle('is-faded', !show);
  }
}
