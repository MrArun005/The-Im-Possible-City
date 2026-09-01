# v2 changes (against the review priorities)

P1 bevel      shader-based (Cycles Bevel node, r=9mm) baked into the normal map.
              Geometric bevel measured first: 1 seg = 2.07x tris, 2 seg = 3.46x.
              Rejected in favour of 0-triangle rounded shading.
P2 materials   large-scale roughness break-up on paint (x0.80-1.18 noise),
              two-stage normal (coarse + 6x micro), widened metal roughness spread.
P3 tracks      link pitch gap 14%, separate pad plate + ground grouser + centre
              guide horn per link. Wheels: rim proud of tyre, hub boss, 6 bolts.
P4 details     hatch ring bolts, lifting eyes. NOT done: weld seams, cables, decals.
P5 UV          NOT fixed - regressed. See below.
P6 renders     3 shots: technical (good), beauty (tonality issue), detail (framing).
P7 rig         not attempted. Hierarchy + pivots are in place for it.

## Metrics v1 -> v2
tris        14,432 -> 19,728   (+37%, all mechanical detail)
verts        8,468 -> 11,700
shells         626 -> 918
UV islands   3,756 -> 5,508
utilisation  17.4% -> 12.3%    <-- REGRESSION
texel/m       41.1 -> 33.9     <-- REGRESSION

Adding mechanical detail as separate intersecting solids made UV packing worse,
exactly as the review predicted. The fix is the separate export-mesh stage:
merge coadjacent surfaces before unwrapping. Not yet built.

## Files
MBT2.glb            start here: 31-part hierarchy, 2 UV sets, textures embedded
MBT2.obj/.mtl       normals + UVs, MTL references the PNGs
MBT2_BaseColor.png  2048 sRGB
MBT2_ORM.png        2048 linear, R=AO G=Roughness B=Metallic
MBT2_Normal.png     2048 linear tangent-space (carries the bevel rounding)
MBT2_LOD1/2.obj     8,876 / 3,550 tris
MBT2_collision.obj  4 UCX hulls
