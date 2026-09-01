import numpy as np, zlib, struct, math
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
for sgn in (-1,1):
    side="L" if sgn<0 else "R"
    setpart("Track_"+side)
    for k in range(NL):
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

TPa=np.array(TP,dtype=np.float64); TNa=np.array(TN,dtype=np.float64)
TMa=np.array(TM,dtype=np.int32)
nt=len(TPa); print("triangles:",nt)

# ============================================================ camera
SS=2; OW,OH=1700,1100; W,H=OW*SS,OH*SS
eye=np.array([GX,4.55,GZ]); tgt=np.array([0.05,1.34,0.85])
fv=tgt-eye; fv/=np.linalg.norm(fv)
rv=np.cross(fv,np.array([0.,1.,0.])); rv/=np.linalg.norm(rv); uv=np.cross(rv,fv)
Rc=np.stack([rv,uv,-fv]); fov=math.radians(30.0); fl=(H/2)/math.tan(fov/2)
SUN=np.array([0.44,0.70,-0.36]); SUN/=np.linalg.norm(SUN)

NEAR=0.35
def raster(P,attrs,Wp,Hp,proj,cmp_min=False):
    """generic z-buffer; proj(P)->(sx,sy,depthkey). attrs: list of (nt,3,k) arrays."""
    sx,sy,dk=proj(P.reshape(-1,3))
    sx=sx.reshape(-1,3); sy=sy.reshape(-1,3); dk=dk.reshape(-1,3)
    if cmp_min:
        buf=np.full((Hp,Wp),1e30)
    else:
        buf=np.zeros((Hp,Wp))
    outs=[np.zeros((Hp,Wp,a.shape[2]),dtype=np.float32) for a in attrs]
    mid=np.zeros((Hp,Wp),dtype=np.int32)
    for t in range(len(sx)):
        xs=sx[t]; ys=sy[t]; ds=dk[t]
        if not np.all(np.isfinite(xs)) or np.any(ds<=NEAR): continue
        x0=max(int(xs.min()),0); x1=min(int(xs.max())+2,Wp)
        y0=max(int(ys.min()),0); y1=min(int(ys.max())+2,Hp)
        if x1<=x0 or y1<=y0: continue
        d=(xs[1]-xs[0])*(ys[2]-ys[0])-(xs[2]-xs[0])*(ys[1]-ys[0])
        if abs(d)<1e-12: continue
        PX,PY=np.meshgrid(np.arange(x0,x1)+0.5,np.arange(y0,y1)+0.5)
        w0=((xs[1]-PX)*(ys[2]-PY)-(xs[2]-PX)*(ys[1]-PY))/d
        w1=((xs[2]-PX)*(ys[0]-PY)-(xs[0]-PX)*(ys[2]-PY))/d
        w2=1.0-w0-w1
        m=(w0>=-1e-9)&(w1>=-1e-9)&(w2>=-1e-9)
        if not m.any(): continue
        if cmp_min:
            val=w0*ds[0]+w1*ds[1]+w2*ds[2]
            sub=buf[y0:y1,x0:x1]; m&=val<sub
            if not m.any(): continue
            sub[m]=val[m]
        else:
            iz=w0/ds[0]+w1/ds[1]+w2/ds[2]        # interpolate 1/z
            sub=buf[y0:y1,x0:x1]; m&=iz>sub
            if not m.any(): continue
            sub[m]=iz[m]
            zz=1.0/iz[m]
            for a,o in zip(attrs,outs):
                num=(w0[m]/ds[0])[:,None]*a[t,0]+(w1[m]/ds[1])[:,None]*a[t,1]+(w2[m]/ds[2])[:,None]*a[t,2]
                o[y0:y1,x0:x1][m]=num*zz[:,None]
            mid[y0:y1,x0:x1][m]=TMa[t]+1
    return buf,outs,mid

