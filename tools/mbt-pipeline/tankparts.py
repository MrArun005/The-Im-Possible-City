import numpy as np, zlib, struct, math, os
OUT="/tmp/claude-0/-home-user-The-Im-Possible-City/dfbe3253-b160-58aa-97ef-d68a211a1ad0/scratchpad/"
cos,sin,pi=math.cos,math.sin,math.pi

# ============================================================ materials
# albedo, roughness, specular
MATS=[(0.235,0.262,0.190,0.78,0.10),   #0 hull paint
      (0.215,0.242,0.176,0.80,0.09),   #1 turret paint
      (0.135,0.120,0.104,0.86,0.05),   #2 track steel
      (0.046,0.047,0.045,0.95,0.04),   #3 rubber
      (0.170,0.167,0.160,0.66,0.11),   #4 bright steel
      (0.060,0.064,0.058,0.82,0.09),   #5 dark fittings
      (0.300,0.320,0.270,0.10,0.70),   #6 lens
      (0.330,0.302,0.258,0.92,0.03),   #7 ground
      (0.260,0.245,0.205,0.95,0.03),   #8 canvas
      (0.315,0.296,0.268,0.86,0.06)]   #9 stone
MA=np.array([[m[0],m[1],m[2]] for m in MATS])**2.2; MR=np.array([m[3] for m in MATS])
MS=np.array([m[4] for m in MATS])

TP=[];TN=[];TM=[];TPT=[]
PART=['Body']
def setpart(n): PART[0]=n
def tri(p,n,m):
    TP.append(p); TN.append(n); TM.append(m); TPT.append(PART[0])

def Rmat(yaw,pitch,roll):
    cy,sy=cos(yaw),sin(yaw); cp,sp=cos(pitch),sin(pitch); cr,sr=cos(roll),sin(roll)
    Ry=np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]])
    Rx=np.array([[1,0,0],[0,cp,-sp],[0,sp,cp]])
    Rz=np.array([[cr,-sr,0],[sr,cr,0],[0,0,1]])
    return Ry@Rx@Rz
class XF:
    def __init__(self,pos=(0,0,0),yaw=0.0,pitch=0.0,roll=0.0):
        self.R=Rmat(yaw,pitch,roll); self.t=np.array(pos,dtype=float)
    def p(self,v): return self.R@np.asarray(v,dtype=float)+self.t
    def n(self,v): return self.R@np.asarray(v,dtype=float)
I=XF()

def poly(pts,nrms,m):
    for i in range(1,len(pts)-1):
        tri([pts[0],pts[i],pts[i+1]],[nrms[0],nrms[i],nrms[i+1]],m)

def loc(axis,s,u,v,sc):
    if axis=='x': return (s,v*sc,u*sc)
    if axis=='y': return (u*sc,s,v*sc)
    return (u*sc,v*sc,s)
def rad(axis,u,v):
    if axis=='x': n=(0.0,v,u)
    elif axis=='y': n=(u,0.0,v)
    else: n=(u,v,0.0)
    L=math.hypot(*[c for c in n if True]) if False else math.sqrt(n[0]**2+n[1]**2+n[2]**2)
    return (n[0]/L,n[1]/L,n[2]/L) if L>1e-9 else (0.0,1.0,0.0)

def prism(prof,axis,length,m,xf=I,taper=1.0,smooth=False,off=0.0):
    n=len(prof)
    A=[xf.p(loc(axis,-length/2+off,u,v,1.0)) for u,v in prof]
    B=[xf.p(loc(axis, length/2+off,u,v,taper)) for u,v in prof]
    ad={'x':(1,0,0),'y':(0,1,0),'z':(0,0,1)}[axis]
    na=xf.n(ad); nb=tuple(-c for c in na)
    poly(A,[nb]*n,m); poly(B[::-1],[na]*n,m)
    for i in range(n):
        j=(i+1)%n
        if smooth:
            ni=xf.n(rad(axis,prof[i][0],prof[i][1])); nj=xf.n(rad(axis,prof[j][0],prof[j][1]))
        else:
            e1=np.array(A[j])-np.array(A[i]); e2=np.array(B[i])-np.array(A[i])
            fn=np.cross(e1,e2); L=np.linalg.norm(fn)
            fn=fn/L if L>1e-12 else np.array([0.,1.,0.]); ni=nj=tuple(fn)
        # side quads must wind OUTWARD to agree with the caps and the radial smooth
        # normals; the old order was inward, so any consumer rebuilding normals from
        # winding (a raw OBJ import) received an inside-out solid.
        tri([A[j],A[i],B[j]],[nj,ni,nj],m); tri([B[j],A[i],B[i]],[nj,ni,ni],m)

