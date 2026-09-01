"""Generic tracked-vehicle animation rig.

Given a Blender scene that already holds a vehicle hierarchy
(Hull -> Turret -> Gun, with wheel / sprocket / idler / roller / track-link
objects parented to the hull), this keyframes a physically consistent
performance and hands the per-frame solution back so the caller can drive
lights, dust and the camera from the same numbers:

  * chassis rides an analytic terrain: 4-point contact solve feeding a
    second-order suspension (so the body bobs and overshoots, it does not
    snap to the ground)
  * every wheel spins at theta = d / r, locked to travel distance -- no
    slip, so the contact patch is stationary in world space
  * track links scroll around the authored loop at the same arc rate
  * turret and gun are rate-limited servos that track a world target
  * the gun fires when it is on target: recoil stroke, counter-recoil with
    overshoot, and a hull rock impulse

Nothing below is specific to one model except the name patterns in ROLES.
"""
import bpy, math, re
from mathutils import Vector, Matrix, Quaternion, Euler

FPS = 24

ROLES = {
    "hull":    re.compile(r"^Hull$"),
    "turret":  re.compile(r"^Turret$"),
    "gun":     re.compile(r"^Gun$"),
    "wheel":   re.compile(r"^(Wheel|Sprocket|Idler|Roller)_"),
    "link":    re.compile(r"^Link_([LR])_(\d+)$"),
}

# ------------------------------------------------------------------ terrain
def terrain(x, y):
    """Ground height in metres.  The berm at y=+1 is what the tank climbs.

    Everything fades to a dead-flat plain past ~24 m so a coarse far-ground
    plane can carry the horizon without cracking against the detailed patch.
    """
    h  = 0.40 * math.exp(-((y - 1.0) / 2.10) ** 2)        # cross-path berm
    h += -0.11 * math.exp(-((y + 3.2) / 1.70) ** 2)       # scoop past the crest
    h += 0.055 * math.sin(1.70 * x + 0.4) * math.sin(2.10 * y)
    h += 0.028 * math.sin(5.10 * x) * math.cos(4.30 * y + 1.1)
    r = math.hypot(x, y + 1.0)
    w = min(1.0, max(0.0, (24.0 - r) / 9.0))
    return h * w * w * (3 - 2 * w)

# ------------------------------------------------------------------ driving
def speed(t):
    """Forward speed in m/s.  Accelerate, hold, brake to a slow crawl to shoot."""
    if t < 0.55: return 2.55 + (3.55 - 2.55) * (t / 0.55)
    if t < 2.35: return 3.55
    if t < 3.15:
        u = (t - 2.35) / 0.80
        return 3.55 + (1.00 - 3.55) * (u * u * (3 - 2 * u))   # smoothstep brake
    return 1.00

def _travel(nf):
    """Cumulative distance per frame, trapezoid rule on speed()."""
    dt = 1.0 / FPS
    d = [0.0]
    for i in range(1, nf):
        t0, t1 = (i - 1) * dt, i * dt
        d.append(d[-1] + 0.5 * (speed(t0) + speed(t1)) * dt)
    return d

# ------------------------------------------------------------------ helpers
def classify(objs):
    out = {"wheel": [], "link": {}}
    for o in objs:
        for k, rx in ROLES.items():
            m = rx.match(o.name)
            if not m: continue
            if k == "link":
                out["link"].setdefault(m.group(1), {})[int(m.group(2))] = o
            elif k == "wheel":
                out["wheel"].append(o)
            else:
                out[k] = o
    return out

def bbox_world(o):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for c in o.bound_box:
        p = o.matrix_world @ Vector(c)
        for i in range(3):
            lo[i] = min(lo[i], p[i]); hi[i] = max(hi[i], p[i])
    return lo, hi

def radius_of(o):
    """Rolling radius from the object's own extent in the Y/Z plane."""
    lo, hi = bbox_world(o)
    return max(hi.z - lo.z, hi.y - lo.y) * 0.5

class SO2:
    """Second-order critically-ish damped follower: the suspension."""
    def __init__(self, x0, f_hz, zeta):
        self.x = x0; self.v = 0.0
        self.w = 2 * math.pi * f_hz; self.z = zeta
    def step(self, target, dt):
        a = self.w * self.w * (target - self.x) - 2 * self.z * self.w * self.v
        self.v += a * dt; self.x += self.v * dt
        return self.x

