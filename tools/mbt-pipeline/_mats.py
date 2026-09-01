import bpy,math,os
cos,sin,pi=math.cos,math.sin,math.pi
WEAR=float(os.environ.get('WEAR','0.17'))
DUSTY=float(os.environ.get('DUSTY','0.55'))

# ---------------------------------------------------------------- materials
def nodes(name):
    m=bpy.data.materials.new(name); m.use_nodes=True
    nt=m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    out=nt.nodes.new('ShaderNodeOutputMaterial'); out.location=(900,0)
    out.is_active_output=True
    bsdf=nt.nodes.new('ShaderNodeBsdfPrincipled'); bsdf.location=(600,0)
    nt.links.new(bsdf.outputs['BSDF'],out.inputs['Surface'])
    return m,nt,bsdf

def objcoord(nt,scale=1.0,loc=(-1400,0)):
    tc=nt.nodes.new('ShaderNodeNewGeometry'); tc.location=loc
    mp=nt.nodes.new('ShaderNodeMapping'); mp.location=(loc[0]+180,loc[1])
    mp.inputs['Scale'].default_value=(scale,scale,scale)
    nt.links.new(tc.outputs['Position'],mp.inputs['Vector'])
    return tc,mp

def noise(nt,vec,scale,detail=4.0,rough=0.55,loc=(-1000,0)):
    n=nt.nodes.new('ShaderNodeTexNoise'); n.location=loc
    n.inputs['Scale'].default_value=scale
    n.inputs['Detail'].default_value=detail
    n.inputs['Roughness'].default_value=rough
    nt.links.new(vec,n.inputs['Vector'])
    return n

BEVEL_R=float(os.environ.get('BEVEL_R','0.009'))
def bump(nt,bsdf,vec,scale,strength,loc=(200,-500)):
    """rounded edges (Bevel node, zero triangles) -> coarse bump -> micro bump"""
    base=None
    try:
        bev=nt.nodes.new('ShaderNodeBevel'); bev.location=(loc[0]-540,loc[1]+170)
        bev.inputs['Radius'].default_value=BEVEL_R
        try: bev.samples=8
        except Exception: pass
        base=bev.outputs['Normal']
    except Exception as e:
        print("  (Bevel node unavailable:",e,")")
    nz=noise(nt,vec,scale,detail=6.0,loc=(loc[0]-260,loc[1]))
    bp=nt.nodes.new('ShaderNodeBump'); bp.location=loc
    bp.inputs['Strength'].default_value=strength
    nt.links.new(nz.outputs['Fac'],bp.inputs['Height'])
    if base is not None: nt.links.new(base,bp.inputs['Normal'])
    nz2=noise(nt,vec,scale*6.0,detail=3.0,loc=(loc[0]-260,loc[1]-210))
    bp2=nt.nodes.new('ShaderNodeBump'); bp2.location=(loc[0]+210,loc[1])
    bp2.inputs['Strength'].default_value=strength*0.5
    nt.links.new(nz2.outputs['Fac'],bp2.inputs['Height'])
    nt.links.new(bp.outputs['Normal'],bp2.inputs['Normal'])
    nt.links.new(bp2.outputs['Normal'],bsdf.inputs['Normal'])
    return bp2

def _geo_pos(nt,loc):
    g=nt.nodes.new('ShaderNodeNewGeometry'); g.location=loc
    return g

