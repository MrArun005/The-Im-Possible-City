"""Three hero renders from the EXPORTED glb - proves the shipped asset, not the source scene."""
import bpy, math, os, sys
from mathutils import Vector, Matrix
OUT=os.environ.get("OUT",os.path.dirname(os.path.abspath(__file__))+"/")
GLB=os.environ.get("GLB")
if not GLB: raise SystemExit("set GLB=/path/to/asset.glb (optionally OUT=/render/dir/)")
SHOT=os.environ.get("SHOT","beauty")

CFG={
 # name        sun_el sun_energy  sun_colour            aero  expo   cam_el lens fit   sky_str
 "beauty":   ( 15.0,  560.0, (1.00,0.89,0.76), 1.4, -6.95,  8.0, 85.0, 0.95, 1.00),
 "technical":( 46.0,  760.0, (1.00,0.97,0.94), 0.9, -5.90, 24.0, 80.0, 1.00, 1.30),
 "detail":   ( 24.0,  680.0, (1.00,0.92,0.82), 1.2, -5.70, 10.0,135.0, 0.32, 1.15),
 # steeper camera than the failed beauty pass: avoids the grazing-Fresnel washout
 "hero":     ( 26.0,  650.0, (1.00,0.93,0.84), 1.1, -5.80, 18.0,105.0, 0.86, 1.20),
 "hero_low": ( 19.0,  560.0, (1.00,0.90,0.78), 1.3, -5.95, 13.0, 95.0, 0.88, 1.15),
}
sel,sen,scol,aero,expo,camel,lens,fit,skystr=CFG[SHOT]

bpy.ops.wm.read_factory_settings(use_empty=True)
sc=bpy.context.scene
sc.render.engine='CYCLES'; sc.cycles.device='CPU'
bpy.ops.import_scene.gltf(filepath=GLB)
objs=[o for o in bpy.data.objects if o.type=='MESH']

# sun azimuth kept perpendicular to view so the cast shadow stays visible
AZ=math.radians(38.0)
SUN=Vector((math.cos(AZ)*math.cos(math.radians(sel)),
            math.sin(AZ)*math.cos(math.radians(sel)),
            math.sin(math.radians(sel)))).normalized()

w=bpy.data.worlds.new("W"); sc.world=w; w.use_nodes=True
wnt=w.node_tree
for n in list(wnt.nodes): wnt.nodes.remove(n)
wo=wnt.nodes.new('ShaderNodeOutputWorld'); wo.is_active_output=True
bg=wnt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value=skystr
sky=wnt.nodes.new('ShaderNodeTexSky')
sky.sky_type='MULTIPLE_SCATTERING'; sky.sun_disc=False
sky.sun_elevation=math.radians(sel); sky.sun_rotation=AZ
sky.aerosol_density=aero; sky.altitude=120.0
try: sky.ground_albedo=0.24
except Exception: pass
wnt.links.new(sky.outputs['Color'],bg.inputs['Color'])
wnt.links.new(bg.outputs['Background'],wo.inputs['Surface'])

sl=bpy.data.lights.new("Sun",'SUN'); sl.energy=sen; sl.color=scol
sl.angle=math.radians(0.55)
so=bpy.data.objects.new("Sun",sl); bpy.context.collection.objects.link(so)
so.rotation_mode='QUATERNION'
so.rotation_quaternion=Vector((0,0,-1)).rotation_difference(-SUN)

lo=Vector((1e9,)*3); hi=Vector((-1e9,)*3)
for o in objs:
    for c in o.bound_box:
        p=o.matrix_world@Vector(c)
        for i in range(3): lo[i]=min(lo[i],p[i]); hi[i]=max(hi[i],p[i])
ctr=(lo+hi)*0.5; rad=(hi-lo).length*0.5

# ground: dirt with relief
bpy.ops.mesh.primitive_plane_add(size=600,location=(ctr.x,ctr.y,lo.z))
gm=bpy.data.materials.new("dirt"); gm.use_nodes=True
gnt=gm.node_tree
gb=next(n for n in gnt.nodes if n.type=='BSDF_PRINCIPLED')
tc=gnt.nodes.new('ShaderNodeTexCoord')
n1=gnt.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value=0.35
n1.inputs['Detail'].default_value=9.0
n2=gnt.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value=22.0
n2.inputs['Detail'].default_value=8.0
gnt.links.new(tc.outputs['Object'],n1.inputs['Vector'])
gnt.links.new(tc.outputs['Object'],n2.inputs['Vector'])
mx=gnt.nodes.new('ShaderNodeMixRGB')
mx.inputs['Color1'].default_value=(0.128,0.092,0.053,1)
mx.inputs['Color2'].default_value=(0.052,0.042,0.032,1)
gnt.links.new(n1.outputs['Fac'],mx.inputs['Fac'])
gnt.links.new(mx.outputs['Color'],gb.inputs['Base Color'])
gb.inputs['Roughness'].default_value=0.93
bp=gnt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value=0.9
bp.inputs['Distance'].default_value=0.13
gnt.links.new(n2.outputs['Fac'],bp.inputs['Height'])
gnt.links.new(bp.outputs['Normal'],gb.inputs['Normal'])
bpy.context.object.data.materials.append(gm)

# camera perpendicular to the sun azimuth
perp=Vector((math.sin(AZ),-math.cos(AZ)))
EL=math.radians(camel)
d=Vector((perp.x*math.cos(EL),perp.y*math.cos(EL),math.sin(EL))).normalized()
cd=bpy.data.cameras.new("C"); cd.lens=lens; cd.sensor_width=36.0
dist=rad/math.tan(math.atan(cd.sensor_width/2/cd.lens))*fit
cd.dof.use_dof=True; cd.dof.aperture_fstop=6.3 if SHOT!="detail" else 3.5
cd.dof.focus_distance=dist
cam=bpy.data.objects.new("C",cd); bpy.context.collection.objects.link(cam)
aim=ctr.copy()
if SHOT=="beauty":  aim.z=lo.z+(hi.z-lo.z)*0.36
if SHOT=="detail":  aim=Vector((ctr.x*0.2,ctr.y-1.1,lo.z+0.72))
eye=aim+d*dist
zc=(eye-aim).normalized(); xc=Vector((0,0,1)).cross(zc).normalized(); yc=zc.cross(xc)
cam.matrix_world=Matrix.Translation(eye)@Matrix((xc,yc,zc)).transposed().to_4x4()
sc.camera=cam

sc.cycles.samples=int(os.environ.get("SAMP","120"))
sc.cycles.use_adaptive_sampling=True; sc.cycles.adaptive_threshold=0.018
sc.cycles.use_denoising=True; sc.cycles.max_bounces=10
sc.render.resolution_x=1500; sc.render.resolution_y=900
sc.view_settings.view_transform='AgX'; sc.view_settings.exposure=expo
try: sc.view_settings.look='AgX - Medium High Contrast'
except Exception: pass
sc.render.filepath=OUT+"shot_%s.png"%SHOT
print("rendering",SHOT,"sun_el",sel,"cam_el",camel,"lens",lens,"dist %.1f"%dist)
bpy.ops.render.render(write_still=True)
print("WROTE",sc.render.filepath)
