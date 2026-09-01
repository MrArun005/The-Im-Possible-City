"""PNG frame sequence -> H.264 MP4 through Blender's bundled FFmpeg (no system
ffmpeg needed), plus a contact sheet of key frames.

env: FRAMES=frames_drive  OUT=MBT_drive.mp4  FPS=24  SHEET=contact.png
     KEYS=1,30,47,66,67,80,120   (frames for the contact sheet)
"""
import bpy, os, glob, sys
FR   = os.environ.get("FRAMES", "frames_drive")
OUT  = os.path.abspath(os.environ.get("OUT", "MBT_drive.mp4"))
FPS  = int(os.environ.get("FPS", "24"))
KEYS = [int(k) for k in os.environ.get("KEYS", "1,30,47,66,67,80,120").split(",")]
SHEET = os.environ.get("SHEET", "contact.png")

files = sorted(glob.glob(os.path.join(FR, "*.png")))
assert files, "no frames in " + FR
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
im = bpy.data.images.load(files[0]); W, H = im.size; bpy.data.images.remove(im)
sc.render.resolution_x = W; sc.render.resolution_y = H; sc.render.resolution_percentage = 100
sc.render.fps = FPS; sc.frame_start = 1; sc.frame_end = len(files)
if not sc.sequence_editor: sc.sequence_editor_create()
ed = sc.sequence_editor
strip = ed.sequences.new_image("frames", files[0], 1, 1) if hasattr(ed, "sequences") \
        else ed.strips.new_image("frames", files[0], 1, 1)
for f in files[1:]:
    strip.elements.append(os.path.basename(f))
sc.render.image_settings.file_format = 'FFMPEG'
sc.render.ffmpeg.format = 'MPEG4'; sc.render.ffmpeg.codec = 'H264'
sc.render.ffmpeg.constant_rate_factor = 'HIGH'; sc.render.ffmpeg.gopsize = 12
sc.render.filepath = OUT
sc.view_settings.view_transform = 'Standard'      # frames are already display-referred
bpy.ops.render.render(animation=True)
print("WROTE", OUT, "%.1f MB, %d frames @ %d fps" % (os.path.getsize(OUT)/1e6, len(files), FPS))

# ---- contact sheet: key frames tiled, labelled by frame number in the filename
import numpy as np
tiles = []
for k in KEYS:
    p = files[min(len(files), max(1, k)) - 1]
    im = bpy.data.images.load(p)
    a = np.array(im.pixels[:]).reshape(H, W, 4)[::-1]
    bpy.data.images.remove(im)
    tiles.append(a[::2, ::2])                      # half-size
th, tw = tiles[0].shape[:2]
cols = 3 if len(tiles) > 4 else 2
rows = (len(tiles) + cols - 1) // cols
sheet = np.zeros((rows*th, cols*tw, 4)); sheet[..., 3] = 1
for i, t in enumerate(tiles):
    r, c = divmod(i, cols)
    sheet[r*th:(r+1)*th, c*tw:(c+1)*tw] = t
out = bpy.data.images.new("sheet", cols*tw, rows*th, alpha=True)
out.pixels = sheet[::-1].ravel().tolist()
out.filepath_raw = os.path.abspath(SHEET); out.file_format = 'PNG'; out.save()
print("WROTE", SHEET, "keys", KEYS)
