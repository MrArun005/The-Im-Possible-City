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

for o in objs: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB',
                          use_selection=True, export_yup=True,
                          export_animations=True, export_frame_range=True,
                          export_force_sampling=True, export_materials='EXPORT')
print("WROTE", OUT, "fire frame", sol["fire"], "%.1f MB" % (os.path.getsize(OUT)/1e6))
