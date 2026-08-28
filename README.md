# The I'm Possible City

A cinematic, walkable city in the browser. **District 1** is Victorian London —
gaslight, cobblestone, fog after rain, doors that open into lamplit rooms.
**District 2** is New York under lights — a living night skyline, neon, wet
asphalt, manhole steam. A portal door connects them.

Built with Three.js. No build-time asset downloads, no accounts, no keys:
`git clone && npm install && npm run dev` and the city is there.

```bash
npm install
npm run dev          # http://localhost:5173
npm run verify       # production build + budget audit
```

---

## The one idea

> *If we struggle to do something one way, we always have a different way of
> working.*

Every door in the city names the interior it **wants**. If that fails — file
missing, decoder unavailable, over the triangle budget, autoplay refused, WASM
blocked — the door drops a rung and keeps working. The street never notices.

```
splat   →  gltf  →  cubemap  →  procedural
gltf    →  cubemap  →  procedural
video   →  cubemap  →  procedural
cubemap →  procedural
procedural                      ← the floor: needs no files, so it cannot fail
```

This is not a document, it is `src/world/interior.js`. It runs on every load,
it logs which rung it used, and it puts a toast on screen when it falls back.
Open the console on a fresh clone and you will see the ladder fire — because
this repo ships no `.glb`, `.spz` or `.mp4`, every 3D door is currently running
two rungs down and still looks like a room.

## Controls

| | |
|---|---|
| `W A S D` / arrows | walk (`Shift` to run) |
| mouse | look (click to capture the pointer) |
| `E` / `Space` / click a door | open the nearest door |
| `N` | day ↔ night |
| `R` | rain on/off |
| `F1` | budget HUD |
| `M` | mute |
| `P` | post-processing on/off |
| `Esc` | skip the intro dolly |

Touch: left thumb-stick walks, drag anywhere to look, the round button opens.

### URL switches

| | |
|---|---|
| `?tier=low\|medium\|high` | force a quality tier |
| `?district=nyc` | start in New York |
| `?intro=0` | skip the intro dolly |
| `?stats=1` | budget HUD on from the start |
| `?portal=geometry` | disable the stencil portal, use the box-room fallback |
| `?post=0` | disable post-processing |
| `?reflect=off` | drop the wet-asphalt reflection a rung |
| `?hour=13` | start at a given hour |
| `?decoders=local` | load DRACO/KTX2 from `/vendor` instead of the CDN |
| `?splatdebug=1` | print a splat's live transform for calibration |

Console: `city.districts.goTo('nyc')`, `city.snapDoor('baker-street-221b')` —
open or shut a door with no tween, for screenshots and end-to-end tests where
waiting on an animation is a source of silently-wrong captures.

---

## Architecture

```
src/
  main.js               bootstrap, render loop, key handling
  core/                 renderer, quality tiers, input, audio, budgets, stats HUD
  fx/                   post.js (bloom + film grade), particles.js (dust/rain/steam)
  gfx/                  procedural textures, shared materials, geometry kitbashing
  world/
    door.js             the hinge door + the stencil portal
    interior.js         the strategy registry AND the fallback ladder
    interiors/          procedural · cubemap · gltf · splat · video · district
    city.js             the tile-snapped grid generator
    people.js           pedestrians (rigged GLB, or instanced silhouettes)
    vehicles.js         path followers + traffic-light phase timer
    district.js         a district = grid + crowd + traffic + weather + doors
    districtManager.js  one district loaded at a time, faded swaps
    timeOfDay.js        the 3-light rig + sky dome
    weather.js          rain, wetness, thunder
  player/               walk controller, intro rail dolly
  districts/
    london/             layout, facades, room recipes, grade, door configs
    nyc/                layout, skyline, room recipes, grade, door configs
    common/dressing.js  lamps, benches, hydrants, bins, manholes
  ui/                   loading match-cut, HUD
```

### The hinge door

The one rule: **the panel never rotates — its parent group does.** The hinge
group sits on the left edge of the opening; the panel is offset so its hinged
edge lands on the pivot.

The open ease is two-stage on purpose: a small jolt as the latch lets go, a beat
of stillness, then the long slow swing. A single tween does not land the same
way.

### The stencil portal

An invisible mesh fills the doorway and writes a stencil ref; the interior only
draws where that ref was written. The non-obvious parts:

- `depthWrite: false` on the portal mesh. If it wrote depth it would occlude the
  very room it reveals.
- `depthTest` stays **on**, which is what makes a closed door hide the interior
  *for free*: the panel is nearer, the stencil is never written, the room simply
  is not there. The reveal as the door swings is a consequence of depth, not a
  tween.
- Each door gets its own stencil ref, so one doorway cannot unmask another's
  room further down the street.
- `?portal=geometry` disables all of it and relies on the building wall to mask
  the room — the risk register's fallback, 90% of the effect, zero complexity.
- Composer render targets are created with `stencilBuffer: true`. Three's
  default composer target has stencil **off**, and the symptom is a portal that
  silently renders nothing.

### The district system

A district supplies a layout string, a colour grade, an audio bed and door
configs. It supplies **no engine code**. New York reuses London's grid, facade
variant system, door component, crowd, traffic, weather and post chain
verbatim; what differs is assets and a grade. That is the whole promise of the
district architecture, and it is checkable: `src/districts/*/index.js` are pure
data plus one `decorate()` hook each.

### Three lights, and the fourth that isn't a light

The budget is three real-time lights, total: a hemisphere for sky/ground
ambient, one directional that is the sun by day and the moon by night, and a
third that the single nearest interior *borrows* — an unfocused room's
practicals sit at zero intensity and cost nothing.