def box(sx,sy,sz,m,xf=I):
    prism([(-sz/2,-sy/2),(sz/2,-sy/2),(sz/2,sy/2),(-sz/2,sy/2)],'x',sx,m,xf)
def cyl(r,length,axis,m,xf=I,seg=22,taper=1.0):
    prism([(cos(2*pi*k/seg)*r,sin(2*pi*k/seg)*r) for k in range(seg)],axis,length,m,xf,taper,True)
def h(n,s=1):
    x=math.sin(n*127.1+s*311.7)*43758.5453; return x-math.floor(x)
def cham(prof,c=0.05):                       # chamfer polygon corners
    n=len(prof); out=[]
    for i in range(n):
        p=np.array(prof[i]); a=np.array(prof[(i-1)%n]); b=np.array(prof[(i+1)%n])
        da=a-p; db=b-p
        da=da/max(np.linalg.norm(da),1e-9); db=db/max(np.linalg.norm(db),1e-9)
        out.append(tuple(p+da*c)); out.append(tuple(p+db*c))
    return out

# ============================================================ geometry
HULL,TUR,TRK,RUB,STL,DRK,LEN_,GRD,CNV,STONE=0,1,2,3,4,5,6,7,8,9
ZF,ZR,TR,TW=3.32,-3.32,0.60,0.635
TX=1.53                                        # track centreline x

# ---- ground
GX,GZ=9.9,12.4
RAD=[3.5,6.5,10.0,15.0,22.0,33.0,50.0,80.0,140.0,260.0,520.0]
NA=96
for ri in range(len(RAD)-1):
    r0,r1=RAD[ri],RAD[ri+1]
    for ai in range(NA):
        a0=2*pi*ai/NA; a1=2*pi*(ai+1)/NA
        poly([(GX+cos(a0)*r0,0,GZ+sin(a0)*r0),(GX+cos(a1)*r0,0,GZ+sin(a1)*r0),
              (GX+cos(a1)*r1,0,GZ+sin(a1)*r1),(GX+cos(a0)*r1,0,GZ+sin(a0)*r1)],
             [(0,1,0)]*4,GRD)

# ---- track path (stadium, slight sag on the top run)
def path(t):                                   # t in [0,1) -> (z,y,tangent angle)
    Ls=ZF-ZR; per=2*Ls+2*pi*TR; s=t*per
    if s<Ls: z=ZF-s; return z,0.0,math.atan2(0,-1)
    s-=Ls
    if s<pi*TR:
        a=-pi/2-(s/TR); return ZR+cos(a)*TR, TR+sin(a)*TR, a-pi/2
    s-=pi*TR
    if s<Ls:
        z=ZR+s; sag=0.095*max(0.0,sin(pi*((z-ZR)/Ls)*3.0))   # catenary droop
        return z, 2*TR-sag, 0.0
    s-=Ls
    a=pi/2-(s/TR); return ZF+cos(a)*TR, TR+sin(a)*TR, a-pi/2

