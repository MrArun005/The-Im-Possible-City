# assetpipe — generic mesh → game-ready asset pipeline

One CLI. Any mesh in, engine-ready asset out. Built on Blender/Cycles as a Python
module (`pip install bpy`) — no Blender GUI, no manual steps, fully scriptable.

```
repair → split → normals → pivots → hierarchy → UV atlas (+lightmap)
  → bake PBR → pack ORM → LODs → collision → export → QA report
```

## Install
```bash
pip install bpy numpy          # bpy 5.x needs Python 3.11
```

## Use
```bash
# any mesh file
python3 assetpipe.py --input model.fbx --name Crate --out ./out

# a Blender primitive (smoke test)
python3 assetpipe.py --builtin monkey --name Suzanne --out ./out --texsize 512

# a procedural generator + its shader library + a config
python3 assetpipe.py --generator tankparts:parts_named --up Y \
  --materials tankmats:library --config mbt.config.json --root Hull \
  --name MBT --out ./out --texsize 2048 --lods 0.45,0.18 \
  --lightmap-uv --collision box --formats glb,fbx,obj --validate-render
```

Inputs: `.obj .fbx .glb .gltf .stl .ply .blend`, a Blender primitive, or a Python
generator returning `{part: {material: [(p0,p1,p2), ...]}}`.

## Key flags
| Flag | Purpose |
|---|---|
| `--up Y` | input is Y-up; converts to Blender Z-up |
| `--split none\|loose\|material` | how to break one mesh into parts |
| `--pivot origin\|centroid\|bbox\|bottom` | per-part origin rule |
| `--config f.json` | per-part pivot / hierarchy / collision overrides |
| `--materials mod:func` | inject real shaders for the bake (keeps the tool generic) |
| `--uv smart\|keep\|none` + `--lightmap-uv` | UV0 atlas, UV1 lightmap |
| `--bake basecolor,roughness,metallic,ao,normal` | channels; `none` to skip |
| `--lods 0.45,0.18` | decimate ratios |
| `--collision none\|box\|hull\|parts` | UCX_ hulls, Unreal naming |
| `--validate-render` | Cycles render using ONLY the baked maps |

## How the bake works
Roughness / Metallic have no native Cycles bake pass, so each material is
temporarily rewired — the target socket is routed into an Emission shader and
baked as `EMIT` at 1 sample (noiseless, exact), then restored. Works with any
Principled-based material, including image-textured imports, so it also serves
as a **texture-set consolidator**: many materials in, one atlas out.

## QA report
`report.json` carries before/after audits (tris, quads, ngons, shells,
non-manifold, boundary edges, loose verts, zero-area faces, UV channels,
materials) plus UV utilisation, texel density percentiles and island count.
Metrics are triangle-equivalent, so quad and n-gon input is reported honestly.

## Config format
```json
{
  "pivots":     { "Turret": [x,y,z], "Gun": [x,y,z] },
  "hierarchy":  { "Turret": "Hull", "Gun": "Turret", "*": "Hull" },
  "collision":  ["Hull","Turret","Track_L","Track_R"]
}
```

## Animation (v9)
The hierarchy the pipeline emits is enough to rig. `MBT_LINK_PARTS=1` makes the
generator emit each track link as its own part, `mbtanim.py` keyframes the whole
vehicle (terrain ride, `θ=d/r` wheels, link scroll, turret/gun servos, recoil),
`anim.py` renders it and `rig_export.py` writes a single-clip animated GLB:

```bash
MBT_LINK_PARTS=1 python3 assetpipe.py --generator tankparts:parts_named \
  --materials tankmats:library --config mbt8.config.json --up Y \
  --bevel 0.008:2:35 --uv-instance --uv-pack --name MBT9 --out out_v9
SRC=out_v9/MBT9.glb python3 rig_export.py            # -> out_v9/MBT9_anim.glb
SRC=out_v9/MBT9.glb NF=120 RES=1152 python3 anim.py  # -> frames_drive/*.png
FRAMES=frames_drive OUT=MBT_drive.mp4 python3 encode.py
```
Every motion is derived in `docs/ANIMATION.md`. Link instancing is also why v9
packs better than v7 with 166 more objects (29.1 % → 39.5 % atlas, 48.9 → 56.4
texel/m).

## Known limits
- `smart_project` packs poorly on meshes made of many intersecting shells —
  it is island count, not the packer. `--uv-instance` recovers most of it
  (v1 17 % → v9 39.5 %); the rest needs unification/retopology.
- The rig's procedural materials are keyed to world position; animate from the
  *baked* GLB (as `anim.py` does), or the camo swims as the vehicle moves.
- Convex collision is axis-aligned boxes (`--collision hull` gives one true hull).
- No skeletal rigging; it produces the object hierarchy and pivots you rig from.
- Baking needs a Principled BSDF; other shader graphs fall back and are reported.
