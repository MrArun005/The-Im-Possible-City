"""Animated cinematic: the MBT drives over a berm, crushes a drum, traverses
its turret onto a target and fires the main gun.

env:  SRC=anim_src.blend  OUT=dir/  NAME=drive  NF=120  RES=960  SAMP=96
      DUST=1  STILL=<frame>  (render one frame at full res instead of a range)
"""
import bpy, math, os, sys, random
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mbtanim
from mbtanim import terrain, FPS

SRC  = os.environ.get("SRC", "out_v8/MBT8.glb")
OUT  = os.environ.get("OUT", os.path.dirname(os.path.abspath(__file__)) + "/")
NAME = os.environ.get("NAME", "drive")
NF   = int(os.environ.get("NF", "120"))
RES  = int(os.environ.get("RES", "960"))
SAMP = int(os.environ.get("SAMP", "96"))
DUST = os.environ.get("DUST", "1") != "0"
STILL = os.environ.get("STILL")

import logging
logging.getLogger("glTFImporter").setLevel(logging.WARNING)
if SRC.lower().endswith((".glb", ".gltf")):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
else:
    bpy.ops.wm.open_mainfile(filepath=os.path.abspath(SRC))
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
sc.render.fps = FPS
tank = [o for o in bpy.data.objects if o.type == 'MESH']
print("[anim] loaded %d objects from %s" % (len(tank), SRC))

# ================================================================= animation
TARGET = Vector((-13.4, -19.6, 5.40))
sol = mbtanim.rig(tank, nf=NF, target=TARGET, start_y=6.4)
FIRE = sol["fire"] if sol["fire"] is not None else NF - 30
hull = next(o for o in tank if o.name == "Hull")
gun  = next(o for o in tank if o.name == "Gun")

# muzzle tip, in gun-local space: furthest vertex down the bore
MUZ_LOCAL = sol["muz_local"]
print("[anim] fire frame %d, muzzle local %s" % (FIRE, tuple(round(c,3) for c in MUZ_LOCAL)))

def hull_at(f):
    return Vector((hull.matrix_world.translation.x, sol["y"][f], sol["z"][f]))

# ================================================================= ground
AZ, SUN_EL = math.radians(42.0), math.radians(21.0)
SUN = Vector((math.cos(AZ)*math.cos(SUN_EL), math.sin(AZ)*math.cos(SUN_EL),
              math.sin(SUN_EL))).normalized()

def make_ground(size=54.0, n=300):
    me = bpy.data.meshes.new("ground")
    vs, fs = [], []
    for j in range(n+1):
        for i in range(n+1):
            x = (i/n - 0.5)*size
            y = (j/n - 0.5)*size + 1.0
            vs.append((x, y, terrain(x, y)))
    for j in range(n):
        for i in range(n):
            a = j*(n+1)+i
            fs.append((a, a+1, a+n+2, a+n+1))
    me.from_pydata(vs, [], fs); me.update()
    for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new("Ground", me)
    bpy.context.collection.objects.link(ob)
    return ob

ground = make_ground()
# far ground: a single flat plate 2 mm lower, so the detailed patch always wins
bpy.ops.mesh.primitive_plane_add(size=2400.0, location=(0.0, 1.0, -0.002))
farground = bpy.context.object; farground.name = "FarGround"