NL=84
# MBT_LINK_PARTS=1 emits every track link as its own part, so an animation rig can
# scroll the links around the loop individually.  Off by default: 168 extra objects
# is pure overhead for a static export.
LINKPARTS=bool(os.environ.get("MBT_LINK_PARTS"))
for sgn in (-1,1):
    side="L" if sgn<0 else "R"
    setpart("Track_"+side)
    for k in range(NL):
        if LINKPARTS: setpart("Link_%s_%02d"%(side,k))
        t=k/NL; z,y,_=path(t)
        z2,y2,_=path((k+1)/NL)
        pit=-math.atan2(y2-y,z2-z)
        plen=math.hypot(z2-z,y2-y)
        ln=plen*0.86                       # 14% gap so links read individually
        cx,cy,cz=sgn*TX,(y+y2)/2,(z+z2)/2
        box(TW,0.055,ln,TRK,XF((cx,cy,cz),pitch=pit))                 # pad plate
        box(TW*0.46,0.070,ln*0.52,TRK,XF((cx,cy-0.052,cz),pitch=pit)) # ground grouser
        box(0.095,0.085,ln*0.42,TRK,XF((cx,cy+0.062,cz),pitch=pit))   # centre guide horn
    # road wheels: 7 per side, twin discs, riding the inner face of the bottom run.
    # radius 0.375 on 0.78 spacing -> 0.030 m clearance between neighbours,
    # and 0.07 / 0.10 m clearance to the sprocket / idler.
    RW=0.375; RWY=0.41
    for k in range(7):
        z=-2.34+k*0.78
        setpart("Wheel_%s%d"%(side,k+1))
        for dx in (-0.145,0.145):
            cyl(RW,0.185,'x',RUB,XF((sgn*TX+dx,RWY,z)),seg=26)      # rubber tyre
            cyl(0.285,0.205,'x',STL,XF((sgn*TX+dx,RWY,z)),seg=22)   # rim, proud of tyre
            cyl(0.150,0.225,'x',STL,XF((sgn*TX+dx,RWY,z)),seg=18)   # hub boss
        cyl(0.085,0.34,'x',DRK,XF((sgn*TX,RWY,z)),seg=12)           # axle
        _ox=sgn*(TX+0.145+0.118)                                     # bolt circle, outer face
        for _q in range(6):
            _a=2*pi*_q/6+0.3
            box(0.046,0.050,0.050,DRK,XF((_ox,RWY+sin(_a)*0.215,z+cos(_a)*0.215)))
    # sprocket + idler, hubs visible outboard
    for _nm,z,rr in (("Sprocket",ZR,0.55),("Idler",ZF,0.52)):
        setpart("%s_%s"%(_nm,side))
        cyl(rr,0.30,'x',STL,XF((sgn*TX,TR,z)),seg=26)
        cyl(0.24,TW+0.10,'x',STL,XF((sgn*TX+sgn*0.03,TR,z)),seg=18)
        for q in range(10):
            a=2*pi*q/10
            box(0.10,0.11,0.11,DRK,XF((sgn*(TX+TW/2+0.03),TR+sin(a)*rr*0.72,z+cos(a)*rr*0.72)))
    for k in range(4):                          # return rollers
        setpart("Roller_%s%d"%(side,k+1))
        cyl(0.145,0.18,'x',RUB,XF((sgn*(TX-0.10),2*TR-0.02,-2.1+k*1.42)),seg=16)

setpart("Hull")
# ---- hull: lower tub + full-width upper hull with long glacis
prism(cham([(-3.46,0.50),(3.36,0.50),(3.64,0.92),(3.64,1.32),(-3.46,1.32)],0.045),
      'x',2.44,HULL)
prism(cham([(-3.46,1.32),(3.64,1.32),(1.02,1.86),(-3.02,1.86),(-3.46,1.66)],0.05),
      'x',3.70,HULL)
# ---- side skirts (segmented plates over the upper run)
for sgn in (-1,1):
    for k in range(8):
        z=-3.15+k*0.86
        th=0.115 if k>=5 else 0.06                # heavier armour forward
        jy=(h(k*7+ (0 if sgn<0 else 3),51)-0.5)*0.040
        jp=(h(k*7+ (1 if sgn<0 else 4),52)-0.5)*0.045
        box(th,0.54,0.80,HULL,XF((sgn*(TX+TW/2+th/2+0.005),1.045+jy,z),
            yaw=(h(k,53)-0.5)*0.035,pitch=jp))
    box(0.10,0.30,0.55,HULL,XF((sgn*1.93,0.72,3.05)))          # front mudflap
    box(0.09,0.42,0.40,DRK,XF((sgn*1.90,0.60,-3.15)))          # rear mudflap
