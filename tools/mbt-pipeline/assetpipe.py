#!/usr/bin/env python3
"""
assetpipe - generic Blender/Cycles asset pipeline.

Any mesh in  ->  game-ready asset out:
  repair -> split -> normals -> pivots -> hierarchy -> UV atlas (+lightmap)
  -> bake PBR -> pack ORM -> LODs -> collision -> export -> QA report

Input : .obj .fbx .glb .gltf .stl .ply .blend | --builtin NAME | --generator mod:func
Output: GLB / FBX / OBJ + BaseColor / ORM / Normal + LODs + UCX collision + report.json
"""
import bpy, bmesh, math, os, sys, json, shutil, argparse
import numpy as np
from mathutils import Vector, Matrix

# ----------------------------------------------------------------- cli
def cli(argv):
    p=argparse.ArgumentParser(prog="assetpipe",description=__doc__,
                              formatter_class=argparse.RawDescriptionHelpFormatter)
    src=p.add_mutually_exclusive_group(required=True)
    src.add_argument("--input",help="mesh file to process")
    src.add_argument("--builtin",choices=["monkey","cube","sphere","torus","cone"],
                     help="use a Blender primitive (for testing)")
    src.add_argument("--generator",help="python module:function returning "
                     "{part:{material:[(p0,p1,p2),...]}}")
    p.add_argument("--out",default="./assetpipe_out")
    p.add_argument("--name",default="Asset")
    p.add_argument("--up",choices=["Z","Y"],default="Z",
                   help="up axis of the INPUT data (Y converts to Blender Z-up)")
    p.add_argument("--scale",type=float,default=1.0)
    p.add_argument("--split",choices=["none","loose","material"],default="none")
    p.add_argument("--weld",type=float,default=0.0006,help="0 disables")
    p.add_argument("--smooth-angle",type=float,default=33.0)
    p.add_argument("--pivot",choices=["origin","centroid","bbox","bottom"],default="centroid")
    p.add_argument("--root",default=None,help="part name to use as hierarchy root")
    p.add_argument("--uv",choices=["smart","keep","none"],default="smart")
    p.add_argument("--uv-instance",action="store_true",
                   help="repeated parts share one UV footprint (huge texel-density win)")
    p.add_argument("--uv-angle",type=float,default=66.0)
    p.add_argument("--uv-margin",type=float,default=0.0025)
    p.add_argument("--uv-pack",action="store_true",help="re-pack islands with rotation")
    p.add_argument("--lightmap-uv",action="store_true")
    p.add_argument("--bake",default="basecolor,roughness,metallic,ao,normal",
                   help="comma list, or 'none'")
    p.add_argument("--texsize",type=int,default=2048)
    p.add_argument("--lods",default="0.45,0.18",help="decimate ratios, or 'none'")
    p.add_argument("--collision",choices=["none","box","hull","parts"],default="box")
    p.add_argument("--collision-parts",type=int,default=4)
    p.add_argument("--formats",default="glb,fbx,obj")
    p.add_argument("--config",help="JSON with pivots / hierarchy / collision overrides")
    p.add_argument("--materials",help="python module:function returning {material_name: bpy material} "
                   "- lets a project supply real shaders for the bake")
    p.add_argument("--validate-render",action="store_true")
    p.add_argument("--samples",type=int,default=110)
    return p.parse_args(argv)

def log(*a): print("[assetpipe]",*a,flush=True)

# ----------------------------------------------------------------- import
def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc=bpy.context.scene
    sc.render.engine='CYCLES'; sc.cycles.device='CPU'
    sc.unit_settings.system='METRIC'; sc.unit_settings.scale_length=1.0
    return sc

