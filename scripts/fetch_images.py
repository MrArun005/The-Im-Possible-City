#!/usr/bin/env python3
"""Download and verify HD photos for every slot in assets/images.json.

Each slot lists an Unsplash photo id (tried first) and a Wikimedia Commons search
query (fallback). Files are written to assets/img/<slot>.jpg and credits to
assets/credits.json. Runs on GitHub Actions where the internet is reachable.
"""
import json, os, sys, urllib.request, urllib.parse, io, struct, re, html

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MAN=json.load(open(os.path.join(ROOT,"assets/images.json")))
OUT=os.path.join(ROOT,"assets/img"); os.makedirs(OUT,exist_ok=True)
CRED_PATH=os.path.join(ROOT,"assets/credits.json")
credits=json.load(open(CRED_PATH)) if os.path.exists(CRED_PATH) else {}
UA={"User-Agent":"ImPossibleCity/1.0 (+https://github.com/MrArun005/The-Im-Possible-City)"}
MIN_W=1600

def get(url,timeout=60):
    req=urllib.request.Request(url,headers=UA)
    with urllib.request.urlopen(req,timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type",""), r.geturl()

def jpeg_size(b):
    if b[:2]!=b"\xff\xd8": return None
    i=2
    while i<len(b):
        if b[i]!=0xFF: return None
        m=b[i+1]; i+=2
        if m in (0xD8,0x01) or 0xD0<=m<=0xD7: continue
        L=struct.unpack(">H",b[i:i+2])[0]
        if m in (0xC0,0xC1,0xC2):
            h,w=struct.unpack(">HH",b[i+3:i+7]); return w,h
        i+=L
    return None

def good(b,ct):
    if not ct.startswith("image/") or len(b)<80_000: return False
    s=jpeg_size(b)
    return bool(s and s[0]>=MIN_W)

def ok(p):
    ii=p["imageinfo"][0]; md=ii.get("extmetadata",{})
    lic=md.get("LicenseShortName",{}).get("value","")
    w,h=ii.get("width",0),ii.get("height",0)
    return ii.get("mime")=="image/jpeg" and w>=2000 and w>=h*1.15 and w<=h*2.6 and ("CC" in lic or "Public" in lic)

def from_unsplash(pid,w=2400):
    try:
        b,ct,final=get(f"https://unsplash.com/photos/{pid}/download?force=true&w={w}")
        if good(b,ct): return b,{"source":"Unsplash","by":None,"url":f"https://unsplash.com/photos/{pid}","license":"Unsplash License"}
    except Exception as e: print("  unsplash fail",pid,e)
    return None,None

USED=set()
TIERS=[' incategory:"Featured pictures on Wikimedia Commons"',' incategory:"Quality images"','']
def commons_search(query,tier):
    q=urllib.parse.quote(f"{query} filetype:bitmap{tier}")
    api=("https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch="+q+
         "&gsrnamespace=6&gsrlimit=20&prop=imageinfo&iiprop=url|size|mime|extmetadata&iiurlwidth=2200&format=json")
    try: data=json.loads(get(api)[0])
    except Exception as e: print("  commons api fail",e); return []
    return [p for p in (data.get("query",{}).get("pages") or {}).values() if p.get("imageinfo") and p["title"] not in USED]

def from_commons(query):
    pages=[]
    for t in TIERS:
        pages=commons_search(query,t)
        pages=[p for p in pages if ok(p)]
        if pages: print("  tier:",t or "any"); break
    for p in pages[:5]:
        ii=p["imageinfo"][0]; md=ii.get("extmetadata",{})
        try:
            b,ct,_=get(ii.get("thumburl") or ii["url"])
            if good(b,ct):
                USED.add(p["title"])
                artist=re.sub("<[^>]+>","",html.unescape(md.get("Artist",{}).get("value","Unknown"))).strip()[:60]
                return b,{"source":"Wikimedia Commons","by":artist,"url":ii["descriptionurl"],"license":md.get("LicenseShortName",{}).get("value",""),"title":p["title"]}
        except Exception as e: print("  commons dl fail",e)
    return None,None

failed=[]
for slot,spec in MAN.items():
    path=os.path.join(OUT,slot+".jpg")
    if os.path.exists(path) and slot in credits and not os.environ.get("REFRESH"):
        print("skip",slot); USED.add(credits[slot].get("title","")); continue
    print("fetch",slot)
    b,c=(None,None)
    b,c=from_commons(spec["query"])
    if not b:
        failed.append(slot); print("  FAILED",slot); continue
    try:
        from PIL import Image
        im=Image.open(io.BytesIO(b)).convert("RGB")
        if im.width>2200: im=im.resize((2200,round(im.height*2200/im.width)),Image.LANCZOS)
        im.save(path,"JPEG",quality=82,optimize=True,progressive=True)
    except Exception as ex:
        print("  resize skipped",ex); open(path,"wb").write(b)
    credits[slot]=c
    print("  ok",slot,c["source"],jpeg_size(b),len(b)//1024,"KB")
json.dump(credits,open(CRED_PATH,"w"),indent=1)
print("failed:",failed)
sys.exit(1 if failed else 0)
