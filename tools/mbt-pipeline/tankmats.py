"""Material library for the MBT generator - consumed by assetpipe --materials."""
import _mats as M
def library():
    return {
        "Hull":     M.mat_camo("Camo_Hull"),
        "Turret":   M.mat_camo("Camo_Turret"),
        "Track":    M.mat_metal("Track",(0.030,0.026,0.022),0.58,0.90,rust=0.55,bumpscale=140,bumpstr=0.45),
        "Rubber":   M.mat_metal("Rubber",(0.0105,0.0107,0.0104),0.90,0.0,bumpscale=180,bumpstr=0.30),
        "Steel":    M.mat_metal("Steel",(0.045,0.044,0.042),0.52,0.85,rust=0.18,bumpscale=110,bumpstr=0.30),
        "Fittings": M.mat_metal("Fittings",(0.014,0.015,0.014),0.66,0.30,bumpscale=120,bumpstr=0.25),
        "Optics":   M.mat_optics(),
        "Canvas":   M.mat_metal("Canvas",(0.052,0.046,0.033),0.95,0.0,bumpscale=210,bumpstr=0.55),
    }
