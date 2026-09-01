"""Cinematic render: warm key + cool sky fill + cold rim, mud with ruts, real composition."""
import bpy, math, os, sys
from mathutils import Vector, Matrix
OUT=os.environ.get("OUT",os.path.dirname(os.path.abspath(__file__))+"/")
GLB=os.environ.get("GLB"); assert GLB, "set GLB="
NAME=os.environ.get("NAME","cine")

bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene; sc.render.engine='CYCLES'; sc.cycles.device='CPU'
bpy.ops.import_scene.gltf(filepath=GLB)
objs=[o for o in bpy.data.objects if o.type=='MESH']

AZ=math.radians(42.0); SUN_EL=math.radians(21.0)
SUN=Vector((math.cos(AZ)*math.cos(SUN_EL),math.sin(AZ)*math.cos(SUN_EL),math.sin(SUN_EL))).normalized()

# ---------------- sky
w=bpy.data.worlds.new("W"); sc.world=w; w.use_nodes=True
nt=w.node_tree
for n in list(nt.nodes): nt.nodes.remove(n)
wo=nt.nodes.new('ShaderNodeOutputWorld'); wo.is_active_output=True
bg=nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value=1.30
sk=nt.nodes.new('ShaderNodeTexSky'); sk.sky_type='MULTIPLE_SCATTERING'; sk.sun_disc=False
sk.sun_elevation=SUN_EL; sk.sun_rotation=AZ; sk.aerosol_density=1.9; sk.altitude=90.0
try: sk.ground_albedo=0.20
except Exception: pass
nt.links.new(sk.outputs['Color'],bg.inputs['Color'])
nt.links.new(bg.outputs['Background'],wo.inputs['Surface'])

# ---------------- key + rim
key=bpy.data.lights.new("key",'SUN'); key.energy=640; key.color=(1.0,0.90,0.78)
key.angle=math.radians(0.55)
ko=bpy.data.objects.new("key",key); bpy.context.collection.objects.link(ko)
ko.rotation_mode='QUATERNION'; ko.rotation_quaternion=Vector((0,0,-1)).rotation_difference(-SUN)

RAZ=AZ+math.radians(158.0); REL=math.radians(11.0)
RIM=Vector((math.cos(RAZ)*math.cos(REL),math.sin(RAZ)*math.cos(REL),math.sin(REL))).normalized()
rim=bpy.data.lights.new("rim",'SUN'); rim.energy=210; rim.color=(0.72,0.82,1.0)
rim.angle=math.radians(3.0)
ro=bpy.data.objects.new("rim",rim); bpy.context.collection.objects.link(ro)
ro.rotation_mode='QUATERNION'; ro.rotation_quaternion=Vector((0,0,-1)).rotation_difference(-RIM)

# ---------------- bounds
lo=Vector((1e9,)*3); hi=Vector((-1e9,)*3)
for o in objs:
    for c in o.bound_box:
        p=o.matrix_world@Vector(c)
        for i in range(3): lo[i]=min(lo[i],p[i]); hi[i]=max(hi[i],p[i])
ctr=(lo+hi)*0.5; rad=(hi-lo).length*0.5