def _key(o, path, frame, index=-1):
    o.keyframe_insert(data_path=path, frame=frame, index=index)

_QPREV = {}
def set_local(o, L, frame):
    """Place o so its matrix relative to its parent is L, then key it.

    Parenting in Blender is matrix_world = parent_world @ parent_inverse @ basis,
    so the basis we actually have to write is parent_inverse^-1 @ L.  Going
    through the basis (instead of assigning matrix_world) means the parent's
    own animation does not have to be evaluated first.
    """
    M = o.matrix_parent_inverse.inverted() @ L if o.parent else L
    q = M.to_quaternion()
    pq = _QPREV.get(o)
    if pq is not None and q.dot(pq) < 0.0:
        q.negate()                      # keep the quaternion track continuous
    _QPREV[o] = q
    o.rotation_mode = 'QUATERNION'
    o.location = M.translation
    o.rotation_quaternion = q
    _key(o, "location", frame); _key(o, "rotation_quaternion", frame)

def about(pivot, R):
    """rotation R applied about a point, as a 4x4"""
    return Matrix.Translation(pivot) @ R.to_4x4() @ Matrix.Translation(-pivot)

def fcurves(act):
    """Blender 5 moved F-curves into slotted action layers; 4.x kept them flat."""
    if hasattr(act, "fcurves"):
        return list(act.fcurves)
    out = []
    for lay in act.layers:
        for st in lay.strips:
            for cb in getattr(st, "channelbags", []):
                out += list(cb.fcurves)
    return out

def linearize(_=None):
    """Dense per-frame keys must not be Bezier: the handles overshoot, which
    puts negative values into volume density and light energy."""
    n = 0
    for act in bpy.data.actions:
        for fc in fcurves(act):
            k = len(fc.keyframe_points)
            if not k: continue
            fc.keyframe_points.foreach_set("interpolation", [1] * k)   # LINEAR
            fc.update(); n += 1
    return n