def streak_mask(nt,loc=(-1600,-1500)):
    """gravity-driven grime: noise stretched vertically, only on non-horizontal faces,
    strongest below the mid-hull. This is the single biggest 'it has been somewhere' cue."""
    g=_geo_pos(nt,loc)
    mp=nt.nodes.new('ShaderNodeMapping'); mp.location=(loc[0]+180,loc[1])
    mp.inputs['Scale'].default_value=(9.0,9.0,0.42)      # squash Z -> vertical runs
    nt.links.new(g.outputs['Position'],mp.inputs['Vector'])
    nz=nt.nodes.new('ShaderNodeTexNoise'); nz.location=(loc[0]+360,loc[1])
    nz.inputs['Scale'].default_value=2.2; nz.inputs['Detail'].default_value=7.0
    nz.inputs['Roughness'].default_value=0.72
    nt.links.new(mp.outputs['Vector'],nz.inputs['Vector'])
    sh=nt.nodes.new('ShaderNodeMapRange'); sh.location=(loc[0]+540,loc[1])
    sh.inputs['From Min'].default_value=0.52; sh.inputs['From Max'].default_value=0.78
    nt.links.new(nz.outputs['Fac'],sh.inputs['Value'])
    # vertical faces only
    sep=nt.nodes.new('ShaderNodeSeparateXYZ'); sep.location=(loc[0]+360,loc[1]-220)
    nt.links.new(g.outputs['Normal'],sep.inputs['Vector'])
    ab=nt.nodes.new('ShaderNodeMath'); ab.location=(loc[0]+520,loc[1]-220); ab.operation='ABSOLUTE'
    nt.links.new(sep.outputs['Z'],ab.inputs[0])
    vert=nt.nodes.new('ShaderNodeMath'); vert.location=(loc[0]+680,loc[1]-220)
    vert.operation='SUBTRACT'; vert.inputs[0].default_value=1.0
    nt.links.new(ab.outputs['Value'],vert.inputs[1])
    m1=nt.nodes.new('ShaderNodeMath'); m1.location=(loc[0]+860,loc[1]-100); m1.operation='MULTIPLY'
    nt.links.new(sh.outputs['Result'],m1.inputs[0])
    nt.links.new(vert.outputs['Value'],m1.inputs[1])
    return m1.outputs['Value']

def side_bias(nt,loc=(-1600,-1900)):
    """one flank always gets dirtier than the other - symmetry is the tell"""
    g=_geo_pos(nt,loc)
    sep=nt.nodes.new('ShaderNodeSeparateXYZ'); sep.location=(loc[0]+180,loc[1])
    nt.links.new(g.outputs['Position'],sep.inputs['Vector'])
    mr=nt.nodes.new('ShaderNodeMapRange'); mr.location=(loc[0]+360,loc[1])
    mr.inputs['From Min'].default_value=-2.0; mr.inputs['From Max'].default_value=2.0
    mr.inputs['To Min'].default_value=1.25;   mr.inputs['To Max'].default_value=0.62
    nt.links.new(sep.outputs['X'],mr.inputs['Value'])
    lo=nt.nodes.new('ShaderNodeTexNoise'); lo.location=(loc[0]+360,loc[1]-200)
    lo.inputs['Scale'].default_value=0.22; lo.inputs['Detail'].default_value=3.0
    nt.links.new(g.outputs['Position'],lo.inputs['Vector'])
    lm=nt.nodes.new('ShaderNodeMapRange'); lm.location=(loc[0]+540,loc[1]-200)
    lm.inputs['To Min'].default_value=0.55; lm.inputs['To Max'].default_value=1.45
    nt.links.new(lo.outputs['Fac'],lm.inputs['Value'])
    mul=nt.nodes.new('ShaderNodeMath'); mul.location=(loc[0]+720,loc[1]); mul.operation='MULTIPLY'
    nt.links.new(mr.outputs['Result'],mul.inputs[0])
    nt.links.new(lm.outputs['Result'],mul.inputs[1])
    return mul.outputs['Value']