def load(A):
    if A.builtin:
        fn={"monkey":bpy.ops.mesh.primitive_monkey_add,
            "cube":bpy.ops.mesh.primitive_cube_add,
            "sphere":bpy.ops.mesh.primitive_uv_sphere_add,
            "torus":bpy.ops.mesh.primitive_torus_add,
            "cone":bpy.ops.mesh.primitive_cone_add}[A.builtin]
        fn(); bpy.context.object.name=A.name
        return
    if A.generator:
        mod,fname=A.generator.split(":")
        sys.path.insert(0,os.getcwd()); sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
        m=__import__(mod)
        data=getattr(m,fname)()
        conv=(lambda p:(p[0],-p[2],p[1])) if A.up=="Y" else (lambda p:tuple(p))
        matcache={}
        for pname,bymat in data.items():
            verts=[];faces=[];fmat=[];slots=[]
            for mname,tris in bymat.items():
                if mname not in matcache:
                    matcache[mname]=bpy.data.materials.new(str(mname))
                slots.append(matcache[mname]); si=len(slots)-1
                for t in tris:
                    b=len(verts)
                    for q in t: verts.append(conv([float(x) for x in q]))
                    faces.append((b,b+1,b+2)); fmat.append(si)
            me=bpy.data.meshes.new(str(pname))
            me.from_pydata(verts,[],faces); me.update()
            for s in slots: me.materials.append(s)
            for f,si in zip(me.polygons,fmat): f.material_index=si
            ob=bpy.data.objects.new(str(pname),me)
            bpy.context.collection.objects.link(ob)
        return
    path=A.input; ext=os.path.splitext(path)[1].lower()
    ops={'.obj':lambda:bpy.ops.wm.obj_import(filepath=path,forward_axis='NEGATIVE_Z' if A.up=='Y' else 'Y',
                                            up_axis='Y' if A.up=='Y' else 'Z'),
         '.glb':lambda:bpy.ops.import_scene.gltf(filepath=path),
         '.gltf':lambda:bpy.ops.import_scene.gltf(filepath=path),
         '.fbx':lambda:bpy.ops.import_scene.fbx(filepath=path),
         '.stl':lambda:bpy.ops.wm.stl_import(filepath=path),
         '.ply':lambda:bpy.ops.wm.ply_import(filepath=path),
         '.blend':lambda:bpy.ops.wm.open_mainfile(filepath=path)}
    if ext not in ops: raise SystemExit("unsupported input: "+ext)
    ops[ext]()

def meshes(): return [o for o in bpy.data.objects if o.type=='MESH']

# ----------------------------------------------------------------- audit
def audit(objs,label):
    r={"objects":len(objs),"tris":0,"faces":0,"quads":0,"verts":0,"ngons":0,"nonmanifold":0,
       "boundary":0,"loose_verts":0,"zero_area":0,"shells":0,"uv_channels":0,
       "materials":0,"has_normals":False}
    mats=set()
    for o in objs:
        me=o.data
        bm=bmesh.new(); bm.from_mesh(me)
        r["tris"]+=sum(len(f.verts)-2 for f in bm.faces)      # triangle-equivalent
        r["faces"]+=len(bm.faces)
        r["quads"]+=sum(1 for f in bm.faces if len(f.verts)==4)
        r["ngons"]+=sum(1 for f in bm.faces if len(f.verts)>4)
        r["verts"]+=len(bm.verts)
        r["nonmanifold"]+=sum(1 for e in bm.edges if len(e.link_faces) not in (2,))
        r["boundary"]+=sum(1 for e in bm.edges if len(e.link_faces)==1)
        r["loose_verts"]+=sum(1 for v in bm.verts if not v.link_edges)
        r["zero_area"]+=sum(1 for f in bm.faces if f.calc_area()<1e-9)
        rem=set(bm.verts); n=0
        while rem:
            v=rem.pop(); st=[v]; n+=1
            while st:
                c=st.pop()
                for e in c.link_edges:
                    w=e.other_vert(c)
                    if w in rem: rem.discard(w); st.append(w)
        r["shells"]+=n
        bm.free()
        r["uv_channels"]=max(r["uv_channels"],len(me.uv_layers))
        for m in me.materials:
            if m: mats.add(m.name)
    r["materials"]=len(mats)
    log("AUDIT %-4s obj=%d tris=%d (faces=%d quads=%d ngons=%d) verts=%d shells=%d "
        "nonmanifold=%d boundary=%d uv=%d mats=%d"%(label,r["objects"],r["tris"],r["faces"],
        r["quads"],r["ngons"],r["verts"],r["shells"],r["nonmanifold"],r["boundary"],
        r["uv_channels"],r["materials"]))
    return r

# ----------------------------------------------------------------- geometry prep
def normalize(A,objs):
    if A.scale!=1.0:
        for o in objs: o.scale=(A.scale,)*3
        select(objs); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for o in objs:
        select([o]); bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)

def select(objs):
    for o in bpy.data.objects: o.select_set(False)
    for o in objs:
        o.select_set(True)
    if objs: bpy.context.view_layer.objects.active=objs[0]