# ---------------- shadow map (orthographic, from the sun)
SM=2200
lu=np.cross(SUN,np.array([0.,1.,0.])); lu/=np.linalg.norm(lu); lvv=np.cross(lu,SUN)
tk=TPa[(TMa!=GRD)&(TMa!=STONE)].reshape(-1,3)
pu=tk@lu; pv=tk@lvv
u0,u1=pu.min()-0.6,pu.max()+0.6; v0,v1=pv.min()-0.6,pv.max()+0.6
def sproj(P):
    a=(P@lu-u0)/(u1-u0)*SM; b=(P@lvv-v0)/(v1-v0)*SM
    return a,b,-(P@SUN)+400.0
mask=(TMa!=GRD)&(TMa!=STONE)
smap,_,_=raster(TPa[mask],[],SM,SM,sproj,cmp_min=True)
print("shadow map done")

# ---------------- sky-occlusion map (top down, stores max height)
KM=900; kx0,kx1,kz0,kz1=-6.0,6.0,-6.0,8.0
def kproj(P):
    a=(P[:,0]-kx0)/(kx1-kx0)*KM; b=(P[:,2]-kz0)/(kz1-kz0)*KM
    return a,b,-P[:,1]+50.0
kmap,_,_=raster(TPa[mask],[],KM,KM,kproj,cmp_min=True)
kh=np.where(kmap>1e29,-99.0,50.0-kmap)
for _ in range(3):                                  # soften
    kh=np.maximum.reduce([kh,np.roll(kh,1,0)*0+kh])
    kh=(kh+np.roll(kh,1,0)+np.roll(kh,-1,0)+np.roll(kh,1,1)+np.roll(kh,-1,1))/5.0
print("sky occlusion done")

# ---------------- G-buffer
def cproj(P):
    vwp=(P-eye)@Rc.T; z=-vwp[:,2]
    zs=np.where(np.abs(z)<1e-6,1e-6,z)
    return W/2+vwp[:,0]*fl/zs, H/2-vwp[:,1]*fl/zs, z
zb,(wp,nb),mid=raster(TPa,[TPa.astype(np.float32),TNa.astype(np.float32)],W,H,cproj)
print("gbuffer done")

hw,hh=W//2,H//2
Ph=wp[::2,::2]; Nh=nb[::2,::2].copy(); Zh=zb[::2,::2]; Vh=mid[::2,::2]>0
Nh/=np.maximum(np.linalg.norm(Nh,axis=2,keepdims=True),1e-9)
zc=1.0/np.maximum(Zh,1e-9)
rpx=np.clip(0.60*fl/np.maximum(zc,0.2)/2.0,2.0,52.0)
XI=np.arange(hw)[None,:]; YI=np.arange(hh)[:,None]
occ=np.zeros((hh,hw),dtype=np.float32); NT=10
for k in range(NT):
    a=k*2.39996; rr=math.sqrt((k+0.5)/NT)
    ox,oy=math.cos(a)*rr,math.sin(a)*rr
    xi=np.clip((XI+ox*rpx).astype(np.int32),0,hw-1)
    yi=np.clip((YI+oy*rpx).astype(np.int32),0,hh-1)
    Ps=Ph[yi,xi]; vs=Vh[yi,xi]
    dv=Ps-Ph; dl=np.linalg.norm(dv,axis=2)
    dvn=dv/np.maximum(dl,1e-6)[...,None]
    nd=(Nh*dvn).sum(2)
    fall=1.0/(1.0+(dl/0.55)**2)
    occ+=np.clip(nd-0.10,0,1)*fall*vs
ssao=np.clip(1.0-2.30*occ/NT,0.06,1.0).astype(np.float32)
ssao=np.where(Vh,ssao,1.0)
for _ in range(4):
    ssao=(ssao+np.roll(ssao,1,0)+np.roll(ssao,-1,0)+np.roll(ssao,1,1)+np.roll(ssao,-1,1))/5.0
AO2=np.repeat(np.repeat(ssao,2,0),2,1)
print("ssao done")