# ------------------------------------------------------------------ the rig
def rig(objs, nf=120, target=Vector((-11.5, -17.0, 1.35)),
        fire_earliest=58, start_y=6.4, traverse_from=20,
        recoil_stroke=0.40, verbose=True):
    """Keyframe frames 1..nf.  Returns the per-frame solution."""
    P = classify(objs)
    hull, tur, gun = P["hull"], P["turret"], P["gun"]
    wheels = P["wheel"]; links = P["link"]
    dt = 1.0 / FPS

    # --- rest state -------------------------------------------------------
    bpy.context.view_layer.update()
    rest = {o: o.matrix_world.copy() for o in objs}
    hull_rest = rest[hull]
    hull_z0 = hull_rest.translation.z
    wpos = {o: rest[o].translation.copy() for o in wheels}
    hy0 = hull_rest.translation.y
    # contact geometry, expressed relative to the hull origin so it can ride
    # along with the hull instead of staying at the authored position
    ys = [p.y - hy0 for p in wpos.values()]; xs = [p.x for p in wpos.values()]
    yF, yR = min(ys), max(ys)                 # forward is -Y
    xL = sum(x for x in xs if x < 0) / max(1, sum(1 for x in xs if x < 0))
    xR = sum(x for x in xs if x > 0) / max(1, sum(1 for x in xs if x > 0))
    WB = abs(yR - yF); TWD = abs(xR - xL)
    # rolling radius: the disc's own radius for road wheels, but the sprocket
    # and idler are wrapped by the track, so they turn at the loop's end radius.
    linkpos = [rest[o].translation for d in links.values() for o in d.values()]
    def wrap_radius(o):
        """distance from a wheel centre to the links wrapped around it -- the
        pitch radius, which is what a sprocket or idler actually rolls on."""
        c = rest[o].translation
        ds = sorted((p - c).length for p in linkpos)[:9]
        return sum(ds) / len(ds)
    rad = {}
    for o in wheels:
        r = radius_of(o)
        if linkpos and o.name.startswith(("Sprocket", "Idler")):
            r = wrap_radius(o)               # track pitch radius, not the disc
        rad[o] = r

    # ---- bore geometry.  The turret is authored pre-rotated, so the rest bore
    # azimuth has to be measured, not assumed to be straight ahead.
    gv = [v.co for v in gun.data.vertices]
    _y0 = min(c.y for c in gv)
    _face = [c for c in gv if c.y < _y0 + 0.12]           # muzzle end cap
    muz_local = Vector((sum(c.x for c in _face), sum(c.y for c in _face),
                        sum(c.z for c in _face))) / len(_face)
    muz_w = rest[gun] @ muz_local
    tp = rest[tur].translation
    psi0 = math.atan2(muz_w.x - tp.x, -(muz_w.y - tp.y))

    # --- link loop geometry, in hull-local space at rest -------------------
    # A link's pose is a frame that slides along the loop.  Building the
    # rotation straight from the local tangent (instead of an angle) keeps it
    # continuous across the sprocket wrap, where atan2 would jump by 2*pi.
    hinv = hull_rest.inverted()

    def frame_from(c, tang):
        u = tang.normalized()
        return Matrix.Translation(c) @ Matrix(((1, 0, 0),
                                               (0, u.y, -u.z),
                                               (0, u.z, u.y))).to_4x4()

    slots = {}
    for side, d in links.items():
        n = len(d)
        cs = [(hinv @ rest[d[k]]).translation.copy() for k in range(n)]
        tg = [cs[(k + 1) % n] - cs[k] for k in range(n)]
        poses = [frame_from(cs[k], tg[k]) for k in range(n)]

        def at(sf, cs=cs, tg=tg, n=n):
            """pose at a fractional slot position -- position and tangent are
            both lerped, so the frame is continuous all the way round."""
            j = math.floor(sf) % n; u = sf - math.floor(sf)
            return frame_from(cs[j].lerp(cs[(j + 1) % n], u),
                              tg[j].lerp(tg[(j + 1) % n], u))

        per = sum(t.length for t in tg)
        slots[side] = (poses, at, per / n, n)
        if verbose:
            print("  track %s: %d links, pitch %.4f m, perimeter %.3f m"
                  % (side, n, per / n, per))

    # --- travel + chassis solve ------------------------------------------
    D = _travel(nf)
    sz = SO2(hull_z0, 1.55, 0.44)
    sp = SO2(0.0, 1.35, 0.40)
    sr = SO2(0.0, 2.10, 0.52)

    sol = {"d": D, "z": [], "pitch": [], "roll": [], "y": [],
           "yaw": [], "elev": [], "recoil": [], "fire": None, "err": []}

    # servo state
    yaw = 0.0; elev = 0.0
    YAW_RATE = math.radians(26.0); EL_RATE = math.radians(9.0)
    fire = None; kick_f = None

    tur_piv = rest[tur].translation - Vector((0.0, hy0, 0.0))
    Rz = Matrix.Rotation(psi0, 3, 'Z')
    # rest matrices in each object's own parent space
    L_tur = hinv @ rest[tur]
    L_gun = rest[tur].inverted() @ rest[gun]
    L_wh  = {o: hinv @ rest[o] for o in wheels}
    L_lnk = {o: hinv @ rest[o] for d in links.values() for o in d.values()}
    R0_hull = hull_rest.to_3x3().to_4x4()   # keep whatever rest orientation it had
    _QPREV.clear()

    for f in range(nf):
        t = f * dt
        d = D[f]
        cy = start_y - d                       # hull origin Y this frame

        # sample the whole track footprint, not just the corners: the ride height
        # has to clear the highest point under the tracks or the hull ploughs
        # through the berm it is supposed to be driving over
        NS = 7
        ysamp = [yF + (yR - yF) * i / (NS - 1.0) for i in range(NS)]
        hL = [terrain(xL, y + cy) for y in ysamp]
        hR_ = [terrain(xR, y + cy) for y in ysamp]
        hs = hL + hR_
        hF = 0.5 * (hL[0] + hR_[0]); hR = 0.5 * (hL[-1] + hR_[-1])
        hLs = sum(hL) / NS; hRs = sum(hR_) / NS

        z_t  = hull_z0 + max(sum(hs) / len(hs), max(hs) - 0.28)
        p_t  = -math.atan2(hF - hR, WB)
        r_t  = -math.atan2(hRs - hLs, TWD)

        z = sz.step(z_t, dt); p = sp.step(p_t, dt); r = sr.step(r_t, dt)

        # engine idle / running gear buzz
        z += 0.0035 * math.sin(2 * math.pi * 10.5 * t)
        p += math.radians(0.07) * math.sin(2 * math.pi * 13.1 * t + 0.7)
        r += math.radians(0.11) * math.sin(2 * math.pi * 6.7 * t + 0.9)

        # ---- turret / gun servos, tracking the world target
        piv_w = Vector((tur_piv.x, tur_piv.y + cy, tur_piv.z + (z - hull_z0)))
        dxy = Vector((target.x - piv_w.x, target.y - piv_w.y))
        want_yaw = math.atan2(dxy.x, -dxy.y) - psi0     # relative to the rest bore
        want_el  = math.atan2(target.z - piv_w.z, dxy.length) + math.radians(0.9)
        if f >= traverse_from:
            yaw += max(-YAW_RATE * dt, min(YAW_RATE * dt, want_yaw - yaw))
            elev += max(-EL_RATE * dt, min(EL_RATE * dt, want_el - elev))
        err = math.hypot(want_yaw - yaw, want_el - elev)
        sol["err"].append(err)

        if fire is None and f >= fire_earliest and err < math.radians(0.45):
            fire = f; kick_f = f

        # ---- recoil: 3-frame stroke, then damped counter-recoil
        rc = 0.0
        if fire is not None and f >= fire:
            k = f - fire
            if k <= 3:
                u = k / 3.0
                rc = recoil_stroke * (1 - (1 - u) ** 3)
            else:
                tau = (k - 3) * dt
                rc = recoil_stroke * math.exp(-6.2 * tau) * math.cos(2 * math.pi * 1.55 * tau)
        # ---- hull rock from the shot
        if kick_f is not None and f >= kick_f:
            tau = (f - kick_f) * dt
            kk = math.exp(-6.5 * tau) * math.sin(2 * math.pi * 2.4 * tau)
            p += math.radians(0.95) * kk
            z += 0.014 * kk
            cy += 0.055 * kk                   # shoved backwards (+Y)

        sol["z"].append(z); sol["pitch"].append(p); sol["roll"].append(r)
        sol["y"].append(cy); sol["yaw"].append(yaw); sol["elev"].append(elev)
        sol["recoil"].append(rc)

        # ================================================== keyframes
        fr = f + 1
        set_local(hull, Matrix.Translation((hull_rest.translation.x, cy, z))
                        @ Matrix.Rotation(p, 4, 'X') @ Matrix.Rotation(r, 4, 'Y')
                        @ R0_hull, fr)

        set_local(tur, about(L_tur.translation, Matrix.Rotation(yaw, 3, 'Z')) @ L_tur, fr)

        # elevate about the trunnion axis: the bore axis turned 90 deg
        Rg = Rz @ Matrix.Rotation(-elev, 3, 'X') @ Rz.transposed()
        bore = (Rg @ (Rz @ Vector((0.0, -1.0, 0.0)))).normalized()
        set_local(gun, Matrix.Translation(-bore * rc)
                       @ about(L_gun.translation, Rg) @ L_gun, fr)

        for o in wheels:
            L = L_wh[o]
            set_local(o, about(L.translation,
                               Matrix.Rotation(d / rad[o], 3, 'X')) @ L, fr)

        for side, (poses, at, pitchlen, n) in slots.items():
            off = d / pitchlen
            for k, o in links[side].items():
                # carry link k from its own slot frame onto slot k+off
                set_local(o, at(k + off) @ poses[k].inverted() @ L_lnk[o], fr)

    linearize(objs)
    sol["fire"] = fire
    sol["muz_local"] = muz_local
    sol["psi0"] = psi0
    if verbose:
        print("  rest bore azimuth %.2f deg (turret is authored pre-traversed)"
              % math.degrees(psi0))
    if verbose:
        print("  travel %.2f m over %d frames (%.2f s)" % (D[-1], nf, nf / FPS))
        print("  traverse %.1f deg, elevation %.2f deg"
              % (math.degrees(sol["yaw"][-1]), math.degrees(sol["elev"][-1])))
        print("  FIRE at frame %s (t=%.2fs), aim error %.3f deg"
              % (fire, (fire or 0) / FPS, math.degrees(sol["err"][fire or 0])))
    return sol