# ---- hull fittings
box(2.44,0.26,0.34,HULL,XF((0,0.60,3.52)))                     # lower nose
for sgn in (-1,1):
    box(0.34,0.26,0.20,LEN_,XF((sgn*1.22,1.50,3.28)))          # headlights
    box(0.44,0.10,0.26,DRK,XF((sgn*1.22,1.66,3.28)))
    box(0.20,0.24,0.34,STL,XF((sgn*1.05,0.78,3.66)))           # tow hooks
    for k in range(5):                                          # grab handles
        box(0.05,0.11,0.30,DRK,XF((sgn*1.845,1.60,-2.4+k*1.1)))
    cyl(0.055,4.6,'z',DRK,XF((sgn*1.80,1.42,-0.4)),seg=8)      # tow cable
box(1.05,0.13,0.86,HULL,XF((-0.62,1.88,1.44)))                 # driver hatch
for _q in range(8):                                            # hatch ring bolts
    _a=2*pi*_q/8
    box(0.044,0.028,0.044,DRK,XF((-0.62+cos(_a)*0.40,1.955,1.44+sin(_a)*0.40)))
for _s in (-1,1):                                              # lifting eyes
    box(0.10,0.16,0.09,STL,XF((_s*1.55,1.99,2.55)))
    box(0.10,0.16,0.09,STL,XF((_s*1.55,1.99,-2.85)))
# ---- weld beads along the major plate seams
for _s in (-1,1):
    box(0.055,0.055,6.80,STL,XF((_s*1.848,1.325,-0.05)))       # sponson underside seam
    box(0.055,0.055,3.90,STL,XF((_s*1.848,1.905,0.90)))        # deck edge seam
box(3.68,0.055,0.055,STL,XF((0,1.858,1.02)))                   # glacis / roof seam
box(3.68,0.055,0.055,STL,XF((0,1.335,3.60)))                   # nose / glacis seam
box(2.40,0.055,0.055,STL,XF((0,1.905,-3.00)))                  # engine deck rear seam
cyl(0.29,0.15,'y',HULL,XF((-0.62,1.92,1.44)),seg=22)
for k in range(3): box(0.13,0.14,0.10,LEN_,XF((-0.62+(k-1)*0.26,2.00,1.72)))  # periscopes
box(2.90,0.14,1.55,HULL,XF((0,1.90,-2.05)))                    # engine deck
for k in range(9): box(2.70,0.07,0.10,DRK,XF((0,1.98,-2.72+k*0.17)))
box(0.06,0.10,1.05,STL,XF((-1.88,1.62,-1.30)))                 # shovel shaft
box(0.05,0.22,0.30,STL,XF((-1.88,1.62,-0.72)))                 # shovel blade
for _c in (-1.62,-0.98):
    box(0.09,0.13,0.09,DRK,XF((-1.88,1.62,_c)))
box(0.06,0.09,0.92,STL,XF((1.88,1.62,-1.45)))                  # pick shaft
box(0.05,0.26,0.10,STL,XF((1.88,1.66,-0.99)))                  # pick head
for _c in (-1.72,-1.18):
    box(0.09,0.13,0.09,DRK,XF((1.88,1.62,_c)))
box(3.10,0.40,0.30,DRK,XF((0,1.72,-3.44)))                     # rear plate
for sgn in (-1,1):
    cyl(0.30,0.34,'z',DRK,XF((sgn*1.02,1.46,-3.56)),seg=18)    # exhausts
    box(0.42,0.44,0.10,DRK,XF((sgn*1.02,1.46,-3.74)))

# ---- glacis applique armour blocks
GA=math.radians(11.6)
for r in range(2):
    for c in range(4):
        t=0.18+r*0.46
        z=3.46-t*2.30; y=1.345+t*0.475
        box(0.62,0.155,0.86,HULL,XF(((c-1.5)*0.78,y+0.075,z),pitch=GA))
