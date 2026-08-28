# POST-SHIP

The scope-creep valve from §6 of the plan. Ideas that arrive mid-phase go here
instead of into the build. Nothing on this list is a defect.

## Content

- [ ] A third district. The system takes one as data; the question is which
      city earns the third slot. (Kowloon at night, for the neon-and-rain
      overlap with NYC. Or somewhere with real daylight, to stop the project
      being three variations on "at night".)
- [ ] More secrets. There is exactly one right now (number 13, after dark) and
      the Definition of Done asks for one real user to find it unprompted. A
      second secret should only be added after that has actually happened.
- [ ] Interiors that connect to each other — a back door out of 221B into the
      alley behind. The stencil portal already supports it; the streaming
      budget is what needs thought.
- [ ] Readable detail: a newspaper on the step with a date on it, a letter in
      the letterplate. Things that reward walking up close.

## Craft

- [ ] Real assets on the top rungs: a captured splat for the sitting room, a
      Blender-baked GLB for 221B, a shot video loop for the jazz bar. The
      ladder means these are drop-in, not rewrites.
- [ ] Interior audio occlusion that tracks the door angle properly — a lowpass
      whose cutoff opens with `hinge.rotation.y` rather than the two-state
      muffle we have now.
- [ ] Footstep surfaces from a material lookup rather than the wetness number.
- [ ] Screen-space reflections on the NYC asphalt, if a way is found that does
      not cost more than the rest of the district. The baked cubemap is good
      enough that this is a want, not a need.
- [ ] Hand-authored camera rails per district for the milestone clips, separate
      from the intro dolly.

## Systems

- [ ] Tile-pack support is written but unexercised — no pack GLBs ship here.
      Worth wiring a real one to prove the path.
- [ ] Rapier for actual collision, if interiors ever get furniture you can walk
      between. The blocker-rectangle approach is exactly right for a city of
      boxes on a grid and should not be replaced until it is not.
- [ ] Deterministic replay for the trailer cut: record input, play it back at a
      fixed timestep, capture frames.
- [ ] A `?photo=1` mode: hide the HUD, unlock the camera, add depth of field.

## Explicitly not doing

- **Multiplayer.** Nothing about this project is better with other people in it.
- **A quest or objective layer.** The door opening is the whole reward.
- **User-generated districts.** The district config is data, so it is possible,
  and that is not the same as it being a good idea.