def dust_and_wear(nt,bsdf,vec,basecol_out,rough_base,dusty=0.55,wear=0.22):
    """mix accumulated dust by height + expose worn metal on convex edges"""
    # dust mask: low + upward surfaces, broken up by noise
    tc=nt.nodes.new('ShaderNodeNewGeometry'); tc.location=(-1400,-700)
    sep=nt.nodes.new('ShaderNodeSeparateXYZ'); sep.location=(-1200,-700)
    nt.links.new(tc.outputs['Position'],sep.inputs['Vector'])
    mr=nt.nodes.new('ShaderNodeMapRange'); mr.location=(-1000,-700)
    mr.inputs['From Min'].default_value=-0.2; mr.inputs['From Max'].default_value=2.4
    mr.inputs['To Min'].default_value=1.0;  mr.inputs['To Max'].default_value=0.05
    nt.links.new(sep.outputs['Z'],mr.inputs['Value'])
    nzd=noise(nt,vec,7.0,detail=5.0,loc=(-1000,-900))
    m1=nt.nodes.new('ShaderNodeMath'); m1.location=(-800,-780); m1.operation='MULTIPLY'
    nt.links.new(mr.outputs['Result'],m1.inputs[0])
    nt.links.new(nzd.outputs['Fac'],m1.inputs[1])
    # dust settles on upward-facing surfaces
    gn2=nt.nodes.new('ShaderNodeNewGeometry'); gn2.location=(-1200,-1020)
    sepn=nt.nodes.new('ShaderNodeSeparateXYZ'); sepn.location=(-1030,-1020)
    nt.links.new(gn2.outputs['Normal'],sepn.inputs['Vector'])
    upc=nt.nodes.new('ShaderNodeMapRange'); upc.location=(-860,-1020)
    upc.inputs['From Min'].default_value=-0.35; upc.inputs['From Max'].default_value=0.85
    upc.inputs['To Min'].default_value=0.22; upc.inputs['To Max'].default_value=1.0
    nt.links.new(sepn.outputs['Z'],upc.inputs['Value'])
    mu=nt.nodes.new('ShaderNodeMath'); mu.location=(-700,-900); mu.operation='MULTIPLY'
    nt.links.new(m1.outputs['Value'],mu.inputs[0])
    nt.links.new(upc.outputs['Result'],mu.inputs[1])
    asym=nt.nodes.new('ShaderNodeMath'); asym.location=(-700,-980); asym.operation='MULTIPLY'
    nt.links.new(mu.outputs['Value'],asym.inputs[0])
    nt.links.new(side_bias(nt),asym.inputs[1])
    mu=asym
    m2=nt.nodes.new('ShaderNodeMath'); m2.location=(-620,-780); m2.operation='MULTIPLY'
    m2.inputs[1].default_value=dusty*1.15
    nt.links.new(mu.outputs['Value'],m2.inputs[0])
    dm=nt.nodes.new('ShaderNodeClamp'); dm.location=(-450,-780)
    nt.links.new(m2.outputs['Value'],dm.inputs['Value'])
    dmix=nt.nodes.new('ShaderNodeMixRGB'); dmix.location=(-250,-300)
    dmix.blend_type='MIX'; dmix.inputs['Color2'].default_value=(0.125,0.100,0.068,1)
    nt.links.new(basecol_out,dmix.inputs['Color1'])
    nt.links.new(dm.outputs['Result'],dmix.inputs['Fac'])
    # edge wear from geometry pointiness
    geo=nt.nodes.new('ShaderNodeNewGeometry'); geo.location=(-1000,-1150)
    pr=nt.nodes.new('ShaderNodeMapRange'); pr.location=(-800,-1150)
    pr.inputs['From Min'].default_value=0.52; pr.inputs['From Max'].default_value=0.62
    nt.links.new(geo.outputs['Pointiness'],pr.inputs['Value'])
    nzw=noise(nt,vec,22.0,detail=4.0,loc=(-800,-1330))
    wm=nt.nodes.new('ShaderNodeMath'); wm.location=(-600,-1200); wm.operation='MULTIPLY'
    nt.links.new(pr.outputs['Result'],wm.inputs[0])
    nt.links.new(nzw.outputs['Fac'],wm.inputs[1])
    wm2=nt.nodes.new('ShaderNodeMath'); wm2.location=(-430,-1200); wm2.operation='MULTIPLY'
    wm2.inputs[1].default_value=wear*3.0
    nt.links.new(wm.outputs['Value'],wm2.inputs[0])
    wc=nt.nodes.new('ShaderNodeClamp'); wc.location=(-260,-1200)
    nt.links.new(wm2.outputs['Value'],wc.inputs['Value'])
    # hard-edged chipping: paint -> red-oxide primer -> bare metal, with grime on top
    chip=nt.nodes.new('ShaderNodeValToRGB'); chip.location=(-260,-1500)
    chip.color_ramp.interpolation='CONSTANT'
    ce=chip.color_ramp.elements
    ce[0].position=0.0;  ce[0].color=(0,0,0,1)              # intact paint
    ce[1].position=0.55; ce[1].color=(0.5,0.5,0.5,1)        # primer showing
    ce3=ce.new(0.80);    ce3.color=(1,1,1,1)                # bare metal
    nt.links.new(wc.outputs['Result'],chip.inputs['Fac'])
    prim=nt.nodes.new('ShaderNodeMixRGB'); prim.location=(-60,-380)
    prim.inputs['Color2'].default_value=(0.052,0.020,0.011,1)   # red-oxide primer
    nt.links.new(dmix.outputs['Color'],prim.inputs['Color1'])
    pf=nt.nodes.new('ShaderNodeMath'); pf.location=(-230,-380); pf.operation='MULTIPLY'
    pf.inputs[1].default_value=1.8
    nt.links.new(chip.outputs['Color'],pf.inputs[0])
    pc=nt.nodes.new('ShaderNodeClamp'); pc.location=(-140,-380)
    nt.links.new(pf.outputs['Value'],pc.inputs['Value'])
    nt.links.new(pc.outputs['Result'],prim.inputs['Fac'])
    wmix=nt.nodes.new('ShaderNodeMixRGB'); wmix.location=(-60,-300)
    wmix.inputs['Color2'].default_value=(0.075,0.070,0.064,1)   # bare metal
    nt.links.new(prim.outputs['Color'],wmix.inputs['Color1'])
    mf=nt.nodes.new('ShaderNodeMath'); mf.location=(-230,-300); mf.operation='SUBTRACT'
    mf.inputs[0].default_value=0.0
    nt.links.new(chip.outputs['Color'],mf.inputs[1])
    mf2=nt.nodes.new('ShaderNodeMath'); mf2.location=(-160,-300); mf2.operation='MULTIPLY'
    mf2.inputs[1].default_value=-1.0
    nt.links.new(mf.outputs['Value'],mf2.inputs[0])
    mth=nt.nodes.new('ShaderNodeMath'); mth.location=(-100,-300); mth.operation='GREATER_THAN'
    mth.inputs[1].default_value=0.9
    nt.links.new(chip.outputs['Color'],mth.inputs[0])
    nt.links.new(mth.outputs['Value'],wmix.inputs['Fac'])
    # gravity streaks darken everything they run over
    stk=streak_mask(nt)
    sm=nt.nodes.new('ShaderNodeMath'); sm.location=(-60,-1200); sm.operation='MULTIPLY'
    sm.inputs[1].default_value=0.62
    nt.links.new(stk,sm.inputs[0])
    smix=nt.nodes.new('ShaderNodeMixRGB'); smix.location=(120,-300)
    smix.inputs['Color2'].default_value=(0.030,0.022,0.014,1)   # dark grime
    nt.links.new(wmix.outputs['Color'],smix.inputs['Color1'])
    nt.links.new(sm.outputs['Value'],smix.inputs['Fac'])
    nt.links.new(smix.outputs['Color'],bsdf.inputs['Base Color'])
    # roughness: dust raises it, wear lowers it
    rmix=nt.nodes.new('ShaderNodeMixRGB'); rmix.location=(200,-150)
    rmix.inputs['Color1'].default_value=(rough_base,)*3+(1,)
    rmix.inputs['Color2'].default_value=(0.94,0.94,0.94,1)
    nt.links.new(dm.outputs['Result'],rmix.inputs['Fac'])
    rmix2=nt.nodes.new('ShaderNodeMixRGB'); rmix2.location=(380,-150)
    rmix2.inputs['Color2'].default_value=(0.34,0.34,0.34,1)
    nt.links.new(rmix.outputs['Color'],rmix2.inputs['Color1'])
    nt.links.new(wc.outputs['Result'],rmix2.inputs['Fac'])
    # large-scale roughness break-up: the same paint weathers unevenly
    rv=noise(nt,vec,0.32,detail=3.0,loc=(200,-640))
    rr=nt.nodes.new('ShaderNodeMapRange'); rr.location=(380,-640)
    rr.inputs['To Min'].default_value=0.80; rr.inputs['To Max'].default_value=1.18
    nt.links.new(rv.outputs['Fac'],rr.inputs['Value'])
    rmul=nt.nodes.new('ShaderNodeMath'); rmul.location=(540,-560); rmul.operation='MULTIPLY'
    nt.links.new(rmix2.outputs['Color'],rmul.inputs[0])
    nt.links.new(rr.outputs['Result'],rmul.inputs[1])
    rcl=nt.nodes.new('ShaderNodeClamp'); rcl.location=(700,-560)
    rcl.inputs['Min'].default_value=0.04; rcl.inputs['Max'].default_value=1.0
    nt.links.new(rmul.outputs['Value'],rcl.inputs['Value'])
    nt.links.new(rcl.outputs['Result'],bsdf.inputs['Roughness'])
    # metallic peeks through where paint has worn off
    mtl=nt.nodes.new('ShaderNodeMath'); mtl.location=(380,-380); mtl.operation='MULTIPLY'
    mtl.inputs[1].default_value=0.85
    nt.links.new(wc.outputs['Result'],mtl.inputs[0])
    nt.links.new(mtl.outputs['Value'],bsdf.inputs['Metallic'])

