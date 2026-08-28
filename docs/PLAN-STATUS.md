# Plan status

Where each numbered task from the project plan actually landed in the code, and
which of them are genuinely done versus done-with-a-documented-substitution.

Legend: **done** · **done (substituted)** — the plan's route needs a binary this
repo cannot ship, so a documented rung of the fallback ladder is in place and
the plan's route is wired and waiting for a file · **partial**.

## Phase 0 — Proof of Magic

| # | Task | State | Where |
|---|---|---|---|
| 0.1 | Project scaffold | done | `vite.config.js`, `src/main.js`, `src/core/` |
| 0.2 | Door component | done | `src/world/door.js` — hinge group, two-stage GSAP open, raycast + `E` |
| 0.3 | Stencil portal | done | `door.js` `_buildPortalWindow` / `maskInteriorContent`; `?portal=geometry` fallback |
| 0.4 | Interior: video | done | `src/world/interiors/video.js` — play on approach, pause on close, one decode enforced |
| 0.5 | Interior: GLTF | done (substituted) | `interiors/gltf.js` with DRACO/KTX2/meshopt + a budget audit. Kitbash is in code (`interiors/props.js`) rather than Blender |
| 0.6 | Interior: cubemap | done | `interiors/cubemap.js` — bakes six faces with a `CubeCamera` at load, box-projected lookup |
| 0.7 | Polish pass | done | warm grade per district, dust motes in the light shaft, hinge creak + latch SFX |

## Phase 1 — The Street

| # | Task | State | Where |
|---|---|---|---|
| 1.1 | Hero facade | done (substituted) | `districts/london/facades.js` — built in code, PBR maps generated |
| 1.2 | Variant system | done | 5 Victorian archetypes; storeys, brick palette, bay, shopfront, roof line |
| 1.3 | Instancing | done | `world/city.js` — `InstancedMesh` per archetype, per-instance Y-scale + hue shift |
| 1.4 | Ground | done | cobble albedo/normal/roughness + puddle decals + a wetness uniform |
| 1.5 | Atmosphere | done | `FogExp2`, instanced gaslight glow pools, bloom, vignette |
| 1.6 | Camera system | done | `player/cameraRig.js` → `player/player.js` handoff; skip jumps to the rail's end |
| 1.7 | Controls | done | `core/input.js` — WASD + pointer lock; virtual stick + drag-look |
| 1.8 | Five live doors | done | six on the London high street, one per strategy: gltf, procedural, cubemap, video, splat, district |

## Phase 2 — Life

| # | Task | State | Where |
|---|---|---|---|
| 2.1 | Pedestrian pipeline | done (substituted) | `world/people.js` — procedural 8-frame walk atlas; rigged-GLB path taken automatically if `characterUrl` is set |
| 2.2 | Path system | done | `city.js` `_addRun` derives sidewalk loops from the layout; speed variance + direction flip |
| 2.3 | Crowd scaling | done | one `InstancedMesh` for the whole crowd; tier cuts the count |
| 2.4 | Audio bed | done (substituted) | `core/audio.js` — synthesised wind, hooves, bells, sirens, horns; a real `.mp3` is used if present |
| 2.5 | Positional audio | done | piano behind the parlour door, fireplace inside rooms, jazz behind the club, gaslight hiss, steam |
| 2.6 | Door states | done | locked (rattle + hint), ajar (light spill + louder emitter), openable |
| 2.7 | Interaction feedback | done | brass handle emissive on hover, prompt with key/tap glyph |

## Phase 3 — The details

| # | Task | State | Where |
|---|---|---|---|
| 3.1 | Dust motes | done | `fx/particles.js` `Dust` — positions derived in the vertex shader |
| 3.2 | Fireplace | done | animated emissive, sprite flames, flickering point light on the interior layer |
| 3.3 | Rain mode | done | `world/weather.js` — wetness uniform, GPU streaks, awning drips, thunder + a lightning flash |
| 3.4 | Day/night cycle | done | `world/timeOfDay.js` — 8 keyframes, `globals.uNight` drives every window in the city |
| 3.5 | The secret | done | number 13, openable only between 20:00 and 05:00, with a reward interior |
| 3.6 | Film grade | done | `gfx/shaders/gradeShader.js` — ACES, lift/tint, vignette, grain, edge chromatic aberration |

## Phase 4 — Ship

| # | Task | State | Where |
|---|---|---|---|
| 4.1 | Compression pass | partial | DRACO/KTX2/meshopt are wired and the budget script gates asset weight, but there are no assets to compress yet |
| 4.2 | Quality tiers | done | `core/quality.js` — GPU/UA/core detection plus a framerate watchdog that steps the tier down |
| 4.3 | Streaming | done | `world/doorManager.js` trigger-radius load, furthest-first eviction, nearest preload |
| 4.4 | Loading experience | done | `ui/loading.js` — animated foggy illustration that match-cuts into the 3D fog |
| 4.5 | Mobile QA | partial | touch controls, tiers and a mobile fps floor are implemented; **no real-device pass has been run** |
| 4.6 | Deploy | partial | `vercel.json` with immutable asset headers; not deployed, and no analytics wired |

## Phase 5 — NYC Under Lights

| # | Task | State | Where |
|---|---|---|---|
| 5.1 | Skyline instancing | done | `districts/nyc/skyline.js` `buildBackgroundSkyline` + 3 tower archetypes in the grid |
| 5.2 | Living windows | done | one atlas, per-instance UV offset + glow + flicker seed; **every window in a district is one draw call** |
| 5.3 | Street level | done | 4 brownstone archetypes reusing the variant system; wet asphalt on the baked-cubemap rung |
| 5.4 | Neon | done | 5 free-standing hero signs plus per-frontage signs, each with a wide halo and a failing tube |
| 5.5 | Steam & life | done | manhole steam from the grid's own manholes, yellow cabs on road centrelines, sirens and horns |
| 5.6 | NYC grade | done | cooler tint, higher bloom, deep-blue sky, haze instead of fog |
| 5.7 | NYC interiors | done | brownstone (gltf→procedural), Blue Note (video→cubemap), diner (baked cubemap) |
| 5.8 | The portal | done | `interiors/district.js` preview slice + `doorManager._checkThreshold` + `districtManager.traversePortal` |

## Definition of Done

- [x] 5+ functional doors, at least 2 with full 3D interiors — 8 in London, 8 in New York; 221B, the parlour, number 13 and the walk-up are full 3D rooms
- [ ] All performance budgets met on mid-tier mobile — met on desktop and enforced live; **not yet measured on a real phone**
- [x] Fallback ladder exercised at least once in production — it fires on every single load, and says so on screen
- [ ] One secret discovered by a real user without being told — needs a real user
- [ ] The door-opening moment still gives chills after 500 views — needs 500 views

The three open items all require something outside the repository: a phone, and
a person.