# ---------------- churned mud with ruts behind the tracks
bpy.ops.mesh.primitive_plane_add(size=500,location=(ctr.x,ctr.y,lo.z))
gm=bpy.data.materials.new("mud"); gm.use_nodes=True
g=gm.node_tree
gb=next(n for n in g.nodes if n.type=='BSDF_PRINCIPLED')
pos=g.nodes.new('ShaderNodeNewGeometry')
sep=g.nodes.new('ShaderNodeSeparateXYZ'); g.links.new(pos.outputs['Position'],sep.inputs['Vector'])
# |x| - 1.53  -> gaussian band at each track line
ax=g.nodes.new('ShaderNodeMath'); ax.operation='ABSOLUTE'
g.links.new(sep.outputs['X'],ax.inputs[0])
dx=g.nodes.new('ShaderNodeMath'); dx.operation='SUBTRACT'; dx.inputs[1].default_value=1.53
g.links.new(ax.outputs['Value'],dx.inputs[0])
sq=g.nodes.new('ShaderNodeMath'); sq.operation='POWER'; sq.inputs[1].default_value=2.0
g.links.new(dx.outputs['Value'],sq.inputs[0])
nb=g.nodes.new('ShaderNodeMath'); nb.operation='MULTIPLY'; nb.inputs[1].default_value=-5.0
g.links.new(sq.outputs['Value'],nb.inputs[0])
ex=g.nodes.new('ShaderNodeMath'); ex.operation='POWER'; ex.inputs[0].default_value=2.718281828
g.links.new(nb.outputs['Value'],ex.inputs[1])
# only behind the vehicle (it faces -Y, so ruts trail to +Y)
# the vehicle is sitting IN its own ruts, so they run the full length of frame;
# gating them to 'behind only' hid them whenever the camera was ahead of the hull
beh=g.nodes.new('ShaderNodeMapRange')
beh.inputs['From Min'].default_value=26.0; beh.inputs['From Max'].default_value=4.0
beh.inputs['To Min'].default_value=0.25;   beh.inputs['To Max'].default_value=1.0
aby=g.nodes.new('ShaderNodeMath'); aby.operation='ABSOLUTE'
g.links.new(sep.outputs['Y'],aby.inputs[0])
g.links.new(aby.outputs['Value'],beh.inputs['Value'])
rut=g.nodes.new('ShaderNodeMath'); rut.operation='MULTIPLY'
g.links.new(ex.outputs['Value'],rut.inputs[0]); g.links.new(beh.outputs['Result'],rut.inputs[1])
# soil colour: two-tone noise, darkened in the ruts
n1=g.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value=0.32
n1.inputs['Detail'].default_value=9.0
n2=g.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value=19.0
n2.inputs['Detail'].default_value=8.0
g.links.new(pos.outputs['Position'],n1.inputs['Vector'])
g.links.new(pos.outputs['Position'],n2.inputs['Vector'])
mx=g.nodes.new('ShaderNodeMixRGB')
mx.inputs['Color1'].default_value=(0.108,0.076,0.044,1)
mx.inputs['Color2'].default_value=(0.044,0.034,0.026,1)
g.links.new(n1.outputs['Fac'],mx.inputs['Fac'])
mud=g.nodes.new('ShaderNodeMixRGB'); mud.inputs['Color2'].default_value=(0.026,0.019,0.013,1)
g.links.new(mx.outputs['Color'],mud.inputs['Color1'])
g.links.new(rut.outputs['Value'],mud.inputs['Fac'])
g.links.new(mud.outputs['Color'],gb.inputs['Base Color'])
gb.inputs['Roughness'].default_value=0.90
bp=g.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value=1.0
bp.inputs['Distance'].default_value=0.16
g.links.new(n2.outputs['Fac'],bp.inputs['Height'])
g.links.new(bp.outputs['Normal'],gb.inputs['Normal'])
bpy.context.object.data.materials.append(gm)

# ---------------- camera: 3/4 front, low-ish, long lens
perp=Vector((math.sin(AZ),-math.cos(AZ)))
CEL=math.radians(float(os.environ.get("CEL","14")))
d=Vector((perp.x*math.cos(CEL),perp.y*math.cos(CEL),math.sin(CEL))).normalized()
cd=bpy.data.cameras.new("C"); cd.lens=float(os.environ.get("LENS","105")); cd.sensor_width=36.0
dist=rad/math.tan(math.atan(cd.sensor_width/2/cd.lens))*float(os.environ.get("FIT","0.80"))
cd.dof.use_dof=True; cd.dof.aperture_fstop=4.0; cd.dof.focus_distance=dist
cam=bpy.data.objects.new("C",cd); bpy.context.collection.objects.link(cam)
aim=Vector((ctr.x,ctr.y,lo.z+(hi.z-lo.z)*0.34))
eye=aim+d*dist
zc=(eye-aim).normalized(); xc=Vector((0,0,1)).cross(zc).normalized(); yc=zc.cross(xc)
cam.matrix_world=Matrix.Translation(eye)@Matrix((xc,yc,zc)).transposed().to_4x4()
sc.camera=cam

sc.cycles.samples=int(os.environ.get("SAMP","150"))
sc.cycles.use_adaptive_sampling=True; sc.cycles.adaptive_threshold=0.015
sc.cycles.use_denoising=True; sc.cycles.max_bounces=12
sc.render.resolution_x=1600; sc.render.resolution_y=1000
sc.view_settings.view_transform='AgX'
sc.view_settings.exposure=float(os.environ.get("EXPO","-5.85"))
try: sc.view_settings.look='AgX - Medium High Contrast'
except Exception: pass
sc.render.filepath=OUT+"shot_%s.png"%NAME
print("cine: sun_el 21 rim %.0f cam_el %s lens %s dist %.1f"%(math.degrees(REL),
      os.environ.get("CEL","14"),os.environ.get("LENS","105"),dist))
bpy.ops.render.render(write_still=True)
print("WROTE",sc.render.filepath)
