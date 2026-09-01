# The UV fix — what actually changed

## Root cause
Utilisation was never limited by the packer. It was limited by **island count**:
5,508 islands each paying a margin. And most of those islands were *duplicates* —
14 identical road wheels, 8 identical return rollers, 2 identical tracks were each
claiming their own unique atlas space for no reason.

## The fix: UV instancing
New pipeline stage. Parts with identical topology share ONE UV footprint.

1. Signature each object: (vert count, face count, vertex coords relative to centroid,
   rounded to 0.1 mm). Procedurally generated duplicates hash identically.
2. Unwrap only ONE representative per group.
3. Copy UV channel 0 loop-for-loop to every instance.
4. **Bake only the representatives** — otherwise instances fight over the same texels
   and the bake becomes an average.
5. UV channel 1 (lightmap) stays UNIQUE per instance, because lightmaps must be.

31 objects -> 11 unique footprints. Left/right parts form separate groups: they are
mirrored, so they cannot share UVs without a U-flip.

Also tightened: island margin 0.0025 -> 0.0016, smart-project angle 66 -> 74 deg,
plus a rotation-enabled repack.

## Results
|                    |    v1 |    v2 |    v3 |
|--------------------|------:|------:|------:|
| triangles          | 14,432| 19,728| 19,728|
| UV utilisation     | 17.4% | 12.3% | **51.1%** |
| unique coverage    |     - |     - | 39.6% |
| texel density      |  41.1 |  33.9 | **69.1** |
| texel density p5   |  36.4 |  29.6 |  60.5 |

**Texel density doubled (33.9 -> 69.1 tex/m) with zero change to the mesh.**
Utilisation went 12.3% -> 51.1%, past v1's 17.4% as well.

Two numbers are reported because instanced UVs overlap:
- *unique coverage* 39.6% = real atlas area occupied by the 11 footprints
- *utilisation* 51.1% = total UV area addressed, counting instance reuse

## Remaining headroom
- Mirrored L/R groups could share with a flipped U: 11 -> 8 footprints.
- Shell-level instancing inside the track object. It holds 84 identical link
  assemblies; sharing them would cut its 3,024 unique tris to ~36 and push texel
  density to roughly 85-90 tex/m. This needs per-shell rather than per-object
  grouping and is the single biggest remaining multiplier.

## Reproduce
```bash
python3 assetpipe.py --generator tankparts:parts_named --up Y \
  --materials tankmats:library --config mbt.config.json --root Hull \
  --name MBT3 --out ./out --texsize 2048 \
  --uv-instance --uv-angle 74 --uv-margin 0.0016 --uv-pack \
  --lods 0.45,0.18 --collision box --lightmap-uv --formats glb,obj
```
