"""Combine preview renders into one contact sheet: python3 assets/contact.py grunt"""
import glob
import os
import sys

from PIL import Image

name = sys.argv[1]
here = os.path.dirname(__file__)
files = sorted(glob.glob(os.path.join(here, 'previews', f'{name}_*.png')), key=lambda p: int(''.join(c for c in p.rsplit('_', 1)[1] if c.isdigit()) or 0))
files = [f for f in files if not f.endswith('_sheet.png')]
imgs = [Image.open(f).convert('RGB') for f in files]
size = 384
cols = min(4, len(imgs))
rows = (len(imgs) + cols - 1) // cols
sheet = Image.new('RGB', (cols * size, rows * size), (40, 30, 20))
for i, im in enumerate(imgs):
    im = im.resize((size, size))
    sheet.paste(im, ((i % cols) * size, (i // cols) * size))
out = os.path.join(here, 'previews', f'{name}_sheet.png')
sheet.save(out)
print(out)
