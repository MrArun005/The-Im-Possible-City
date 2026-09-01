# v4 — visual detail pass

Priority order followed: bevels -> secondary geometry -> PBR -> presentation.

## 1. Bevels (geometric, not just shader)
8 mm x 2 segments, angle limit 38 deg, clamp-overlap on, applied BEFORE unwrap
so UVs cover the new chamfer faces. Hard edges are re-marked afterwards, because
the chamfer introduces new shallower edges that must not all read as sharp.
A 2 mm shader-Bevel node still rides on top to round the chamfer's own corners.

Cost measured before committing:
| setting        | faces  | vs base |
|----------------|-------:|--------:|
| 8mm x1  >38deg | 40,806 |   2.07x |
| 8mm x2  >38deg | 69,512 |   3.46x |
| 6mm x2  >45deg | 67,936 |   3.44x |
| 10mm x2 >30deg | 70,152 |   3.56x |

Chose 8mm x2. One segment is a single facet; two reads as a real chamfer.

## 2. Secondary geometry
Weld beads along the sponson underside, deck edge, glacis/roof, nose/glacis and
engine-deck rear seams. Turret ring collar weld. Four grab rails on the turret
sides with posts. (+344 source tris before bevel.)

## 3. PBR
Large-scale roughness break-up on paint, two-stage normal (coarse + 6x micro),
multi-scale metal roughness, rust masks on running gear.

## 4. Presentation
Camera raised to 18 deg elevation and sun to 26 deg. The earlier 8-deg beauty
pass failed because at near-grazing angles Fresnel sheen dominates and AgX's
shoulder desaturates the paint to cream — it was a geometry problem, not exposure.

## Numbers, honestly
|                   |    v3 |      v4 |
|-------------------|------:|--------:|
| triangles         | 19,728| 118,952 |
| faces             | 19,728|  69,512 |
| UV utilisation    | 51.1% |   29.9% |
| unique coverage   | 39.6% |   26.5% |
| texel density     |  69.1 |    49.9 |
| LOD1 / LOD2       |     - | 30,413 / 14,274 |

The bevel costs 6x triangles and ~28% texel density. That is the deliberate trade
you asked for: visual fidelity over the memory metric. Texel density is still well
above v2's 33.9, so the UV instancing win survives the bevel.

If you need the shipping-budget variant instead of the hero one:
`--bevel 0.008:1:38` gives 40,806 faces at most of the visual benefit.

Note: the bevel modifier emits quads. The pipeline now retriangulates after it,
so tri counts in later runs report honestly at source rather than at export.
