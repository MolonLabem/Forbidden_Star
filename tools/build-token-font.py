#!/usr/bin/env python3
"""Add editable SVG token outlines without changing existing letters/dice.

Requires fonttools[woff] (including brotli). Re-running replaces only E100–E102.
"""
import argparse
from pathlib import Path
from xml.etree import ElementTree
from fontTools.ttLib import TTFont
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.svgLib.path import parse_path

ROOT = Path(__file__).resolve().parents[1]
TOKENS = {'forge': 0xE100, 'reinforce': 0xE101, 'cache': 0xE102}

def build(source, output):
    font = TTFont(source, recalcTimestamp=False)
    original_cmap = dict(font.getBestCmap())
    token_names = {original_cmap.get(codepoint, 'token_' + key) for key, codepoint in TOKENS.items()}
    original_glyphs = {name: font['glyf'][name].compile(font['glyf']) for name in font.getGlyphOrder() if name not in token_names}
    order = font.getGlyphOrder()
    # Use the existing bolter-token circle's size, baseline and advance. The SVG
    # masters reuse that very outline and cut the original TTS emblem out of it.
    reference_name = original_cmap[ord('#')]
    reference = font['glyf'][reference_name]
    icon_transform = ((reference.xMax - reference.xMin) / 1000, 0, 0,
                      -(reference.yMax - reference.yMin) / 1000,
                      reference.xMin, reference.yMax)
    for key, codepoint in TOKENS.items():
        # WOFF2/post format 3 may reconstruct names as uniE100 on reload.
        name = original_cmap.get(codepoint, 'token_' + key)
        pen = TTGlyphPen(font.getGlyphSet())
        svg_pen = TransformPen(Cu2QuPen(pen, max_err=1.0, reverse_direction=False), icon_transform)
        svg = ElementTree.parse(ROOT / 'page/fonts/tokens' / (key + '.svg'))
        for path in svg.iter('{http://www.w3.org/2000/svg}path'):
            parse_path(path.attrib['d'], svg_pen)
        font['glyf'][name] = pen.glyph()
        font['hmtx'].metrics[name] = font['hmtx'].metrics[reference_name]
        if name not in order:
            order.append(name)
        for table in font['cmap'].tables:
            if table.isUnicode() and table.format in (4, 12):
                table.cmap[codepoint] = name
    font.setGlyphOrder(order)
    assert all(font.getBestCmap()[c] == g for c, g in original_cmap.items())
    assert all(font['glyf'][name].compile(font['glyf']) == data for name, data in original_glyphs.items())
    font.flavor = 'woff2'
    font.save(output)
    print('Added forge U+E100, reinforcement U+E101, cache U+E102; existing glyphs preserved.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=ROOT / 'tools/font-source/ForbiddenStars.base.woff2')
    parser.add_argument('--output', type=Path, default=ROOT / 'page/fonts/ForbiddenStars.woff2')
    args = parser.parse_args()
    build(args.source, args.output)