That leaves a real problem: one directional light can only ever light one side
of a street, and the facades facing away from it go black. Two answers, both in
the code:

- **Azimuth is art-directed, elevation is not.** Elevation follows the clock, so
  dawn and dusk read correctly; the compass bearing is pinned per district
  (`grade.lightAzimuth`) to rake the light along the street and across the
  facades that matter. Derived purely from the hour, the moon lands behind the
  door row at half past nine and every hero door renders as an unlit slab —
  physically honest, and a badly lit city.
- **Ambient comes from the sky, not from a light.** The sky dome is prefiltered
  into a small PMREM cube and assigned to `scene.environment`, so every
  standard material in the city picks up directionally-correct fill for free. No
  light slot, one small texture, regenerated only when the sky moves.

Interior practicals also sit on their own render layer, enabled only on that
interior's own meshes — otherwise a lamp in a study lights the pavement three
metres away through solid brick, since none of these lights cast shadows.

### The living windows

Every window in a district — London sashes and Manhattan towers alike — is one
instance in **one** `InstancedMesh` sharing **one** emissive atlas. Per-instance
UV offsets choose which atlas cell each window shows, and a per-instance
flicker seed gives each one its own filament wobble. An entire skyline of
individually-lit rooms costs a single draw call. This is the cheapest "alive" in
the project.

---

## Where the plan and the code differ

Four deliberate deviations, each because the plan's primary route needs a
binary this repo cannot ship. Every one of them is a documented rung of the
fallback ladder, and every one leaves the plan's preferred route wired up and
waiting for a file.

| Plan | Here | Why | Upgrade path |
|---|---|---|---|
| PBR textures from Poly Haven / Sketchfab | drawn at runtime into canvases (`src/gfx/textures.js`) | no third-party binaries in the repo; costs ~40ms of startup and keeps the payload at ~0 bytes | drop real texture files in and swap the factory |
| Rooms kitbashed in Blender from downloaded furniture | kitbashed in code from boxes (`src/world/interiors/props.js`) | §5.2 says composition and lighting over asset quality — a fireplace of eleven boxes with the right firelight outreads a 40k-triangle armchair lit flat | the `gltf` and `splat` strategies are wired and preferred whenever a file exists |
| Mixamo rigged pedestrians with skinned instancing | 8-frame walk cycle drawn into an atlas, played per instance via UV offset, one draw call | no riggable characters ship here; the risk register's fallback was "static silhouettes", this is one rung better, and in fog a top hat and umbrella is more period-correct than a stock businessman | set `crowd.characterUrl` to a rigged GLB and `people.js` switches to `AnimationMixer` clones automatically |
| Howler.js over recorded `.mp3` beds | a small WebAudio synth (wind, hooves, sirens, fireplace, piano, footsteps, thunder) | no licensed recordings here, and a silent city fails the Phase 2 gate harder than a synthetic one | drop `ambience.mp3` into a district folder and it is fetched and used instead |

One more, on budget grounds rather than licensing: the wet-asphalt reflection
takes the plan's **middle** rung — a cubemap baked once at load from the sky and
near neon — rather than a mirrored re-render, which would cost more than the
rest of the district put together. `?reflect=off` drops to the bottom rung.

## Dropping real assets in

Nothing needs a code change. Put files here and the top rung takes over:

```
public/districts/london/
  ambience.mp3                     ← replaces the synthesised bed
  rooms/study/room.glb             ← 221B upgrades from procedural to gltf
  rooms/sitting-room/room.spz      ← the splat door lights up
  rooms/rooming-house/loop.mp4     ← the video door starts playing
  tiles/                           ← tile-pack GLBs (see the folder README)
public/districts/nyc/…             ← same layout
```

See `public/districts/README.md` for the full slot list and
`docs/SPLAT-CAPTURE.md` for the phone-capture recipe.

## Seeing what it renders

```bash
npm run render     # builds, drives a real browser, writes render-report.html
```

`scripts/render-report.mjs` captures a fixed list of checkpoint frames and
writes a **self-contained HTML proof sheet** — frames embedded, budget readout
beside them, and the fallback ladder printed as it actually fired on that run.
It runs on software GL by default, so it works on a machine with no GPU (set
`RENDER_GPU=1` to use a real one, `CHROMIUM_PATH=` to point at a browser you
already have).

Every frame in the shot list carries a `look` note saying what it exists to
prove — "nothing leaks through the closed door", "the word DINER is still
readable" — so a regression has somewhere obvious to show up. The shot list and
the open-issues notes are the first thing in the file; edit them as work lands.

The readout reports the **worst** case across every frame, not the last frame's
numbers: a budget you only met on the quietest shot is not a budget met.

## Budgets

`src/core/budgets.js` is the single source of truth, read by the runtime HUD
(`F1`), by `npm run budget`, and by `docs/BUDGETS.md`. Current state on a
desktop high tier, standing on the London high street:

| | budget | actual |
|---|---|---|
| draw calls | 150 | ~120–150 |
| street triangles | 300k | ~41k |
| loaded interiors | 3 | ≤3, furthest evicted |
| video decodes | 1 | enforced by a module-level registry |
| realtime lights | 3 | hemisphere + sun/moon + one borrowed by the focused interior |
| initial payload | 8 MB | **0.97 MB** (~290 kB gzipped) |

Spark (the Gaussian-splat renderer, ~4.8 MB) is `import()`ed only when a splat
door is first approached, so a city with no splat doors never downloads it.

## Deploy

Vercel, static. `vercel.json` sets immutable cache headers on `/districts` and
`/assets`. Any static host works — it is a Vite build with no server side.
