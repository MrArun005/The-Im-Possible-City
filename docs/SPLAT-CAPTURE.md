# Capturing a splat interior

The `splat` strategy (`src/world/interiors/splat.js`) is the top rung of the
interior ladder: a real room, photographed, with real light baked in. This is
the recipe for producing one, and the calibration workflow for getting it to sit
correctly behind a door.

## 1. Choose the room

Pick a room with **strong fixed lighting** — a lamp-lit study, not a
window-blasted one. Splats bake lighting in, so moody lighting is a free
cinematic grade and blown-out daylight is a permanent mistake.

## 2. Capture (phone, 20–30 minutes)

1. Video mode, 4K if the phone has it.
2. **Lock exposure and focus** (tap and hold on iPhone). Autoexposure drifting
   mid-orbit is the single most common way a capture is ruined.
3. Walk **two slow orbits** of the room, at two heights: chest, then knee.
4. Always move sideways. Never spin in place — a pivot gives the solver no
   parallax and it will produce mush.
5. Overlap everything. 60–90 seconds total.
6. Extra slow passes over the hero zone — the desk, the fireplace, whatever the
   door frames. Splat density follows camera dwell, so spend it where the eye
   will go.

## 3. Convert

| Route | Notes |
|---|---|
| Luma AI app | easiest. Upload video, export Gaussian Splat (`.ply` / `.splat`). |
| Postshot (Windows) | best quality, local, free. Import video, train, export. |
| Brush / OpenSplat | open source, local. |

Then compress to **`.spz`** — typically 5–10× smaller than `.ply`, and Spark
reads it natively. Target **≤ 15 MB per room**; `npm run budget` fails the build
above that.

## 4. Drop it in

```
public/districts/london/rooms/sitting-room/room.spz
```

That path is already configured on the `sitting-room-door` in
`src/districts/london/index.js`. No code change: the ladder's top rung simply
stops failing and takes over.

## 5. Calibrate

Splats come out of every trainer in arbitrary units, and most come out upside
down — hence the `(1, 0, 0, 0)` quaternion, which is a 180° flip about X.

```bash
npm run dev
# then open with the debug flag:
# http://localhost:5173/?splatdebug=1
```

Walk to the door and open it. The console prints the live transform, and the
SplatMesh is on `window.__splat`. Adjust from the console until the floor sits
at y = 0 and the room reads correctly at **1.6 m eye height** (the hard rule —
everything in this project is built to it):

```js
__splat.scale.setScalar(0.85);
__splat.position.set(0, -0.2, -2.4);
__splat.quaternion.set(1, 0, 0, 0);
```

Then copy the numbers into the door config and they are permanent:

```js
interior: {
  type: 'splat',
  src: '/districts/london/rooms/sitting-room/room.spz',
  calibration: { scale: 0.85, quaternion: [1, 0, 0, 0], offset: [0, -0.2, -2.4] },
}
```

## Why splats do not get stencilled

Spark draws splats through its own accumulator, so per-material stencil settings
never reach them. The pragmatic path, and the one taken here: the splat interior
reports `maskable = false` and ships its own light-tight box shell. The building
wall and that shell do the masking instead — the geometry fallback from the risk
register, which is 90% of the effect at zero risk.

The practical consequence: a splat room must be **narrower than the building it
sits in**, or its edges will show around the door frame. Trim the capture, or
shrink the calibration scale.