gm = bpy.data.materials.new("mud"); gm.use_nodes = True
g = gm.node_tree
gb = next(n for n in g.nodes if n.type == 'BSDF_PRINCIPLED')
pos = g.nodes.new('ShaderNodeNewGeometry')
sep = g.nodes.new('ShaderNodeSeparateXYZ'); g.links.new(pos.outputs['Position'], sep.inputs['Vector'])
ax = g.nodes.new('ShaderNodeMath'); ax.operation='ABSOLUTE'
g.links.new(sep.outputs['X'], ax.inputs[0])
dx = g.nodes.new('ShaderNodeMath'); dx.operation='SUBTRACT'; dx.inputs[1].default_value=1.53
g.links.new(ax.outputs['Value'], dx.inputs[0])
sq = g.nodes.new('ShaderNodeMath'); sq.operation='POWER'; sq.inputs[1].default_value=2.0
g.links.new(dx.outputs['Value'], sq.inputs[0])
nb = g.nodes.new('ShaderNodeMath'); nb.operation='MULTIPLY'; nb.inputs[1].default_value=-6.0
g.links.new(sq.outputs['Value'], nb.inputs[0])
ex = g.nodes.new('ShaderNodeMath'); ex.operation='POWER'; ex.inputs[0].default_value=2.718281828
g.links.new(nb.outputs['Value'], ex.inputs[1])
# the ruts only exist BEHIND the vehicle -- the cut-off rides with the hull
cut = g.nodes.new('ShaderNodeValue'); cut.label = "rut_front"
beh = g.nodes.new('ShaderNodeMath'); beh.operation='SUBTRACT'
g.links.new(sep.outputs['Y'], beh.inputs[0]); g.links.new(cut.outputs['Value'], beh.inputs[1])
gate = g.nodes.new('ShaderNodeMapRange')
gate.inputs['From Min'].default_value = -0.4; gate.inputs['From Max'].default_value = 2.6
gate.inputs['To Min'].default_value = 0.0;    gate.inputs['To Max'].default_value = 1.0
g.links.new(beh.outputs['Value'], gate.inputs['Value'])
rut = g.nodes.new('ShaderNodeMath'); rut.operation='MULTIPLY'
g.links.new(ex.outputs['Value'], rut.inputs[0]); g.links.new(gate.outputs['Result'], rut.inputs[1])
n1 = g.nodes.new('ShaderNodeTexNoise'); n1.inputs['Scale'].default_value=0.32; n1.inputs['Detail'].default_value=9.0
n2 = g.nodes.new('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value=19.0; n2.inputs['Detail'].default_value=8.0
g.links.new(pos.outputs['Position'], n1.inputs['Vector'])
g.links.new(pos.outputs['Position'], n2.inputs['Vector'])
mx = g.nodes.new('ShaderNodeMixRGB')
mx.inputs['Color1'].default_value=(0.074,0.052,0.031,1); mx.inputs['Color2'].default_value=(0.031,0.024,0.018,1)
g.links.new(n1.outputs['Fac'], mx.inputs['Fac'])
mud = g.nodes.new('ShaderNodeMixRGB'); mud.inputs['Color2'].default_value=(0.013,0.009,0.006,1)
g.links.new(mx.outputs['Color'], mud.inputs['Color1'])
g.links.new(rut.outputs['Value'], mud.inputs['Fac'])
g.links.new(mud.outputs['Color'], gb.inputs['Base Color'])
gb.inputs['Roughness'].default_value = 0.90
bp = g.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value=1.0; bp.inputs['Distance'].default_value=0.14
g.links.new(n2.outputs['Fac'], bp.inputs['Height'])
g.links.new(bp.outputs['Normal'], gb.inputs['Normal'])
ground.data.materials.append(gm); farground.data.materials.append(gm)
for f in range(NF):
    cut.outputs['Value'].default_value = sol["y"][f] + 0.6
    cut.outputs['Value'].keyframe_insert("default_value", frame=f+1)

# ================================================================= props
def simple_mat(name, col, rough=0.9, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m

CONC = simple_mat("concrete", (0.121, 0.113, 0.099), 0.94)
RUST = simple_mat("drum", (0.055, 0.026, 0.016), 0.72, 0.55)

# --- track ruts: tiles that press into the ground as the tracks pass over them
RUTM = simple_mat("rut", (0.026, 0.018, 0.012), 0.95)
RUT_PROF = [(-0.42, 0.000), (-0.32, 0.050), (-0.17, -0.052), (0.0, -0.078),
            (0.17, -0.052), (0.32, 0.050), (0.42, 0.000)]

def make_ruts(x0, y_from=9.5, y_to=-6.4, L=0.42):
    m = len(RUT_PROF); n = int((y_from - y_to) / L)
    for k in range(n):
        ya = y_from - k*L; yb = ya - L; yc = (ya + yb) * 0.5
        base = terrain(x0, yc)
        vs = [(x0+dx, y, terrain(x0+dx, y) - base + dz)
              for y in (ya, yb) for (dx, dz) in RUT_PROF]
        fs = [(i, i+1, m+i+1, m+i) for i in range(m-1)]
        me = bpy.data.meshes.new("rut"); me.from_pydata(vs, [], fs); me.update()
        for pg in me.polygons: pg.use_smooth = True
        ob = bpy.data.objects.new("Rut_%s%02d" % ("L" if x0 < 0 else "R", k), me)
        bpy.context.collection.objects.link(ob)
        ob.data.materials.append(RUTM)
        # rise into place while the tile is underneath the hull, so the moment
        # the ground is displaced is hidden by the vehicle itself
        p0 = 0
        for f in range(NF):
            if sol["y"][f] <= yc + 0.5: p0 = f; break
        else: p0 = NF + 9
        for f in range(NF):
            u = max(0.0, min(1.0, (f - p0) / 3.0))
            ob.location = (0.0, 0.0, base + 0.004 - 0.17 * (1.0 - u))
            ob.keyframe_insert("location", frame=f+1)

for _x in (-1.53, 1.53): make_ruts(_x)

random.seed(7)
for i in range(26):                                  # rubble strewn about
    x = random.uniform(-16, 16); y = random.uniform(-14, 12)
    if abs(x) < 3.0 and -6 < y < 8: continue         # keep the driving line clear
    s = random.uniform(0.16, 0.62)
    bpy.ops.mesh.primitive_cube_add(size=s, location=(x, y, terrain(x, y)+s*0.32))
    o = bpy.context.object; o.name = "rubble%02d" % i
    o.rotation_euler = (random.uniform(0,3), random.uniform(0,3), random.uniform(0,3))
    o.scale = (1.0, random.uniform(0.5,1.6), random.uniform(0.3,0.8))
    o.data.materials.append(CONC)

# --- ruined tower: what the gun is aiming at, and why it has to elevate
GZ0 = terrain(TARGET.x, TARGET.y)
for k, (dx, dy, w, dp, h) in enumerate([
        (0.0,  0.0, 3.1, 3.1, 6.30),        # the standing shell
        (-2.4, 1.1, 1.6, 2.2, 3.10),        # collapsed wing
        (2.6, -0.9, 1.2, 1.8, 1.70),
        (0.2, -2.9, 4.0, 0.5, 1.20)]):      # fallen facade
    bpy.ops.mesh.primitive_cube_add(size=1.0,
        location=(TARGET.x+dx, TARGET.y+dy, GZ0 + h*0.5))
    o = bpy.context.object; o.name = "ruin%d" % k
    o.scale = (w, dp, h); o.rotation_euler = (0, 0, math.radians(9*k - 6))
    o.data.materials.append(CONC)

# --- the drum that gets run over, sitting under the left track
DRUM_Y = -1.35
bpy.ops.mesh.primitive_cylinder_add(radius=0.29, depth=0.88, vertices=28,
                                    location=(-1.53, DRUM_Y, terrain(-1.53, DRUM_Y)+0.44))
drum = bpy.context.object; drum.name = "Drum"; drum.data.materials.append(RUST)
drum_z0 = drum.location.z
# frames: hull front reaches it, then the track climbs over it
def frame_when(y_of_point):
    for f in range(NF):
        if y_of_point(f) <= DRUM_Y: return f
    return NF-1
F_HIT  = frame_when(lambda f: sol["y"][f] - 3.55)
F_OVER = frame_when(lambda f: sol["y"][f] - 1.20)
F_PAST = frame_when(lambda f: sol["y"][f] + 2.60)
print("[anim] drum: hit %d over %d past %d" % (F_HIT, F_OVER, F_PAST))
for f in range(NF):
    loc = Vector((-1.53, DRUM_Y, drum_z0)); rot = [0.0, 0.0, 0.0]; scl = [1.0, 1.0, 1.0]
    if f >= F_HIT:
        u = min(1.0, (f - F_HIT) / 5.0)                 # knocked flat, shoved along
        rot[0] = math.radians(-90*u*u*(3-2*u))
        loc.z = drum_z0 - 0.15*u
        loc.y = DRUM_Y - 0.55*u
    if f >= F_OVER:
        v = min(1.0, (f - F_OVER) / 7.0)                # crushed under the track
        scl = [1.0+0.34*v, 1.0, 1.0-0.62*v]
        loc.z = terrain(-1.53, loc.y) + 0.29*(1-0.62*v)
        loc.y -= 0.22*v
    if f >= F_PAST:
        loc.y -= 0.03*min(1.0, (f-F_PAST)/8.0)
    drum.location = loc; drum.rotation_euler = rot; drum.scale = scl
    drum.keyframe_insert("location", frame=f+1)
    drum.keyframe_insert("rotation_euler", frame=f+1)
    drum.keyframe_insert("scale", frame=f+1)

# ================================================================= sky + light
w = bpy.data.worlds.new("W"); sc.world = w; w.use_nodes = True
nt = w.node_tree
for n in list(nt.nodes): nt.nodes.remove(n)
wo = nt.nodes.new('ShaderNodeOutputWorld'); wo.is_active_output = True
bg = nt.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = 1.05
sk = nt.nodes.new('ShaderNodeTexSky'); sk.sky_type='MULTIPLE_SCATTERING'; sk.sun_disc=False
sk.sun_elevation=SUN_EL; sk.sun_rotation=AZ; sk.aerosol_density=1.5; sk.altitude=90.0
try: sk.ground_albedo = 0.20
except Exception: pass
nt.links.new(sk.outputs['Color'], bg.inputs['Color'])
nt.links.new(bg.outputs['Background'], wo.inputs['Surface'])

def sunlight(name, vec, energy, col, ang):
    d = bpy.data.lights.new(name, 'SUN'); d.energy = energy; d.color = col
    d.angle = math.radians(ang)
    o = bpy.data.objects.new(name, d); bpy.context.collection.objects.link(o)
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector((0,0,-1)).rotation_difference(-vec)
    return o

sunlight("key", SUN, 640, (1.0, 0.90, 0.78), 0.55)
RAZ, REL = AZ + math.radians(158.0), math.radians(11.0)
RIM = Vector((math.cos(RAZ)*math.cos(REL), math.sin(RAZ)*math.cos(REL), math.sin(REL))).normalized()
sunlight("rim", RIM, 210, (0.72, 0.82, 1.0), 3.0)

# ================================================================= muzzle FX
def volume_mat(name, col, dens):
    m = bpy.data.materials.new(name); m.use_nodes = True
    t = m.node_tree
    for n in list(t.nodes): t.nodes.remove(n)
    out = t.nodes.new('ShaderNodeOutputMaterial'); out.is_active_output = True
    pv = t.nodes.new('ShaderNodeVolumePrincipled')
    pv.inputs['Color'].default_value = (*col, 1)
    pv.inputs['Density'].default_value = dens
    pv.inputs['Anisotropy'].default_value = 0.32
    nz = t.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 2.6
    nz.inputs['Detail'].default_value = 6.0
    ramp = t.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = 0.36
    ramp.color_ramp.elements[1].position = 0.72
    t.links.new(nz.outputs['Fac'], ramp.inputs['Fac'])
    mul = t.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'
    t.links.new(ramp.outputs['Color'], mul.inputs[0])
    mul.inputs[1].default_value = dens
    t.links.new(mul.outputs['Value'], pv.inputs['Density'])
    t.links.new(pv.outputs['Volume'], out.inputs['Volume'])
    return m, mul.inputs[1]

def puff(name, loc, birth, life, r0, r1, dens, col=(0.34,0.29,0.23), drift=(0,0,0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=loc)
    o = bpy.context.object; o.name = name
    m, dsock = volume_mat(name+"_v", col, dens); o.data.materials.append(m)
    o.hide_render = False
    for f in range(NF):
        k = f - birth
        if k < 0:
            s = 0.001; dv = 0.0
        else:
            u = min(1.0, k / float(life))
            s = r0 + (r1 - r0) * (1 - (1-u)**2)
            dv = dens * (1 - u) ** 1.7 * min(1.0, k / 2.0)
        o.scale = (s, s, s*0.82)
        o.location = (loc[0]+drift[0]*max(0,k), loc[1]+drift[1]*max(0,k), loc[2]+drift[2]*max(0,k))
        dsock.default_value = dv
        o.keyframe_insert("scale", frame=f+1)
        o.keyframe_insert("location", frame=f+1)
        dsock.keyframe_insert("default_value", frame=f+1)
    return o

# world position of the muzzle at the fire frame
sc.frame_set(FIRE+1)
bpy.context.view_layer.update()
MUZ = gun.matrix_world @ MUZ_LOCAL
# the bore is 13 deg off the gun object's -Y: the turret is authored pre-traversed
BORE_LOCAL = Matrix.Rotation(sol["psi0"], 3, 'Z') @ Vector((0, -1, 0))
BORE = (gun.matrix_world.to_3x3() @ BORE_LOCAL).normalized()
print("[anim] muzzle world %s bore %s" % (tuple(round(c,2) for c in MUZ),
                                          tuple(round(c,2) for c in BORE)))

# flash: an EMISSIVE VOLUME, not an emissive cone.  A solid emitter reads as a
# white cardboard shape; propellant burning outside the bore is a soft, ragged,
# self-shadowing cloud with a small incandescent core.
def flash_volume(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    t = m.node_tree
    for n in list(t.nodes): t.nodes.remove(n)
    out = t.nodes.new('ShaderNodeOutputMaterial'); out.is_active_output = True
    pv = t.nodes.new('ShaderNodeVolumePrincipled')
    pv.inputs['Color'].default_value = (0.32, 0.24, 0.17, 1)
    pv.inputs['Emission Color'].default_value = (1.0, 0.58, 0.22, 1)
    pv.inputs['Density'].default_value = 0.0
    tc = t.nodes.new('ShaderNodeTexCoord')
    sub = t.nodes.new('ShaderNodeVectorMath'); sub.operation = 'SUBTRACT'
    sub.inputs[1].default_value = (0.5, 0.5, 0.5)
    t.links.new(tc.outputs['Generated'], sub.inputs[0])
    ln = t.nodes.new('ShaderNodeVectorMath'); ln.operation = 'LENGTH'
    t.links.new(sub.outputs['Vector'], ln.inputs[0])
    x2 = t.nodes.new('ShaderNodeMath'); x2.operation = 'MULTIPLY'; x2.inputs[1].default_value = 2.0
    t.links.new(ln.outputs['Value'], x2.inputs[0])
    ramp = t.nodes.new('ShaderNodeValToRGB')                 # 1 at the core, 0 at the rim
    ramp.color_ramp.elements[0].position = 0.04
    ramp.color_ramp.elements[0].color = (1, 1, 1, 1)
    ramp.color_ramp.elements[1].position = 0.88
    ramp.color_ramp.elements[1].color = (0, 0, 0, 1)
    t.links.new(x2.outputs['Value'], ramp.inputs['Fac'])
    nz = t.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 9.0
    nz.inputs['Detail'].default_value = 8.0
    t.links.new(tc.outputs['Generated'], nz.inputs['Vector'])
    nr = t.nodes.new('ShaderNodeMapRange')                   # keep the noise positive
    nr.inputs['From Min'].default_value = 0.25; nr.inputs['From Max'].default_value = 0.75
    nr.inputs['To Min'].default_value = -0.45; nr.inputs['To Max'].default_value = 1.0
    t.links.new(nz.outputs['Fac'], nr.inputs['Value'])
    shape = t.nodes.new('ShaderNodeMath'); shape.operation = 'MULTIPLY'
    t.links.new(ramp.outputs['Color'], shape.inputs[0])
    t.links.new(nr.outputs['Result'], shape.inputs[1])
    emul = t.nodes.new('ShaderNodeMath'); emul.operation = 'MULTIPLY'
    t.links.new(shape.outputs['Value'], emul.inputs[0]); emul.inputs[1].default_value = 0.0
    dmul = t.nodes.new('ShaderNodeMath'); dmul.operation = 'MULTIPLY'
    t.links.new(shape.outputs['Value'], dmul.inputs[0]); dmul.inputs[1].default_value = 0.0
    t.links.new(emul.outputs['Value'], pv.inputs['Emission Strength'])
    t.links.new(dmul.outputs['Value'], pv.inputs['Density'])
    t.links.new(pv.outputs['Volume'], out.inputs['Volume'])
    return m, emul.inputs[1], dmul.inputs[1]

fm, emit_s, dens_s = flash_volume("flashvol")
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1.0, location=MUZ + BORE*0.70)
flash = bpy.context.object; flash.name = "MuzzleFlash"
flash.rotation_mode = 'QUATERNION'
flash.rotation_quaternion = Vector((0,0,1)).rotation_difference(BORE)
flash.data.materials.append(fm)

cm = bpy.data.materials.new("core"); cm.use_nodes = True
ct = cm.node_tree
for n in list(ct.nodes): ct.nodes.remove(n)
co = ct.nodes.new('ShaderNodeOutputMaterial'); co.is_active_output = True
cem = ct.nodes.new('ShaderNodeEmission'); cem.inputs['Color'].default_value = (1.0, 0.82, 0.56, 1)
cem.inputs['Strength'].default_value = 0.0
ct.links.new(cem.outputs['Emission'], co.inputs['Surface'])
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0, location=MUZ + BORE*0.22)
core = bpy.context.object; core.name = "MuzzleCore"; core.data.materials.append(cm)

fl = bpy.data.lights.new("flashlight", 'POINT'); fl.shadow_soft_size = 0.6
flo = bpy.data.objects.new("flashlight", fl); bpy.context.collection.objects.link(flo)
flo.location = MUZ + BORE*0.8
fl.color = (1.0, 0.70, 0.38)

FLASH = [1.0, 0.72, 0.32, 0.10, 0.02]     # per-frame intensity envelope
for f in range(NF):
    k = f - FIRE
    a = FLASH[k] if 0 <= k < len(FLASH) else 0.0
    emit_s.default_value = 1100.0 * a
    dens_s.default_value = 3.0 * a
    emit_s.keyframe_insert("default_value", frame=f+1)
    dens_s.keyframe_insert("default_value", frame=f+1)
    cem.inputs['Strength'].default_value = 5200.0 * a
    cem.inputs['Strength'].keyframe_insert("default_value", frame=f+1)
    fl.energy = 380000.0 * a
    fl.keyframe_insert("energy", frame=f+1)
    gs = 0.55 + 1.05*(a ** 0.5)
    flash.scale = (gs*0.40, gs*0.40, gs*0.95) if a > 0 else (0.001,)*3
    core.scale = (0.22*a,)*3 if a > 0 else (0.001,)*3
    flash.keyframe_insert("scale", frame=f+1)
    core.keyframe_insert("scale", frame=f+1)

if DUST:
    puff("blast", tuple(MUZ + BORE*1.7), FIRE, 26, 0.5, 3.6, 5.5,
         col=(0.30,0.26,0.21), drift=(BORE.x*0.045, BORE.y*0.045, 0.012))
    puff("blastgnd", (MUZ.x + BORE.x*2.2, MUZ.y + BORE.y*2.2,
                      terrain(MUZ.x + BORE.x*2.2, MUZ.y + BORE.y*2.2)+0.35),
         FIRE+1, 30, 0.6, 4.4, 3.4, col=(0.36,0.31,0.24), drift=(0.0,0.0,0.010))
    # track dust: puffs born in world space as each track line passes
    n = 0
    for side in (-1.53, 1.53):
        for k in range(7):
            yy = 5.2 - k*1.55
            bf = NF-1
            for f in range(NF):
                if sol["y"][f] + 2.4 <= yy: bf = f; break
            n += 1
            puff("dust%02d" % n, (side*1.06, yy, terrain(side, yy)+0.35), bf, 34,
                 0.35, 2.5, 2.2, col=(0.33,0.28,0.22), drift=(side*0.006, 0.010, 0.009))
    print("[anim] dust volumes: %d" % (n+2))

# ================================================================= camera
CAZ = AZ - math.radians(90.0)
CDIR = Vector((math.cos(CAZ), math.sin(CAZ), 0.0)).normalized()
PIVOT = Vector((0.0, 0.2, 1.25))
# camera elevation matters more than it looks: from below ~6 deg the vehicle's
# flanks catch the sky specular and the camouflage washes out to pale grey.
CEL = math.radians(float(os.environ.get("CEL", "9")))
D0, D1 = 27.5, 25.0                                  # slow push-in
CVIEW = Vector((CDIR.x*math.cos(CEL), CDIR.y*math.cos(CEL), math.sin(CEL))).normalized()
cd = bpy.data.cameras.new("C"); cd.lens = float(os.environ.get("LENS", "58"))
cd.sensor_width = 36.0
cd.dof.use_dof = True; cd.dof.aperture_fstop = 4.5
cam = bpy.data.objects.new("C", cd); bpy.context.collection.objects.link(cam)
sc.camera = cam

random.seed(11)
SHAKE = [(random.gauss(0,1), random.gauss(0,1)) for _ in range(NF+4)]
aim = Vector((hull.matrix_world.translation.x, sol["y"][0], sol["z"][0]+0.85))
for f in range(NF):
    tgt = Vector((hull.matrix_world.translation.x, sol["y"][f], sol["z"][f]+0.85))
    # ease the framing over toward the muzzle as the gun comes on target, so the
    # blast is not half out of frame
    lead = max(0.0, min(1.0, (f - (FIRE-20)) / 20.0)) * 0.46
    tgt = tgt.lerp(Vector((MUZ.x, MUZ.y, MUZ.z)), lead)
    aim = aim.lerp(tgt, 0.16)                        # lagging pan, like a tripod op
    eye = PIVOT + CVIEW * (D0 + (D1 - D0) * (f / max(1, NF - 1)))
    k = f - FIRE
    if 0 <= k < 16:                                  # blast shockwave on the rig
        amp = 0.055 * math.exp(-0.30*k)
        eye.x += SHAKE[f][0]*amp; eye.z += SHAKE[f][1]*amp
    z = (eye - aim).normalized()
    x = Vector((0,0,1)).cross(z).normalized(); y = z.cross(x)
    cam.matrix_world = Matrix.Translation(eye) @ Matrix((x, y, z)).transposed().to_4x4()
    cam.keyframe_insert("location", frame=f+1)
    cam.keyframe_insert("rotation_euler", frame=f+1)
    cd.dof.focus_distance = (eye - tgt).length
    cd.dof.keyframe_insert("focus_distance", frame=f+1)

# ================================================================= render
sc.cycles.samples = SAMP
sc.cycles.use_adaptive_sampling = True; sc.cycles.adaptive_threshold = float(os.environ.get("ATHR","0.035"))
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 8; sc.cycles.volume_bounces = 1
sc.cycles.volume_step_rate = 1.6; sc.cycles.volume_max_steps = 256
sc.render.use_motion_blur = True; sc.render.motion_blur_shutter = 0.5
sc.render.resolution_x = RES; sc.render.resolution_y = int(RES*9/16)
sc.render.image_settings.file_format = 'PNG'
sc.view_settings.view_transform = 'AgX'
sc.view_settings.exposure = float(os.environ.get("EXPO", "-5.85"))
try: sc.view_settings.look = 'AgX - Medium High Contrast'
except Exception: pass
sc.frame_start = 1; sc.frame_end = NF

print("[anim] linearised %d f-curves" % mbtanim.linearize())

if os.environ.get("NORENDER"):
    bpy.ops.wm.save_as_mainfile(filepath=OUT+"anim_%s.blend" % NAME, copy=True)
    print("NORENDER: saved", OUT+"anim_%s.blend" % NAME)
elif STILL:
    f = int(STILL)
    sc.frame_set(f)
    sc.render.filepath = OUT + "still_%s_%03d.png" % (NAME, f)
    bpy.ops.render.render(write_still=True)
    print("WROTE", sc.render.filepath)
else:
    sc.render.filepath = OUT + "frames_%s/f" % NAME
    bpy.ops.render.render(animation=True)
    print("WROTE", sc.render.filepath, "frames 1..%d" % NF)