for c in range(3):                                            # spare track links on glacis
    box(TW*0.92,0.070,0.20,TRK,XF((-1.05+c*0.30,1.83,0.55),pitch=GA))

setpart("Turret")
# ---- turret (traversed): wedge front, long bustle
TQ=math.radians(13.0); TY,TH=1.86,0.82
def T(pos,yaw=0.0,pitch=0.0):
    x,y,z=pos; c,s2=cos(TQ),sin(TQ)
    return XF((x*c+z*s2,y,-x*s2+z*c),yaw=yaw+TQ,pitch=pitch)
tp=[(-1.68,-2.46),(1.68,-2.46),(1.68,0.34),(1.44,1.20),(0.56,1.64),
    (-0.56,1.64),(-1.44,1.20),(-1.68,0.34)]
prism(cham(tp,0.055),'y',TH,TUR,T((0,TY+TH/2,-0.30)),taper=0.94)
cyl(1.78,0.055,'y',STL,T((0,TY+0.02,-0.30)),seg=30)            # turret ring collar weld
for _s in (-1,1):                                              # grab rails, turret sides
    for _k in range(2):
        _z=-0.55-_k*0.95
        box(0.07,0.07,0.62,STL,T((_s*1.80,TY+0.62,_z)))        # rail bar
        for _e in (-0.27,0.27):
            box(0.06,0.16,0.06,STL,T((_s*1.76,TY+0.54,_z+_e))) # rail posts
# gun mantlet + canvas boot -> elevates with the gun
setpart("Gun")
prism(cham([(-0.52,-0.40),(0.52,-0.40),(0.60,0.02),(0.40,0.38),(-0.40,0.38),(-0.60,0.02)],0.04),
      'z',0.66,TUR,T((0,TY+0.42,1.42)),taper=0.74)             # shaped mantlet shield
box(1.12,0.80,0.26,CNV,T((0,TY+0.42,1.74)))
BY=TY+0.42
cyl(0.061,5.10,'z',STL,T((0,BY,1.94+2.55)),seg=22)             # 120mm tube
cyl(0.107,2.60,'z',TUR,T((0,BY,2.02+1.30)),seg=22)             # thermal sleeve
cyl(0.158,0.92,'z',TUR,T((0,BY,1.94+1.95)),seg=24)             # BORE EVACUATOR
cyl(0.168,0.055,'z',DRK,T((0,BY,1.94+1.52)),seg=24)            # evacuator bands
cyl(0.168,0.055,'z',DRK,T((0,BY,1.94+2.38)),seg=24)
for k in range(5): box(0.235,0.030,0.035,DRK,T((0,BY+0.104,1.30+k*0.52)))
cyl(0.038,0.95,'z',STL,T((-0.34,BY-0.06,1.94+0.75)),seg=14)    # coaxial MG barrel
box(0.16,0.16,0.26,DRK,T((-0.34,BY-0.06,1.62)))                # coax port shroud
cyl(0.075,0.36,'z',STL,T((0,BY,1.94+4.95)),seg=22)             # muzzle
cyl(0.086,0.09,'z',DRK,T((0,BY,1.94+4.75)),seg=22)
setpart("Turret")
# applique armour on the front cheeks
for sgn in (-1,1):
    ax,az=sgn*0.56,1.64; bx,bz=sgn*1.44,1.20
    ya=math.atan2(bx-ax,bz-az)
    for k in range(3):
        f=(k+0.5)/3.0
        box(0.30,0.46,0.34,TUR,T((ax+(bx-ax)*f,TY+0.40,az+(bz-az)*f),yaw=ya))
    for k in range(5):                                          # side armour rows
        box(0.20,0.40,0.44,TUR,T((sgn*1.78,TY+0.40,0.10-k*0.50)))