def split(A):
    if A.split=="none": return meshes()
    t={'loose':'LOOSE','material':'MATERIAL'}[A.split]
    for o in list(meshes()):
        select([o])
        try:
            bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.separate(type=t); bpy.ops.object.mode_set(mode='OBJECT')
        except Exception as e:
            try: bpy.ops.object.mode_set(mode='OBJECT')
            except Exception: pass
    return meshes()

def cleanup(A,objs):
    ang=math.radians(A.smooth_angle)
    for o in objs:
        me=o.data
        bm=bmesh.new(); bm.from_mesh(me)
        bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>3])
        if A.weld>0: bmesh.ops.remove_doubles(bm,verts=bm.verts,dist=A.weld)
        bmesh.ops.delete(bm,geom=[v for v in bm.verts if not v.link_edges],context='VERTS')
        bmesh.ops.recalc_face_normals(bm,faces=bm.faces)
        for f in bm.faces: f.smooth=True
        for e in bm.edges:
            if len(e.link_faces)==2:
                try: e.smooth = e.calc_face_angle() < ang
                except Exception: e.smooth=False
            else: e.smooth=False
        bm.normal_update(); bm.to_mesh(me); bm.free()

def pivots(A,objs,cfg):
    over={k:Vector(v) for k,v in cfg.get("pivots",{}).items()}
    for o in objs:
        if o.name in over: p=over[o.name]
        elif A.pivot=="origin": p=Vector((0,0,0))
        else:
            vs=o.data.vertices
            if not vs: continue
            if A.pivot=="centroid":
                p=Vector((0,0,0))
                for v in vs: p+=v.co
                p/=len(vs)
            else:
                lo=Vector((1e9,)*3); hi=Vector((-1e9,)*3)
                for v in vs:
                    for i in range(3): lo[i]=min(lo[i],v.co[i]); hi[i]=max(hi[i],v.co[i])
                p=(lo+hi)*0.5
                if A.pivot=="bottom": p.z=lo.z
        for v in o.data.vertices: v.co-=p
        o.location=o.location+p

def hierarchy(A,objs,cfg):
    hier=cfg.get("hierarchy",{})
    if not hier and not A.root: return None
    bpy.context.view_layer.update()          # matrix_world must be current
    byname={o.name:o for o in objs}
    root=byname.get(A.root) or byname.get(hier.get("*")) or max(objs,key=lambda o:len(o.data.polygons))
    for o in objs:
        if o is root: continue
        pname=hier.get(o.name,hier.get("*",root.name))
        par=byname.get(pname,root)
        if par is o: par=root
        keep=o.matrix_world.copy()
        o.parent=par
        bpy.context.view_layer.update()
        o.matrix_parent_inverse=par.matrix_world.inverted()
        o.matrix_world=keep
    log("hierarchy root:",root.name)
    return root

# ----------------------------------------------------------------- uv
def topo_sig(ob):
    """identical procedural parts produce identical signatures"""
    vs=ob.data.vertices
    if not vs: return ("empty",ob.name)
    n=len(vs)
    c=[sum(v.co[i] for v in vs)/n for i in range(3)]
    pts=tuple(sorted(tuple(round(v.co[i]-c[i],4) for i in range(3)) for v in vs))
    return (n,len(ob.data.polygons),pts)

def uv_groups(objs):
    g={}
    for o in objs: g.setdefault(topo_sig(o),[]).append(o)
    return list(g.values())

def copy_uv0(src,dst):
    a=src.data.uv_layers[0].data; b=dst.data.uv_layers[0].data
    if len(a)!=len(b): return False
    for i in range(len(a)): b[i].uv=a[i].uv
    return True