def mat_camo(name):
    """NATO three-colour camouflage, hard-edged, with dust and edge wear"""
    m,nt,b=nodes(name)
    tc,mp=objcoord(nt,0.62)
    n=noise(nt,mp.outputs['Vector'],1.75,detail=1.8,rough=0.45)
    ramp=nt.nodes.new('ShaderNodeValToRGB'); ramp.location=(-780,0)
    ramp.color_ramp.interpolation='CONSTANT'
    e=ramp.color_ramp.elements
    e[0].position=0.0;  e[0].color=(0.0680,0.0780,0.0470,1)   # FS34094 green
    e[1].position=0.460; e[1].color=(0.0730,0.0470,0.0290,1)  # FS30051 brown
    e3=e.new(0.720);     e3.color=(0.0235,0.0240,0.0235,1)    # FS37030 black
    nt.links.new(n.outputs['Fac'],ramp.inputs['Fac'])
    # slight per-panel tonal drift so the paint isn't uniform
    drift=noise(nt,mp.outputs['Vector'],0.30,detail=2.0,loc=(-1000,300))
    hsv=nt.nodes.new('ShaderNodeHueSaturation'); hsv.location=(-520,0)
    hsv.inputs['Saturation'].default_value=0.92
    nt.links.new(ramp.outputs['Color'],hsv.inputs['Color'])
    nt.links.new(drift.outputs['Fac'],hsv.inputs['Value'])
    hsv.inputs['Value'].default_value=1.0
    dust_and_wear(nt,b,mp.outputs['Vector'],hsv.outputs['Color'],0.62,dusty=DUSTY,wear=WEAR)
    bump(nt,b,mp.outputs['Vector'],95.0,0.16)
    return m