# roof furniture
cyl(0.47,0.27,'y',TUR,T((0.66,TY+TH+0.09,-0.55)),seg=26)       # cupola ring
cyl(0.44,0.09,'y',TUR,T((0.66,TY+TH+0.27,-0.55)),seg=26)
for k in range(7):
    a=2*pi*k/7+0.4
    box(0.10,0.11,0.10,LEN_,T((0.66+cos(a)*0.41,TY+TH+0.15,-0.55+sin(a)*0.41)))
box(0.28,0.22,0.30,DRK,T((0.66,TY+TH+0.42,-0.26)))             # cdr .50 cal
cyl(0.030,1.15,'z',DRK,T((0.66,TY+TH+0.50,0.36)),seg=10)
box(0.22,0.09,0.17,DRK,T((0.66,TY+TH+0.57,-0.14)))
box(0.16,0.20,0.34,DRK,T((0.66,TY+TH+0.40,-0.62)))             # ammo box
box(0.90,0.13,0.82,TUR,T((-0.72,TY+TH+0.02,-0.48)))            # loader hatch
box(0.26,0.20,0.26,DRK,T((-0.72,TY+TH+0.30,-0.10)))            # loader MG
cyl(0.024,0.80,'z',DRK,T((-0.72,TY+TH+0.36,0.36)),seg=8)
box(0.42,0.46,0.44,TUR,T((-0.64,TY+TH+0.21,0.74)))             # gunner sight
box(0.36,0.32,0.05,LEN_,T((-0.64,TY+TH+0.23,0.97)))
box(0.36,0.36,0.36,TUR,T((0.72,TY+TH+0.17,0.92)))              # cdr panoramic sight
box(0.26,0.24,0.05,LEN_,T((0.72,TY+TH+0.19,1.11)))
cyl(0.13,0.24,'y',DRK,T((0.05,TY+TH+0.14,0.30)),seg=14)        # crosswind sensor
# bustle + stowage
box(3.16,0.62,1.08,TUR,T((0,TY+0.36,-2.06)))
for k in range(7): box(0.045,0.52,0.98,DRK,T((-1.47+k*0.49,TY+0.36,-2.64)))
for sgn in (-1,1):
    box(0.44,0.40,0.62,DRK,T((sgn*1.06,TY+0.74,-2.20)))        # bins on the rack
    box(0.30,0.44,0.30,CNV,T((sgn*0.36,TY+0.76,-2.34)))        # rolled tarp
    for k in range(8):                                          # smoke launchers
        cyl(0.070,0.30,'z',DRK,T((sgn*1.44,TY+0.58,0.26-k*0.165)),seg=10)
    box(0.16,0.44,1.10,TUR,T((sgn*1.72,TY+0.28,-0.90)))        # side stowage
    box(0.22,0.34,0.24,DRK,T((sgn*1.70,TY+0.72,-1.72)))        # jerry can
    for k in range(4):                                          # spare track links
        box(TW*0.90,0.065,0.19,TRK,T((sgn*1.74,TY+0.06+k*0.20,-1.30)))
cyl(0.016,1.55,'y',DRK,T((-1.34,TY+TH+0.78,-1.74)),seg=6)      # whip antennas
cyl(0.016,1.30,'y',DRK,T((1.34,TY+TH+0.66,-1.94)),seg=6)
box(0.16,0.30,0.14,DRK,T((-1.12,TY+TH+0.16,-2.34)))


def parts(skip=(GRD,)):
    out={}
    for p,m,pt in zip(TP,TM,TPT):
        if m in skip: continue
        out.setdefault(pt,{}).setdefault(m,[]).append(p)
    return out
def groups(skip=(GRD,)):
    out={}
    for p,m in zip(TP,TM):
        if m in skip: continue
        out.setdefault(m,[]).append(p)
    return out
NAMES={HULL:"Hull",TUR:"Turret",TRK:"Track",RUB:"Rubber",STL:"Steel",
       DRK:"Fittings",LEN_:"Optics",CNV:"Canvas"}
def parts_named():
    return {p:{NAMES[m]:t for m,t in bm.items()} for p,bm in parts().items()}