def unwrap(A,objs):
    if A.uv=="none": return False
    if A.uv=="keep" and all(o.data.uv_layers for o in objs): 
        log("keeping existing UVs"); return True
    for o in objs:
        if not o.data.uv_layers: o.data.uv_layers.new(name="UVMap")
    if A.uv_instance:
        groups=uv_groups(objs)
        reps=[g[0] for g in groups]
        shared=sum(len(g)-1 for g in groups)
        log("UV instancing: %d objects -> %d unique footprints (%d share UVs)"%(
            len(objs),len(reps),shared))
        for g in groups:
            if len(g)>1: log("   x%-3d %s"%(len(g),", ".join(o.name for o in g[:4])+
                             (" ..." if len(g)>4 else "")))
    else:
        groups=[[o] for o in objs]; reps=objs
    select(reps)
    try:
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(A.uv_angle),
                                 island_margin=A.uv_margin)
        if A.uv_pack:
            try: bpy.ops.uv.pack_islands(rotate=True,margin=A.uv_margin)
            except TypeError: bpy.ops.uv.pack_islands(margin=A.uv_margin)
        bpy.ops.object.mode_set(mode='OBJECT')
        log("UV atlas: smart_project over %d unique objects (angle %.0f, margin %.4f)"%(
            len(reps),A.uv_angle,A.uv_margin))
    except Exception as e:
        try: bpy.ops.object.mode_set(mode='OBJECT')
        except Exception: pass
        log("smart_project failed:",e); return objs
    bad=0
    for g in groups:
        for o in g[1:]:
            if not copy_uv0(g[0],o): bad+=1
    if bad: log("  WARNING: %d instances had mismatched loop counts (kept own UVs)"%bad)
    return reps

def lightmap(A,objs):
    if not A.lightmap_uv: return
    for o in objs:
        while len(o.data.uv_layers)<2: o.data.uv_layers.new(name="Lightmap")
    select(objs)
    try:
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        for o in objs: o.data.uv_layers.active_index=1
        bpy.ops.uv.lightmap_pack(PREF_MARGIN_DIV=0.3)
        bpy.ops.object.mode_set(mode='OBJECT')
        log("lightmap UV channel added")
    except Exception as e:
        log("lightmap_pack failed:",e)
        try: bpy.ops.object.mode_set(mode='OBJECT')
        except Exception: pass
    for o in objs: o.data.uv_layers.active_index=0

# ----------------------------------------------------------------- bake
CH={"basecolor":("Base Color",False),"roughness":("Roughness",True),
    "metallic":("Metallic",True),"ao":(None,True),"normal":(None,True)}

def apply_material_library(A,objs):
    if not A.materials: return 0
    mod,fname=A.materials.split(":")
    sys.path.insert(0,os.getcwd()); sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
    lib=getattr(__import__(mod),fname)()
    hit=0
    for o in objs:
        for sl in o.material_slots:
            if sl.material and sl.material.name in lib:
                sl.material=lib[sl.material.name]; hit+=1
    log("material library: %s -> %d slots remapped (%d shaders)"%(A.materials,hit,len(lib)))
    return hit

def ensure_materials(objs):
    d=None
    for o in objs:
        if not any(s.material for s in o.material_slots):
            if d is None:
                d=bpy.data.materials.new("default"); d.use_nodes=True
            o.data.materials.clear(); o.data.materials.append(d)
    return {s.material for o in objs for s in o.material_slots if s.material}

def principled(mat):
    if not mat.node_tree: return None
    for n in mat.node_tree.nodes:
        if n.type=='BSDF_PRINCIPLED': return n
    return None