def mat_metal(name,col,rough,metallic,rust=0.0,bumpscale=60.0,bumpstr=0.25):
    m,nt,b=nodes(name)
    tc,mp=objcoord(nt,1.0)
    base=nt.nodes.new('ShaderNodeRGB'); base.location=(-780,200)
    base.outputs[0].default_value=col+(1,)
    cur=base.outputs[0]
    if rust>0:
        nzr=noise(nt,mp.outputs['Vector'],9.0,detail=6.0,loc=(-1000,-100))
        rr=nt.nodes.new('ShaderNodeMapRange'); rr.location=(-820,-100)
        rr.inputs['From Min'].default_value=0.46; rr.inputs['From Max'].default_value=0.66
        rr.inputs['To Max'].default_value=rust
        nt.links.new(nzr.outputs['Fac'],rr.inputs['Value'])
        rmx=nt.nodes.new('ShaderNodeMixRGB'); rmx.location=(-600,100)
        rmx.inputs['Color2'].default_value=(0.075,0.030,0.014,1)
        nt.links.new(cur,rmx.inputs['Color1'])
        nt.links.new(rr.outputs['Result'],rmx.inputs['Fac'])
        cur=rmx.outputs['Color']
        mm=nt.nodes.new('ShaderNodeMath'); mm.location=(-420,-260); mm.operation='SUBTRACT'
        mm.inputs[0].default_value=metallic
        nt.links.new(rr.outputs['Result'],mm.inputs[1])
        cl=nt.nodes.new('ShaderNodeClamp'); cl.location=(-260,-260)
        nt.links.new(mm.outputs['Value'],cl.inputs['Value'])
        nt.links.new(cl.outputs['Result'],b.inputs['Metallic'])
    else:
        b.inputs['Metallic'].default_value=metallic
    nt.links.new(cur,b.inputs['Base Color'])
    rgn=noise(nt,mp.outputs['Vector'],2.6,detail=7.0,rough=0.62,loc=(-1000,-420))
    rmap=nt.nodes.new('ShaderNodeMapRange'); rmap.location=(-800,-420)
    rmap.inputs['To Min'].default_value=max(rough-0.16,0.03)
    rmap.inputs['To Max'].default_value=min(rough+0.18,1.0)
    nt.links.new(rgn.outputs['Fac'],rmap.inputs['Value'])
    nt.links.new(rmap.outputs['Result'],b.inputs['Roughness'])
    bump(nt,b,mp.outputs['Vector'],bumpscale,bumpstr)
    return m

def mat_optics():
    m,nt,b=nodes("Optics")
    b.inputs['Base Color'].default_value=(0.020,0.028,0.035,1)
    b.inputs['Roughness'].default_value=0.06
    b.inputs['Metallic'].default_value=0.0
    try: b.inputs['IOR'].default_value=1.52
    except Exception: pass
    return m