# ============================================================ shading
img=np.zeros((H,W,3),dtype=np.float32)
def noise(P,f):
    q=P*f; i=np.floor(q); fr=q-i; fr=fr*fr*(3-2*fr)
    ix=i[...,0].astype(np.int64); iy=i[...,1].astype(np.int64); iz=i[...,2].astype(np.int64)
    def hsh(a,b,c):
        h=(a*374761393+b*668265263+c*1274126177).astype(np.int64)
        h=(h^(h>>13))*1274126177; h=h^(h>>16)
        return (h&0xffff).astype(np.float32)/65535.0
    c000=hsh(ix,iy,iz);     c100=hsh(ix+1,iy,iz)
    c010=hsh(ix,iy+1,iz);   c110=hsh(ix+1,iy+1,iz)
    c001=hsh(ix,iy,iz+1);   c101=hsh(ix+1,iy,iz+1)
    c011=hsh(ix,iy+1,iz+1); c111=hsh(ix+1,iy+1,iz+1)
    fx,fy,fz=fr[...,0],fr[...,1],fr[...,2]
    a=c000+(c100-c000)*fx; b=c010+(c110-c010)*fx
    c=c001+(c101-c001)*fx; d=c011+(c111-c011)*fx
    return (a+(b-a)*fy)+((c+(d-c)*fy)-(a+(b-a)*fy))*fz

