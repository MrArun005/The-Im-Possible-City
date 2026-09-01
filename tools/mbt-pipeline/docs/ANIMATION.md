# Animation rig — drive, ride terrain, traverse, fire

`mbtanim.py` turns the pipeline's object hierarchy (Hull → Turret → Gun, wheels
and track links parented to the hull) into a keyframed performance. It is
name-pattern driven (`ROLES`), so any vehicle exported by `assetpipe` with the
same naming gets the same rig. `anim.py` wraps it in a cinematic scene and
renders; `rig_export.py` writes the keyframes back into a GLB so the clip plays
in a glTF viewer, Unity or Unreal.

Enable per-link tracks in the generator with `MBT_LINK_PARTS=1`
(84 links/side become `Link_L_00 … Link_R_83`). `--uv-instance` then collapses
the identical links onto one baked footprint, which is why the v9 atlas is
denser than v7 even with 166 more objects.

## Maths

**Travel.** Speed `v(t)` is a piecewise profile (accelerate 2.55→3.55 m/s,
hold, smoothstep-brake to 1.0 m/s to shoot). Distance is the trapezoid
integral per frame, `d_i = d_{i-1} + ½(v_{i-1}+v_i)·Δt`, Δt = 1/24 s.
Everything else is a function of `d`, so nothing can slip.

**Wheels.** A rolling body with no slip turns `θ = d / r`. `r` is measured per
object from its own bounding box; the sprocket and idler use the distance to
the nine nearest link centroids instead (the track's pitch radius, 0.60 m, not
the 0.55/0.52 m disc radius they were modelled with).

**Track links.** Link `k` sits in slot frame `P_k` (position = its centroid,
rotation = the loop tangent, built directly as a matrix so it never wraps at
±π). Perimeter / 84 gives the pitch `ℓ = 0.2023 m`. At distance `d` the link
is carried to fractional slot `k + d/ℓ`:

    L_k(d) = P(k + d/ℓ) · P_k⁻¹ · L_k(0)

with `P(s)` lerping both position and tangent between integer slots. Because
the same `d` drives wheels and links, the bottom run is stationary in world
space — the contact patch does not crawl.

**Chassis.** The ground is analytic, `h(x,y)` (a 0.40 m berm across the path,
a scoop after it, two sine undulations, all fading to a flat plain past 24 m).
Seven samples along each track give heights `h_L[i], h_R[i]`:

    z_target     = z_rest + max( mean(h),  max(h) − 0.28 )   # never plough
    pitch_target = −atan2( h_front − h_rear, wheelbase )
    roll_target  = −atan2( h_right − h_left, track width )

Each target feeds a second-order follower, i.e. the suspension:

    ẍ = ω²(target − x) − 2ζωẋ        z: f=1.55 Hz ζ=0.44
                                     pitch: 1.35 Hz ζ=0.40, roll: 2.10 Hz ζ=0.52

so the hull overshoots the crest and settles, instead of snapping to the
ground. Engine idle is added on top (3.5 mm at 10.5 Hz, 0.07° pitch at 13.1 Hz,
0.11° roll at 6.7 Hz).

**Turret and gun.** The turret is authored 13° pre-traversed, so the rest bore
azimuth `ψ₀` is measured (muzzle end-cap centroid vs. turret pivot), not
assumed. Aim at world target `T`:

    want_yaw = atan2(dx, −dy) − ψ₀          want_el = atan2(dz, √(dx²+dy²)) + 0.9°

Both are rate-limited servos (26°/s traverse, 9°/s elevation). Elevation is
about the trunnion axis, `R_g = R_z(ψ₀)·R_x(−el)·R_z(ψ₀)ᵀ`, so a 55° traversed
gun still elevates straight, and recoil is along the true bore vector.

**Fire.** The round goes when the aim error is < 0.45° (frame 66 here).
Recoil stroke 0.40 m in 3 frames (`1−(1−u)³`), then counter-recoil

    x(τ) = 0.40 · e^{−6.2τ} · cos(2π·1.55τ)

which overshoots forward by ~4 % before settling — the “forward slap” of a real
recuperator. The hull takes a matching impulse: 0.95° nose-up, 14 mm heave,
55 mm shove backwards, all `e^{−6.5τ}·sin(2π·2.4τ)`.

**Muzzle flash.** An emissive *volume* (Principled Volume, emission strength
1100 · falloff · noise, density 3.0), not an emissive surface: a solid emitter
reads as a white cardboard shape. Envelope over frames 66–70 is
`[1.0, 0.72, 0.32, 0.10, 0.02]`; a 380 kW point light throws the flash onto the
hull and ground. Muzzle smoke, ground blast and per-track dust are Principled
Volume spheres born in world space as the tracks pass, growing `r₀→r₁` with
`1−(1−u)²` and fading `(1−u)^1.7`.

**Ruts.** 38 tiles per track (0.42 m long, spoil lips +5 cm, floor −7.8 cm)
rise into place over 3 frames while the hull is directly above them, so the
displacement moment is hidden by the vehicle.

**Camera.** A tripod pan (aim lerps to the hull at 0.16/frame), slow push-in
27.5 → 25 m, 58 mm, f/4.5 focused on the hull. At the shot the framing leads
46 % toward the muzzle. Camera elevation is 9°: below ~6° the vehicle flanks
catch the sky specular and the camouflage washes out to pale grey (measured:
skirt luminance 0.275 at 14°, 0.495 at 3°). Blast shake is 55 mm Gaussian,
`e^{−0.30k}`, 16 frames.

## Files
| file | what |
|---|---|
| `mbtanim.py` | the rig: terrain, travel, chassis, wheels, links, servos, recoil |
| `anim.py` | scene + FX + camera + render (`STILL=n` for one frame, `NORENDER=1` to save a .blend) |
| `rig_export.py` | bake the rig into `*_anim.glb` (glTF animation channels) |
| `encode.py` | PNG frames → MP4 via Blender's FFmpeg, plus a contact sheet |
| `mbt8.config.json` | pivots/hierarchy for the per-link build |
