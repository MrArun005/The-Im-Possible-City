import * as THREE from 'three';
import { createRenderer, createCamera, bindResize, EYE_HEIGHT } from './core/renderer.js';
import { PostFX } from './fx/post.js';
import { detectTier, makeTierWatchdog } from './core/quality.js';
import { Input } from './core/input.js';
import { AudioEngine } from './core/audio.js';
import { StatsHud } from './core/statshud.js';
import { TimeOfDay } from './world/timeOfDay.js';
import { DistrictManager } from './world/districtManager.js';
import { Player } from './player/player.js';
import { CameraRig } from './player/cameraRig.js';
import { LoadingScreen } from './ui/loading.js';
import { Hud } from './ui/hud.js';
import { londonDistrict } from './districts/london/index.js';
import { nycDistrict } from './districts/nyc/index.js';
import { globals } from './gfx/materials.js';
import * as textures from './gfx/textures.js';
import { activeVideoCount } from './world/interiors/video.js';
import { bus } from './util/events.js';
import { setParticlePixelScale } from './fx/particles.js';

/**
 * The I'm Possible City - entry point.
 *
 * Order matters here: renderer, then quality, then the shared context object,
 * then the district. Every system reads what it needs off `ctx` and nothing
 * reaches sideways into another system.
 */

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene');

const quality = detectTier();
const renderer = createRenderer(canvas, quality);
const camera = createCamera();
const scene = new THREE.Scene();

const loading = new LoadingScreen();
loading.set(0.05, 'Waking the renderer');

const postfx = new PostFX(renderer, scene, camera, quality);
if (params.get('post') === '0') postfx.enabled = false;
bindResize(renderer, camera, postfx);

// Point sprites are sized in pixels, so they need the projection factor.
const syncParticleScale = () =>
  setParticlePixelScale(renderer.domElement.height, camera.fov);
syncParticleScale();
window.addEventListener('resize', syncParticleScale);

const input = new Input(canvas, {
  touchUi: {
    stick: document.getElementById('stick'),
    knob: document.getElementById('stick-knob'),
    action: document.getElementById('touch-action'),
  },
});

const audio = new AudioEngine();
const statsHud = new StatsHud(document.getElementById('stats'), renderer);
const timeOfDay = new TimeOfDay(scene, { hour: Number(params.get('hour')) || 21.5 });
timeOfDay.enableShadows(quality.shadowSize);

const player = new Player(camera, input, { bounds: [-56, 56, -56, 56] });

/** The shared context. This is the only wiring in the whole project. */
const ctx = {
  renderer,
  camera,
  scene,
  quality,
  postfx,
  input,
  audio,
  timeOfDay,
  player,
  textures,
  statsHud,
  // `?portal=geometry` takes the risk-register fallback: no stencil at all.
  portalMode: params.get('portal') === 'geometry' ? 'geometry' : 'stencil',
  uiBlocked: true,
};

const districts = new DistrictManager(ctx);
districts.register(londonDistrict());
districts.register(nycDistrict());

const hud = new Hud({ input, hasTouch: input.hasTouch });
statsHud.set('tier', `${quality.name}${quality.isMobile ? '/mob' : ''}`);

let rig = null;
let ready = false;
let lastTime = 0;

// ------------------------------------------------------------------- events

bus.on('portal:cross', async ({ target, door }) => {
  if (!target || districts.switching) return;
  door.close();
  await districts.traversePortal(target, {
    onProgress: (p, label) => statsHud.set('loading', label),
  });
  startIntroOrWalk({ skipIntro: true });
});

bus.on('district:active', ({ id }) => statsHud.set('district', id));

// ------------------------------------------------------------------ startup

async function boot() {
  const startId = params.get('district') === 'nyc' ? 'nyc' : 'london';

  try {
    await districts.goTo(startId, {
      instant: true,
      onProgress: (p, label) => loading.set(0.1 + p * 0.85, label),
    });
  } catch (err) {
    console.error(err);
    loading.fail('The city would not build. Check the console.');
    throw err;
  }

  // Audio needs a real gesture, and so does pointer lock - one button buys both.
  await loading.ready();
  await audio.start();
  await audio.setDistrict(districts.current.config);

  loading.hide();
  ctx.uiBlocked = false;
  ready = true;

  startIntroOrWalk({ skipIntro: params.get('intro') === '0' });

  lastTime = performance.now();
  renderer.setAnimationLoop(frame);
}