SUNC=np.array([1.00,0.955,0.885],dtype=np.float32)*3.15
FILLD=np.array([0.62,0.26,0.74],dtype=np.float32); FILLD/=np.linalg.norm(FILLD)
FILLC=np.array([0.60,0.685,0.82],dtype=np.float32)*0.46
def s2l(c): return np.array(c,dtype=np.float32)**2.2
CGREEN=s2l((0.255,0.278,0.212)); CBROWN=s2l((0.252,0.196,0.150)); CBLACK=s2l((0.146,0.149,0.146))
SKYU=np.array([0.40,0.50,0.66],dtype=np.float32)*0.60
SKYD=np.array([0.33,0.29,0.235],dtype=np.float32)*0.34
BAND=200
for yy in range(0,H,BAND):
    ye=min(yy+BAND,H)
    hit=mid[yy:ye]>0
    P=wp[yy:ye]; N=nb[yy:ye].astype(np.float32)
    nl=np.linalg.norm(N,axis=2,keepdims=True); N=N/np.maximum(nl,1e-9)
    Vd=eye.astype(np.float32)-P; Vl=np.linalg.norm(Vd,axis=2,keepdims=True)
    Vd=Vd/np.maximum(Vl,1e-9)
    N=np.where((N*Vd).sum(2,keepdims=True)<0,-N,N)
    mi=np.maximum(mid[yy:ye]-1,0)
    alb=MA[mi].astype(np.float32); rgh=MR[mi].astype(np.float32); spc=MS[mi].astype(np.float32)

    # --- NATO three-colour camouflage on painted surfaces
    n1=noise(P,0.55); n2=noise(P,3.1)
    nc=np.clip(noise(P,0.92)+0.20*(noise(P,3.4)-0.5),0,1)
    paint=((mi==HULL)|(mi==TUR)|(mi==CNV))
    camo=np.where((nc<0.445)[...,None],CGREEN,
          np.where((nc<0.715)[...,None],CBROWN,CBLACK))
    alb=np.where(paint[...,None],camo,alb)
    alb=alb*(1.0+0.075*(n1-0.5)[...,None])
    grnd=(mi==GRD)
    dust=np.clip((1.45-P[...,1])/1.25,0,1)*(0.28+0.72*np.clip(N[...,1],0,1))
    dust=np.clip(dust*(0.45+0.85*n2),0,1)*0.80
    dust=np.where(grnd,0.0,dust)
    dust=np.where((mi==TRK)|(mi==RUB)|(mi==STL),dust*0.45,dust)
    DUSTC=np.array([0.40,0.355,0.285],dtype=np.float32)
    alb=alb*(1-dust[...,None])+DUSTC*dust[...,None]
    rgh=np.clip(rgh+0.25*dust,0,1); spc=spc*(1-0.75*dust)
    # --- ground: multi-octave soil, disturbed earth and track ruts
    g1=noise(P,0.30); g2=noise(P,1.35); g3=noise(P,5.4); g4=noise(P,19.0)
    g5=noise(P,58.0)
    gt=np.clip(0.72+0.34*(g1-0.5)+0.30*(g2-0.5)+0.30*(g3-0.5)+0.24*(g4-0.5)
               +0.16*(g5-0.5),0.26,1.62)
    SOILA=s2l((0.400,0.338,0.256)); SOILB=s2l((0.318,0.292,0.256))
    gcol=SOILA*g2[...,None]+SOILB*(1-g2[...,None])
    rut=np.exp(-((np.abs(P[...,0])-1.53)**2)/(2*0.235**2))*np.clip((-0.55-P[...,2])/1.6,0,1)
    halo=np.exp(-((P[...,0]**2)/28.0+((P[...,2]+0.3)**2)/40.0))
    gcol=gcol*(1.0-0.34*rut[...,None])*(1.0-0.10*halo[...,None])
    alb=np.where(grnd[...,None],gcol*gt[...,None],alb)
    rgh=np.where(grnd,np.clip(rgh+0.05*(1-g3),0,1),rgh)
    # --- vertical dirt streaks on painted vertical faces
    Pst=P*np.array([7.0,0.55,7.0],dtype=np.float32)
    stk=noise(Pst,1.0)
    side=1.0-np.clip(np.abs(N[...,1]),0,1)
    ds=np.clip((stk-0.54)*2.4,0,1)*side*np.clip((1.75-P[...,1])/1.55,0,1)
    ds=np.where(grnd,0.0,ds)
    alb=alb*(1-0.32*ds[...,None])+DUSTC*(0.32*ds[...,None])
    # --- rust bloom on running gear
    rst=np.clip((noise(P,3.6)-0.52)*2.6,0,1)*((mi==TRK)|(mi==STL))
    alb=alb*(1-0.45*rst[...,None])+s2l((0.300,0.190,0.130))*(0.45*rst[...,None])
    # --- overall desaturation: field vehicles are never saturated
    lum=(alb*np.array([0.2126,0.7152,0.0722],dtype=np.float32)).sum(2,keepdims=True)
    alb=alb*0.84+lum*0.16

    # --- sun shadow, 3x3 PCF
    su=(P@lu-u0)/(u1-u0)*SM; sv=(P@lvv-v0)/(v1-v0)*SM
    sd=-(P@SUN)+400.0
    ndl=np.clip((N*SUN.astype(np.float32)).sum(2),0,1)
    bias=0.013+0.052*(1.0-ndl)
    lit=np.zeros(ndl.shape,dtype=np.float32); cnt=0
    for ox in (-1,0,1):
        for oy in (-1,0,1):
            ii=np.clip((su+ox).astype(np.int32),0,SM-1); jj=np.clip((sv+oy).astype(np.int32),0,SM-1)
            ref=smap[jj,ii]
            lit+=np.where((ref>1e29)|(sd<=ref+bias),1.0,0.0); cnt+=1
    lit/=cnt
    inside=(su>=0)&(su<SM)&(sv>=0)&(sv<SM)
    lit=np.where(inside,lit,1.0)

    # --- sky occlusion (ambient)
    ki=np.clip(((P[...,0]-kx0)/(kx1-kx0)*KM).astype(np.int32),0,KM-1)
    kj=np.clip(((P[...,2]-kz0)/(kz1-kz0)*KM).astype(np.int32),0,KM-1)
    above=kh[kj,ki]-P[...,1]
    ao=np.clip(1.0-0.72*np.clip(above/0.9,0,1),0.25,1.0)
    ink=(P[...,0]>kx0)&(P[...,0]<kx1)&(P[...,2]>kz0)&(P[...,2]<kz1)
    ao=np.where(ink,ao,1.0)
    ao=ao*(0.55+0.45*np.clip(0.5+0.5*N[...,1],0,1))
    ao=ao*AO2[yy:ye]

    # --- lighting
    diff=alb*(ndl*lit)[...,None]*SUNC*(0.72+0.28*AO2[yy:ye])[...,None]
    hemi=0.5+0.5*N[...,1]
    amb=alb*(SKYU*hemi[...,None]+SKYD*(1-hemi)[...,None])*ao[...,None]
    Hv=SUN.astype(np.float32)+Vd; Hv=Hv/np.maximum(np.linalg.norm(Hv,axis=2,keepdims=True),1e-9)
    ndh=np.clip((N*Hv).sum(2),0,1); ndv=np.clip((N*Vd).sum(2),0,1)
    a2=np.maximum(rgh*rgh,0.008)**2                     # GGX
    dd=ndh*ndh*(a2-1.0)+1.0
    Dg=a2/(pi*dd*dd)
    kv=np.maximum(rgh,0.05)**2/2.0
    Gg=(ndl/(ndl*(1-kv)+kv+1e-6))*(ndv/(ndv*(1-kv)+kv+1e-6))
    fres=spc+(1.0-spc)*np.power(1.0-ndv,5.0)
    sp=np.clip(Dg*Gg*fres*0.25,0,8.0)*lit*ndl
    fill=alb*np.clip((N*FILLD).sum(2),0,1)[...,None]*FILLC*(0.45+0.55*AO2[yy:ye])[...,None]
    col=diff+amb+fill+sp[...,None]*SUNC
    # --- aerial perspective on distant ground
    dist=Vl[...,0]
    fog=1.0-np.exp(-np.clip(dist-20.0,0,None)/150.0)
    HAZE=np.array([0.66,0.695,0.745],dtype=np.float32)
    col=col*(1-fog[...,None])+HAZE*fog[...,None]

    # --- sky for background pixels
    px=(np.arange(W)+0.5)[None,:]-W/2; py=(np.arange(yy,ye)+0.5)[:,None]-H/2
    rd=(rv[None,None,:]*px[...,None]+uv[None,None,:]*(-py[...,None])+fv[None,None,:]*fl)
    rd=rd/np.linalg.norm(rd,axis=2,keepdims=True)
    ey=np.clip(rd[...,1],0,1)
    sky=(np.array([0.46,0.60,0.80],dtype=np.float32)*ey[...,None]
         +np.array([0.80,0.82,0.84],dtype=np.float32)*(1-ey[...,None]))
    glow=np.clip((rd*SUN.astype(np.float32)).sum(2),0,1)**42
    sky=sky+np.array([1.0,0.92,0.78],dtype=np.float32)*glow[...,None]*0.55
    img[yy:ye]=np.where(hit[...,None],col,sky)
