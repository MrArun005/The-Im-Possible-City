# Asset drop-in slots

Every path here is already wired to a door or a system. Put a file in and the
top rung of the fallback ladder stops failing and takes over — **no code
change**. Remove it and the ladder drops back down. That is the whole point.

Nothing in this tree is committed except these notes: the city runs with the
folders empty.

```
districts/
  london/
    ambience.mp3               ambient bed. Replaces the WebAudio synth.
    rooms/
      study/room.glb           221B. Upgrades the door from procedural → gltf.
      sitting-room/room.spz    the splat door (see docs/SPLAT-CAPTURE.md).
      rooming-house/loop.mp4   the video door. Muted, looping, playsInline.
      <any>/cube/px.jpg …      six faces for a hand-authored cubemap room.
    tiles/                     tile-pack GLBs (see below).
    people/walker.glb          a rigged character; the crowd switches to
                               AnimationMixer clones automatically.
  nyc/
    ambience.mp3
    rooms/
      apartment/room.glb       the brownstone.
      jazz-bar/loop.mp4        the Blue Note. Live music is what the video
                               strategy exists for.
      diner/cube/px.jpg …      the diner, if you would rather author the
                               cubemap than let it bake from the recipe.
    tiles/
    people/walker.glb
```

## Rules for each type

**`.glb` interiors** — any units, any orientation. `GltfInterior._autoFit`
scales the model to the room box and puts its floor at y = 0, so the 1.6 m eye
height stays correct. It is audited on load against the 100k-triangle interior
budget and **rejected** if it is over, which drops the door a rung rather than
tanking the framerate. DRACO, KTX2 and meshopt are all wired.

**`.spz` / `.ply` / `.splat`** — see `docs/SPLAT-CAPTURE.md`. Must be narrower
than the building it sits in, because splats cannot be stencilled and rely on a
box shell for masking.

**`.mp4` video** — H.264, muted, ≤ 12 MB. Only one video decodes at a time
across the whole app; that is enforced, not requested. If the file is missing or
autoplay is refused, the door falls back to a baked cubemap of the same room
recipe.

**Cubemap faces** — six images named `px nx py ny pz nz` (`.jpg`) in a
directory, and set `cubeSrc` (not `src`) on the door's interior config. With no
`cubeSrc`, the strategy renders the room once with a `CubeCamera` at load and
throws the geometry away — which is usually better, and never 404s.

**Tile packs** — `world/city.js` snaps everything to a 12 m grid with rotations
of only 0/90/180/270. Measure the road-straight piece's bounding box once and
set `tile` in the district's `city` block to match. Kinds map from the layout
characters: `C` corner, `S` straight, `T` tee, `X` intersection, `P` plaza,
`B` lot, `R` door lot.

**Ambience** — any format the browser decodes. Fetched, and on any failure the
synth bed plays instead, so a 404 here is a shrug rather than silence.

## Licensing

Only put files here that you have the right to redistribute. Nothing in this
folder is committed, which is deliberate: the repo stays clean and the city
still runs.
