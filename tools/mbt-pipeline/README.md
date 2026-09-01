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

## Known limits
- `smart_project` packs poorly on meshes made of many intersecting shells —
  it is island count, not the packer. The MBT yields 3,756 islands → 17% atlas
  utilisation. Unify/retopologise before expecting good texel density.
- Convex collision is axis-aligned boxes (`--collision hull` gives one true hull).
- No skeletal rigging; it produces the object hierarchy and pivots you rig from.
- Baking needs a Principled BSDF; other shader graphs fall back and are reported.
