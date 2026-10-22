#!/usr/bin/env python3
"""Build inline token images from the original TTS textures (requires Pillow).

Read source URLs and hashes from the SVG masters. Put the unchanged downloads
in --source-dir as forge.jpg, reinforce.jpg and cache.jpg; no network is used.
"""
import argparse
import hashlib
import json
from pathlib import Path
from xml.etree import ElementTree
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]


def build(source_dir, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    for key in ['forge', 'reinforce', 'cache']:
        svg = ElementTree.parse(ROOT / 'page/fonts/tokens' / (key + '.svg'))
        metadata = json.loads(svg.find('{http://www.w3.org/2000/svg}metadata').text)
        source = source_dir / (key + '.jpg')
        if hashlib.sha256(source.read_bytes()).hexdigest() != metadata['sha256']:
            raise ValueError('Unexpected original token texture: ' + str(source))
        x, y, width, height = metadata['disc']
        with Image.open(source) as original:
            image = original.convert('RGBA').crop((x, y, x + width, y + height))
        # Only the obverse disc. Remove the reverse, labels and UV edge strip.
        alpha = Image.new('L', (width * 4, height * 4))
        ImageDraw.Draw(alpha).ellipse((0, 0, width * 4 - 1, height * 4 - 1), fill=255)
        image.putalpha(alpha.resize((width, height), Image.Resampling.LANCZOS))
        rotation = metadata.get('rotationDegreesClockwise', 0)
        if rotation:
            if rotation != 90:
                raise ValueError('Unsupported token rotation')
            image = image.transpose(Image.Transpose.ROTATE_270)
        image.save(output_dir / (key + '.png'), optimize=True)
        print('Built original obverse icon: ' + key)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-dir', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'page/pictures/tokens')
    args = parser.parse_args()
    build(args.source_dir, args.output_dir)
