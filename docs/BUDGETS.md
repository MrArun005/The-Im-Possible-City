# Performance budgets

§3.4 of the plan calls these non-negotiable, so they are enforced in three
places rather than written down once and forgotten:

| Where | What it does |
|---|---|
| `src/core/budgets.js` | the numbers, as data. The single source of truth. |
| `F1` in the running app | live meter; any breached row turns red on screen |
| `npm run budget` | build-time audit of payload and asset weight; exits non-zero, so it works as a CI gate |

## The budgets

| Budget | Limit | How it is held |
|---|---|---|
| Street geometry | ≤ 300k triangles on screen | one merged geometry per facade variant, then `InstancedMesh` per variant. A whole district's windows are one instance buffer. |
| Per interior | ≤ 100k triangles, ≤ 4 × 2K textures | the `gltf` strategy **audits the model on load** and throws a `BudgetError` if it is over, which drops the door a rung rather than tanking the framerate |
| Loaded interiors | ≤ 3 | `DoorManager._stream()` preloads the nearest and evicts the furthest closed door |
| Video decoding | 1 at a time | a module-level registry in `interiors/video.js`; whoever plays last wins and everyone else is paused |
| Real-time lights | ≤ 3 | hemisphere + one directional sun/moon, forever. The third is *borrowed*: only the single nearest interior is "focused", and only a focused interior raises its practical lights above zero. |
| Draw calls | ≤ 150 | instancing everywhere, plus shared materials — a 60-building street draws in about five |
| FPS | 60 desktop / 30 mobile floor | quality tiers, plus a watchdog that steps the tier down if the measured rate sits under the floor |
| Initial payload | ≤ 8 MB before first render | **0.97 MB** raw, ~290 kB gzipped |

## Why the payload is so small

Because there are no assets. Every texture is drawn into a canvas at startup,
every prop is assembled from boxes in code, and the audio is synthesised. The
whole city is JavaScript.

The one large dependency, `@sparkjsdev/spark` (~4.8 MB, the Gaussian-splat
renderer), is `import()`ed the first time a splat door is approached. It is a
separate Rollup chunk and a city with no splat doors never fetches a byte of
it. `npm run budget` prints the lazy chunks separately so that stays
deliberate.

## Reading the HUD

```
fps          58
draw calls  132
triangles    41k
programs     86
textures     62
geometries  154
interiors     2      ← against the 3 budget
videos        0      ← against the 1 budget
lights        3      ← against the 3 budget
tier       high
district london
```

Any row over budget turns red. The `interiors`, `videos` and `lights` rows are
the ones worth watching while adding content: they are the budgets that a new
door can quietly break.

One honesty note on `draw calls`: the number counts the **whole frame**, post
chain included, not just the scene. Bloom is five or six passes of its own, so
roughly 20 of the reported calls are the grade and the glow rather than the
city. That is the number that matters for framerate, so it is the number shown —
but if you are comparing against the plan's 300k/150 street figures, subtract
the post chain first, or press `P` to turn post off and read it clean.

## When it is still janky

The risk register's answer, and it is a real answer: **thicken the fog**
(London) or **deepen the night haze** (New York). Atmosphere is free and it
hides draw distance. In practice that means raising `grade.fogNight` in
`src/districts/*/index.js` — but past about `0.035` fog stops being atmosphere
and becomes a wall two metres from your face, so the honest fix beyond that is
to cut a row out of the layout string.
