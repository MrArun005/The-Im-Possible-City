"""Apply the vehicle rig to a baked GLB and export it WITH the animation, so the
same 5-second performance (drive, terrain ride, wheel spin, track scroll, turret
traverse, gun elevation, recoil) plays in any glTF viewer / Unity / Unreal.

env: SRC=out_v9/MBT9.glb  OUT=out_v9/MBT9_anim.glb  NF=120
"""
import bpy, os, sys, logging
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mbtanim
from mathutils import Vector

SRC = os.environ.get("SRC", "out_v9/MBT9.glb")
OUT = os.environ.get("OUT", os.path.splitext(SRC)[0] + "_anim.glb")
NF  = int(os.environ.get("NF", "120"))

logging.getLogger("glTFImporter").setLevel(logging.WARNING)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
sc = bpy.context.scene; sc.render.fps = mbtanim.FPS
objs = [o for o in bpy.data.objects if o.type == 'MESH']
sol = mbtanim.rig(objs, nf=NF, target=Vector((-13.4, -19.6, 5.40)), start_y=6.4)
mbtanim.linearize()
sc.frame_start = 1; sc.frame_end = NF
sc.name = "MBT_drive_fire"

for o in objs: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB',
                          use_selection=True, export_yup=True,
                          export_animations=True, export_frame_range=True,
                          export_force_sampling=True, export_materials='EXPORT',
                          # ONE clip for the whole scene: viewers play a single
                          # animation at a time, 197 per-object clips would show
                          # only the hull moving
                          export_animation_mode='SCENE')
# ---- merge into ONE clip.  Blender writes one glTF animation per object;
# viewers play a single animation at a time, so only the hull would move.
import struct, json
def merge_clips(path, name):
    d = open(path, "rb").read()
    assert d[:4] == b"glTF"
    jl = struct.unpack("<I", d[12:16])[0]
    j = json.loads(d[20:20+jl]); rest = d[20+jl:]
    anims = j.get("animations", [])
    if len(anims) <= 1: return len(anims)
    ch, sm = [], []
    for a in anims:
        base = len(sm)
        sm += a["samplers"]
        for c in a["channels"]:
            c = dict(c); c["sampler"] += base; ch.append(c)
    j["animations"] = [{"name": name, "channels": ch, "samplers": sm}]
    js = json.dumps(j, separators=(",", ":")).encode()
    js += b" " * ((4 - len(js) % 4) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + rest
    open(path, "wb").write(b"glTF" + struct.pack("<II", 2, 12 + len(body)) + body)
    return len(anims)
n = merge_clips(os.path.abspath(OUT), "MBT_drive_fire")
print("WROTE", OUT, "fire frame", sol["fire"], "%.1f MB" % (os.path.getsize(OUT)/1e6),
      "merged %d clips -> 1" % n)