def bake_all(A,objs,sc,bake_objs=None):
    chans=[c.strip() for c in A.bake.split(",") if c.strip() and c.strip()!="none"]
    if not chans: return {},None
    bake_objs=bake_objs or objs
    mats=ensure_materials(objs)
    noprinc=[m.name for m in mats if principled(m) is None]
    if noprinc: log("materials without Principled BSDF (limited bake):",noprinc)
    imgs={}
    for c in chans:
        nm="%s_%s"%(A.name,{"basecolor":"BaseColor","roughness":"Roughness",
                            "metallic":"Metallic","ao":"AO","normal":"Normal"}[c])
        im=bpy.data.images.new(nm,A.texsize,A.texsize,alpha=False)
        im.colorspace_settings.name='Non-Color' if CH[c][1] else 'sRGB'
        imgs[c]=im
    def target(m,im):
        nt=m.node_tree
        n=nt.nodes.get("BAKE_TARGET") or nt.nodes.new('ShaderNodeTexImage')
        n.name="BAKE_TARGET"; n.image=im; n.location=(1200,400); nt.nodes.active=n
    def rewire(m,sock):
        nt=m.node_tree; b=principled(m)
        out=next((n for n in nt.nodes if n.type=='OUTPUT_MATERIAL'),None)
        if b is None or out is None: return None
        orig=out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].is_linked else None
        em=nt.nodes.new('ShaderNodeEmission'); em.location=(600,320)
        ip=b.inputs[sock]
        if ip.is_linked: nt.links.new(ip.links[0].from_socket,em.inputs['Color'])
        else:
            v=ip.default_value
            try: em.inputs['Color'].default_value=(v[0],v[1],v[2],1.0)
            except (TypeError,IndexError): em.inputs['Color'].default_value=(float(v),)*3+(1.0,)
        nt.links.new(em.outputs['Emission'],out.inputs['Surface'])
        return (out,orig,em)
    def restore(m,st):
        if not st: return
        out,orig,em=st
        try: m.node_tree.nodes.remove(em)
        except Exception: pass
        if orig is not None: m.node_tree.links.new(orig,out.inputs['Surface'])
    bk=sc.render.bake; bk.use_clear=True; bk.margin=10; bk.use_selected_to_active=False
    try: bk.margin_type='ADJACENT_FACES'
    except Exception: pass
    for c in chans:
        sock,_=CH[c]
        if sock:
            st={m:rewire(m,sock) for m in mats}
            for m in mats: target(m,imgs[c])
            select(bake_objs); sc.cycles.samples=1
            bpy.ops.object.bake(type='EMIT')
            for m,s in st.items(): restore(m,s)
        else:
            for m in mats: target(m,imgs[c])
            select(bake_objs)
            sc.cycles.samples=48 if c=="ao" else 1
            bpy.ops.object.bake(type='AO' if c=="ao" else 'NORMAL')
        log("baked",c)
    return imgs,mats

def pack_orm(A,imgs):
    need=[c for c in ("ao","roughness","metallic") if c in imgs]
    if len(need)<2: return None
    n=A.texsize*A.texsize
    def px(im):
        a=np.empty(len(im.pixels),dtype=np.float32); im.pixels.foreach_get(a)
        return a.reshape(-1,4)[:,0]
    orm=np.ones((n,4),dtype=np.float32)
    if "ao" in imgs: orm[:,0]=px(imgs["ao"])
    if "roughness" in imgs: orm[:,1]=px(imgs["roughness"])
    if "metallic" in imgs: orm[:,2]=px(imgs["metallic"])
    im=bpy.data.images.new("%s_ORM"%A.name,A.texsize,A.texsize,alpha=False)
    im.colorspace_settings.name='Non-Color'
    im.pixels.foreach_set(orm.reshape(-1))
    return im

def final_material(A,objs,imgs,orm):
    m=bpy.data.materials.new("%s_Baked"%A.name); m.use_nodes=True
    nt=m.node_tree
    for n in list(nt.nodes): nt.nodes.remove(n)
    o=nt.nodes.new('ShaderNodeOutputMaterial'); o.is_active_output=True; o.location=(700,0)
    b=nt.nodes.new('ShaderNodeBsdfPrincipled'); b.location=(380,0)
    nt.links.new(b.outputs['BSDF'],o.inputs['Surface'])
    def tex(im,loc):
        n=nt.nodes.new('ShaderNodeTexImage'); n.image=im; n.location=loc; return n
    if "basecolor" in imgs:
        nt.links.new(tex(imgs["basecolor"],(-380,260)).outputs['Color'],b.inputs['Base Color'])
    if orm is not None:
        sp=nt.nodes.new('ShaderNodeSeparateColor'); sp.location=(-90,-40)
        nt.links.new(tex(orm,(-380,-40)).outputs['Color'],sp.inputs['Color'])
        nt.links.new(sp.outputs[1],b.inputs['Roughness'])
        nt.links.new(sp.outputs[2],b.inputs['Metallic'])
    if "normal" in imgs:
        nmn=nt.nodes.new('ShaderNodeNormalMap'); nmn.location=(-90,-360)
        nt.links.new(tex(imgs["normal"],(-380,-360)).outputs['Color'],nmn.inputs['Color'])
        nt.links.new(nmn.outputs['Normal'],b.inputs['Normal'])
    for ob in objs:
        ob.data.materials.clear(); ob.data.materials.append(m)
        for f in ob.data.polygons: f.material_index=0
    return m

# ----------------------------------------------------------------- lod / collision
def join_copy(objs,name):
    select([]); news=[]
    for o in objs:
        d=o.copy(); d.data=o.data.copy(); d.parent=None; d.matrix_world=o.matrix_world
        bpy.context.collection.objects.link(d); news.append(d)
    select(news)
    if len(news)>1: bpy.ops.object.join()
    j=bpy.context.active_object; j.name=name; return j