print("shaded")

# ============================================================ post
thr=np.clip(img-0.90,0,None)
bl=thr.reshape(H//10,10,W//10,10,3).mean(axis=(1,3))
for _ in range(5):
    bl=(bl+np.roll(bl,1,0)+np.roll(bl,-1,0)+np.roll(bl,1,1)+np.roll(bl,-1,1))/5.0
img=img+np.repeat(np.repeat(bl,10,0),10,1)*0.60
x=img*0.90
x=(x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14)          # ACES-ish filmic
x=np.clip(x,0,1)**(1/2.2)
gx=(np.arange(W)+0.5)/W-0.5; gy=(np.arange(H)+0.5)/H-0.5
vig=1.0-0.30*((gx[None,:]**2)*1.5+(gy[:,None]**2)*2.0)
x*=vig[...,None]
out=np.clip(x.reshape(OH,SS,OW,SS,3).mean(axis=(1,3)),0,1)
data=(out*255).astype(np.uint8)
raw=b''.join(b'\x00'+data[y].tobytes() for y in range(OH))
ch=lambda tg,pl: struct.pack('>I',len(pl))+tg+pl+struct.pack('>I',zlib.crc32(tg+pl)&0xffffffff)
open(OUT+"tank_photoreal.png","wb").write(b'\x89PNG\r\n\x1a\n'
  +ch(b'IHDR',struct.pack('>IIBBBBB',OW,OH,8,2,0,0,0))
  +ch(b'IDAT',zlib.compress(raw,9))+ch(b'IEND',b''))

keep=[i for i in range(nt) if TMa[i]!=GRD]
with open(OUT+"tank_photoreal.obj","w") as fo:
    fo.write("# procedural MBT, metres, Y-up, Z-forward\no Tank\n")
    for i in keep:
        for v in TPa[i]: fo.write("v %.4f %.4f %.4f\n"%tuple(v))
    for k in range(len(keep)): fo.write("f %d %d %d\n"%(3*k+1,3*k+2,3*k+3))
print("obj tris:",len(keep))
