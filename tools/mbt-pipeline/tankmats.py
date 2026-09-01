"""Material library for the MBT generator - consumed by assetpipe --materials."""
import _mats as M
def library():
    return {
        "Hull":     M.mat_camo("Camo_Hull"),
        "Turret":   M.mat_camo("Camo_Turret"),
        # differentiated so the vehicle stops reading as one material family
        "Track":    M.mat_metal("Track",(0.028,0.024,0.020),0.64,0.88,rust=0.62,bumpscale=150,bumpstr=0.52),
        "Rubber":   M.mat_metal("Rubber",(0.0082,0.0084,0.0081),0.96,0.0,bumpscale=240,bumpstr=0.38),
        "Steel":    M.mat_metal("Steel",(0.049,0.048,0.046),0.42,0.92,rust=0.14,bumpscale=120,bumpstr=0.26),
        "Fittings": M.mat_metal("Fittings",(0.013,0.014,0.013),0.72,0.34,bumpscale=130,bumpstr=0.24),
        "Optics":   M.mat_optics(),
        "Canvas":   M.mat_metal("Canvas",(0.046,0.040,0.029),0.97,0.0,bumpscale=330,bumpstr=0.80),
    }