function startIntroOrWalk({ skipIntro = false } = {}) {
  const intro = districts.current.intro;
  if (skipIntro || !intro) {
    const spawn = districts.current.spawn;
    camera.position.set(spawn.position[0], EYE_HEIGHT, spawn.position[2]);
    player.takeOver(camera);
    player.yaw = spawn.yaw ?? 0;
    rig = null;
    bus.emit('intro:end', { skipped: true });
    return;
  }
  rig = new CameraRig(camera, intro);
  rig.start();
  player.enabled = false;
}

// -------------------------------------------------------------------- input

const watchdog = makeTierWatchdog(quality, (tier) => {
  hud.showToast(`Framerate low — dropped to ${tier} quality`, 3600);
  if (!quality.bloom && postfx.bloom) postfx.bloom.enabled = false;
  districts.current?.crowd?.setCount(quality.pedestrians);
});

function handleKeys() {
  if (input.pressed('KeyE') || input.pressed('Space')) districts.current?.doors.activateNearest();
  if (input.pressed('KeyN')) {
    const hour = timeOfDay.toggleNight();
    hud.showToast(hour > 12 ? 'Night' : 'Day', 1600);
  }
  if (input.pressed('KeyR')) {
    const on = districts.current?.weather.toggle();
    hud.showToast(on ? 'Rain' : 'Dry', 1600);
  }
  if (input.pressed('F1') || input.pressed('Backquote')) statsHud.toggle();
  if (input.pressed('KeyM')) {
    audio.setMuted(!audio.muted);
    hud.showToast(audio.muted ? 'Muted' : 'Sound on', 1400);
  }
  if (input.pressed('KeyP')) {
    postfx.enabled = !postfx.enabled;
    hud.showToast(postfx.enabled ? 'Post-processing on' : 'Post-processing off', 1600);
  }
  if (input.pressed('Escape') && rig?.running) rig.skip();
  // Any movement key skips the intro - a cinematic you cannot skip is resented.
  if (rig?.running && (input.held('KeyW') || input.held('KeyA') ||
      input.held('KeyS') || input.held('KeyD') || input.pressed('KeyE'))) {
    rig.skip();
  }
}

// --------------------------------------------------------------------- loop

let elapsed = 0;

function frame(now = performance.now()) {
  // Capped so a stalled tab or a slow first frame cannot teleport the player
  // through a wall, and so physics stays stable on a weak GPU.
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  elapsed += dt;
  renderer.info.reset();

  handleKeys();

  if (rig?.running) {
    rig.update(dt);
  } else if (rig && !rig.finished) {
    rig = null;
  } else if (rig && rig.finished) {
    // Handoff from the rail to the walk (Task 1.6).
    player.takeOver(camera);
    player.yaw = rig.endYaw ?? player.yaw;
    rig = null;
  }

  player.update(dt);
  timeOfDay.update(dt);
  globals.uTime.value = elapsed;

  const playerPos = camera.position;
  districts.update(dt, playerPos);

  // Audio: listener follows the camera, emitters stream like interiors do.
  audio.updateListener(camera);
  if (districts.current) {
    audio.updateEmitters(districts.current.emitterRequests(), playerPos);
    const wet = districts.current.weather.amount;
    audio.updateFootsteps(player.speed, dt, wet > 0.4 ? 'wet' : 'stone');
  }

  postfx.update(elapsed, dt);
  postfx.render(scene, camera);

  const fps = statsHud.sample(dt);
  if (fps) {
    watchdog(fps, dt);
    statsHud.set('fpsFloor', quality.fpsFloor);
    statsHud.set('interiors', districts.current?.doors.loadedInteriorCount() ?? 0);
    statsHud.set('videos', activeVideoCount());
    statsHud.set('lights', countLights(scene));
    statsHud.set('tier', `${quality.name}${quality.isMobile ? '/mob' : ''}`);
    statsHud.flush();
  }

  input.endFrame();
}

function countLights(root) {
  let n = 0;
  root.traverse((o) => { if (o.isLight && o.intensity > 0.001) n++; });
  return n;
}

// ---------------------------------------------------------------- lifecycle

document.addEventListener('visibilitychange', () => {
  // A backgrounded tab should not keep a video decoding or a synth running.
  if (document.hidden) audio.setMuted(true);
  else if (ready) audio.setMuted(false);
});

boot().catch((err) => console.error('[boot]', err));

// Handy in the console: `city.districts.goTo('nyc')`.
window.city = { ctx, districts, player, timeOfDay, quality, statsHud, postfx, audio };
