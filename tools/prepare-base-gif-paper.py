"""Rebuild clean event parchment from the current Russian short tactics.

Pillow, NumPy and opencv-python-headless are required. Original faces are read-only. The full native parchment,
including shading and edges, is retained; only dark ink inside the checked
wording rectangle is filled from neighbouring parchment. No online/library
wording or substitute artwork is used.
"""
import json
from pathlib import Path
from PIL import Image, ImageDraw
import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / 'page'
# (Russian donor, checked rectangle containing printed text).
SOURCES = {
    'base/chaos': ('e_5.jpg', (.045, .68, .90, .105)),
    'base/ork': ('e_8.jpg', (.045, .68, .90, .105)),
    'base/eldar': ('e_8.jpg', (.045, .68, .90, .105)),
    'gif/ig': ('e_6.jpg', (.045, .68, .90, .18)),
    'gif/necron': ('e_8.jpg', (.045, .68, .90, .105)),
    'gif/tyranid': ('e_5.jpg', (.045, .68, .90, .105)),
}

def rect(box, w, h):
    x, y, bw, bh = box
    return (round(x*w), round(y*h), round((x+bw)*w), round((y+bh)*h))

def build():
    for faction, (file, ink) in SOURCES.items():
        src = PAGE / 'factions' / faction / 'events' / file
        image = Image.open(src).convert('RGB')
        w, h = image.size
        region = Image.new('L', image.size)
        ImageDraw.Draw(region).rectangle(rect(ink, w, h), fill=255)
        pixels = np.array(image)
        mask = (cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY) < 190).astype(np.uint8) * 255
        mask = cv2.dilate(mask, np.ones((3, 3), np.uint8))
        mask = cv2.bitwise_and(mask, np.array(region))
        # Fill just printed ink from neighbouring parchment, retaining the
        # native paper gradient and frame instead of inserting a white rectangle.
        clean = Image.fromarray(cv2.inpaint(pixels, mask, 3, cv2.INPAINT_TELEA))
        clean = clean.crop(rect((.04, .675, .92, .275), w, h))
        dest = PAGE / 'pictures/templates' / (faction.replace('/', '-') + '-event-paper.png')
        dest.parent.mkdir(parents=True, exist_ok=True)
        clean.save(dest, optimize=True)
        print(dest.relative_to(ROOT))

if __name__ == '__main__':
    build()