def lods(A,objs):
    if A.lods.strip()=="none": return {}
    out={}
    for i,r in enumerate([float(x) for x in A.lods.split(",") if x.strip()]):
        j=join_copy(objs,"%s_LOD%d"%(A.name,i+1))
        md=j.modifiers.new("dec",'DECIMATE'); md.ratio=r
        bpy.context.view_layer.objects.active=j
        bpy.ops.object.modifier_apply(modifier=md.name)
        out[j.name]=(j,len(j.data.polygons),r)
        log("%s: %d tris (%.0f%%)"%(j.name,len(j.data.polygons),r*100))
    return out

def collision(A,objs,cfg):
    if A.collision=="none": return []
    names=cfg.get("collision")
    pool=[o for o in objs if o.name in names] if names else \
         sorted(objs,key=lambda o:-len(o.data.polygons))[:A.collision_parts]
    out=[]
    if A.collision=="hull":
        j=join_copy(objs,"UCX_%s_00"%A.name)
        bpy.context.view_layer.objects.active=j
        bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.mesh.convex_hull(); bpy.ops.object.mode_set(mode='OBJECT')
        return [j]
    for i,src in enumerate(pool):
        lo=Vector((1e9,)*3); hi=Vector((-1e9,)*3)
        for c in src.bound_box:
            w=src.matrix_world@Vector(c)
            for k in range(3): lo[k]=min(lo[k],w[k]); hi[k]=max(hi[k],w[k])
        bpy.ops.mesh.primitive_cube_add(size=1.0,location=(lo+hi)*0.5)
        b=bpy.context.object; b.name="UCX_%s_%02d"%(A.name,i)
        b.scale=(hi-lo)
        bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
        out.append(b)
    log("collision: %d %s"%(len(out),A.collision))
    return out

# ----------------------------------------------------------------- uv qa / export
def uv_islands(objs):
    import collections
    total=0
    for o in objs:
        me=o.data
        if not me.uv_layers: continue
        uvl=me.uv_layers[0].data
        e2f=collections.defaultdict(list)
        for p in me.polygons:
            for li in p.loop_indices: e2f[me.loops[li].edge_index].append(p.index)
        def euv(fi,ei):
            ev=set(me.edges[ei].vertices)          # match UVs per VERTEX, not per loop
            d={}
            for li in me.polygons[fi].loop_indices:
                l=me.loops[li]
                if l.vertex_index in ev:
                    d[l.vertex_index]=(round(uvl[li].uv[0],5),round(uvl[li].uv[1],5))
            return tuple(sorted(d.items()))
        adj=collections.defaultdict(set)
        for ei,fs in e2f.items():
            if len(fs)!=2: continue
            a,b=fs
            if euv(a,ei)==euv(b,ei): adj[a].add(b); adj[b].add(a)
        seen=set()
        for p in me.polygons:
            if p.index in seen: continue
            total+=1; st=[p.index]; seen.add(p.index)
            while st:
                c=st.pop()
                for n in adj[c]:
                    if n not in seen: seen.add(n); st.append(n)
    return total

def uv_qa(objs,texsize):
    util=0.0; dens=[]
    for o in objs:
        if not o.data.uv_layers: continue
        uvl=o.data.uv_layers[0].data
        for p in o.data.polygons:
            li=list(p.loop_indices)
            if len(li)<3: continue
            uvs=[Vector(uvl[i].uv) for i in li]
            ua=0.0
            for k in range(1,len(uvs)-1):
                ua+=abs((uvs[k]-uvs[0]).cross(uvs[k+1]-uvs[0]))*0.5
            util+=ua
            if p.area>1e-9 and ua>1e-12: dens.append(math.sqrt(ua)*texsize/math.sqrt(p.area))
    dens.sort()
    if not dens: return {"utilisation":0,"texel_median":0}
    return {"utilisation":round(util*100,2),
            "texel_median":round(dens[len(dens)//2],1),
            "texel_p5":round(dens[len(dens)//20],1),
            "texel_p95":round(dens[-len(dens)//20],1),
            "uv_islands":uv_islands(objs)}

def export(A,objs,lodmap,cols,imgs,orm,outdir):
    res={}
    fm=[f.strip() for f in A.formats.split(",") if f.strip()]
    for k,im in list(imgs.items())+([("orm",orm)] if orm is not None else []):
        if im is None: continue
        p=os.path.join(outdir,im.name+".png")
        im.filepath_raw=p; im.file_format='PNG'; im.save()
        res[os.path.basename(p)]="%dx%d"%(A.texsize,A.texsize)
    if "glb" in fm:
        select(objs)
        try:
            bpy.ops.export_scene.gltf(filepath=os.path.join(outdir,A.name+".glb"),
                export_format='GLB',use_selection=True,export_yup=True,
                export_materials='EXPORT',export_image_format='AUTO')
            res[A.name+".glb"]="hierarchy + embedded textures"
        except Exception as e: log("GLB failed:",e)
    if "fbx" in fm:
        select(objs)
        try:
            bpy.ops.export_scene.fbx(filepath=os.path.join(outdir,A.name+".fbx"),
                use_selection=True,path_mode='COPY',embed_textures=True,
                apply_unit_scale=True,add_leaf_bones=False)
            res[A.name+".fbx"]="hierarchy + embedded textures"
        except Exception as e: log("FBX failed:",e)
    if "obj" in fm:
        select(objs)
        try:
            bpy.ops.wm.obj_export(filepath=os.path.join(outdir,A.name+".obj"),
                export_selected_objects=True,export_normals=True,export_uv=True,
                export_materials=True,export_triangulated_mesh=True,path_mode='COPY')
            res[A.name+".obj"]="normals + UVs + MTL"
        except Exception as e: log("OBJ failed:",e)
    for nm,(j,t,r) in lodmap.items():
        select([j])
        try:
            bpy.ops.wm.obj_export(filepath=os.path.join(outdir,nm+".obj"),
                export_selected_objects=True,export_normals=True,export_uv=True,
                export_materials=True,path_mode='COPY')
            res[nm+".obj"]="%d tris"%t
        except Exception as e: log(nm,"failed:",e)
    if cols:
        select(cols)
        try:
            bpy.ops.wm.obj_export(filepath=os.path.join(outdir,A.name+"_collision.obj"),
                export_selected_objects=True,export_normals=False,export_uv=False,
                export_materials=False)
            res[A.name+"_collision.obj"]="%d hulls"%len(cols)
        except Exception as e: log("collision export failed:",e)
    return res

def validate_render(A,objs,outdir):
    sc=bpy.context.scene
    keep=set(objs)
    for o in bpy.data.objects:                 # LODs + collision must not be in frame
        if o.type=='MESH' and o not in keep: o.hide_render=True
    SUN=Vector((0.44,0.70,-0.36)).normalized()
    SUNB=Vector((SUN.x,-SUN.z,SUN.y)).normalized()
    w=bpy.data.worlds.new("W"); sc.world=w; w.use_nodes=True
    wnt=w.node_tree
    for n in list(wnt.nodes): wnt.nodes.remove(n)
    wo=wnt.nodes.new('ShaderNodeOutputWorld'); wo.is_active_output=True
    bg=wnt.nodes.new('ShaderNodeBackground')
    sky=wnt.nodes.new('ShaderNodeTexSky')
    try:
        sky.sky_type='MULTIPLE_SCATTERING'; sky.sun_disc=False
        sky.sun_elevation=math.asin(max(-1,min(1,SUNB.z))); sky.sun_rotation=math.atan2(SUNB.y,SUNB.x)
    except Exception: pass
    wnt.links.new(sky.outputs['Color'],bg.inputs['Color'])
    wnt.links.new(bg.outputs['Background'],wo.inputs['Surface'])
    sl=bpy.data.lights.new("S",'SUN'); sl.energy=950; sl.angle=math.radians(0.6)
    so=bpy.data.objects.new("S",sl); bpy.context.collection.objects.link(so)
    so.rotation_mode='QUATERNION'
    so.rotation_quaternion=Vector((0,0,-1)).rotation_difference(-SUNB)
    lo=Vector((1e9,)*3); hi=Vector((-1e9,)*3)
    for o in objs:
        for c in o.bound_box:
            p=o.matrix_world@Vector(c)
            for i in range(3): lo[i]=min(lo[i],p[i]); hi[i]=max(hi[i],p[i])
    ctr=(lo+hi)*0.5; rad=(hi-lo).length*0.5
    bpy.ops.mesh.primitive_plane_add(size=max(200.0,rad*40),location=(ctr.x,ctr.y,lo.z))
    gm=bpy.data.materials.new("ground"); gm.use_nodes=True
    gb=next(n for n in gm.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    gb.inputs['Base Color'].default_value=(0.115,0.088,0.055,1)
    gb.inputs['Roughness'].default_value=0.92
    bpy.context.object.data.materials.append(gm)
    sunaz=Vector((SUNB.x,SUNB.y)).normalized()
    perp=Vector((sunaz.y,-sunaz.x))
    EL=math.radians(20.0)
    d=Vector((perp.x*math.cos(EL),perp.y*math.cos(EL),math.sin(EL))).normalized()
    cd=bpy.data.cameras.new("C"); cd.lens=70.0; cd.sensor_width=36.0
    dist=rad/math.tan(math.atan(cd.sensor_width/2/cd.lens))*1.05
    cam=bpy.data.objects.new("C",cd); bpy.context.collection.objects.link(cam)
    eye=ctr+d*dist
    zc=(eye-ctr).normalized(); xc=Vector((0,0,1)).cross(zc).normalized(); yc=zc.cross(xc)
    cam.matrix_world=Matrix.Translation(eye)@Matrix((xc,yc,zc)).transposed().to_4x4()
    sc.camera=cam
    sc.cycles.samples=A.samples; sc.cycles.use_adaptive_sampling=True
    sc.cycles.adaptive_threshold=0.02; sc.cycles.use_denoising=True
    sc.render.resolution_x=1200; sc.render.resolution_y=750
    sc.view_settings.view_transform='AgX'; sc.view_settings.exposure=-5.95
    p=os.path.join(outdir,A.name+"_PREVIEW.png")
    sc.render.filepath=p
    bpy.ops.render.render(write_still=True)
    log("validation render ->",os.path.basename(p))
    return p

# ----------------------------------------------------------------- main
def main(argv):
    A=cli(argv)
    cfg=json.load(open(A.config)) if A.config else {}
    outdir=os.path.abspath(A.out); os.makedirs(outdir,exist_ok=True)
    sc=fresh(); load(A)
    objs=meshes()
    if not objs: raise SystemExit("no mesh objects loaded")
    rep={"name":A.name,"input":A.input or A.builtin or A.generator}
    rep["audit_in"]=audit(objs,"IN")
    normalize(A,objs)
    objs=split(A)
    cleanup(A,objs)
    pivots(A,objs,cfg)
    root=hierarchy(A,objs,cfg)
    reps=unwrap(A,objs)
    lightmap(A,objs)                 # channel 1 stays UNIQUE per instance (lightmaps must be)
    apply_material_library(A,objs)
    imgs,mats=bake_all(A,objs,sc,bake_objs=reps)
    orm=pack_orm(A,imgs) if imgs else None
    if imgs: final_material(A,objs,imgs,orm)
    rep["uv"]=uv_qa(objs,A.texsize)
    rep["uv"]["unique_coverage"]=uv_qa(reps,A.texsize)["utilisation"]
    rep["uv"]["unique_objects"]=len(reps)
    rep["uv"]["instanced_objects"]=len(objs)-len(reps)
    lodmap=lods(A,objs)
    cols=collision(A,objs,cfg)
    rep["audit_out"]=audit(objs,"OUT")
    rep["files"]=export(A,objs,lodmap,cols,imgs,orm,outdir)
    rep["settings"]=vars(A)
    json.dump(rep,open(os.path.join(outdir,"report.json"),"w"),indent=2,default=str)
    log("UV utilisation %.1f%%  texel median %s tex/m"%(rep["uv"]["utilisation"],rep["uv"].get("texel_median")))
    log("wrote %d files to %s"%(len(rep["files"])+1,outdir))
    for f in sorted(rep["files"]): log("   ",f,"-",rep["files"][f])
    if A.validate_render:
        try:
            p=validate_render(A,objs,outdir)
            rep["files"][os.path.basename(p)]="validation render (baked maps only)"
            json.dump(rep,open(os.path.join(outdir,"report.json"),"w"),indent=2,default=str)
        except Exception as e: log("validate render failed:",e)
    return rep

if __name__=="__main__":
    main(sys.argv[1:])
