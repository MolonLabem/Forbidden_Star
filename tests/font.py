"""Optional font authoring checks; requires fonttools[woff] and Brotli."""
from pathlib import Path
from tempfile import TemporaryDirectory
import subprocess
import sys
import unittest
from xml.etree import ElementTree
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]

class TokenFontTests(unittest.TestCase):
    def test_original_glyphs_and_character_metrics_are_preserved(self):
        before = TTFont(ROOT / 'tools/font-source/ForbiddenStars.base.woff2')
        after = TTFont(ROOT / 'page/fonts/ForbiddenStars.woff2')
        for codepoint, name in before.getBestCmap().items():
            self.assertEqual(after.getBestCmap()[codepoint], name)
        for name in before.getGlyphOrder():
            self.assertEqual(after['hmtx'].metrics[name], before['hmtx'].metrics[name])
            self.assertEqual(after['glyf'][name].compile(after['glyf']), before['glyf'][name].compile(before['glyf']))
        names = [after.getBestCmap()[c] for c in [0xE100, 0xE101, 0xE102]]
        self.assertEqual(len(set(names)), 3)
        self.assertTrue(all(after['glyf'][name].numberOfContours > 0 for name in names))

    def test_tokens_share_the_existing_combat_token_circle_and_metrics(self):
        font = TTFont(ROOT / 'page/fonts/ForbiddenStars.woff2')
        cmap = font.getBestCmap()
        reference = font['glyf'][cmap[ord('#')]]
        for key, codepoint in [('forge', 0xE100), ('reinforce', 0xE101), ('cache', 0xE102)]:
            name = cmap[codepoint]
            glyph = font['glyf'][name]
            self.assertEqual(font['hmtx'].metrics[name], font['hmtx'].metrics[cmap[ord('#')]])
            for coordinate in ['xMin', 'yMin', 'xMax', 'yMax']:
                self.assertLessEqual(abs(getattr(glyph, coordinate) - getattr(reference, coordinate)), 1)
            svg = ElementTree.parse(ROOT / 'page/fonts/tokens' / (key + '.svg'))
            # One filled outline contains both circle and transparent emblem
            # counters. Separate SVG paint layers would fill those cut-outs.
            self.assertEqual(len(list(svg.iter('{http://www.w3.org/2000/svg}path'))), 1)
            self.assertFalse(list(svg.iter('{http://www.w3.org/2000/svg}image')))

    def test_rebuild_is_reproducible_and_supports_an_already_extended_font(self):
        with TemporaryDirectory() as directory:
            first = Path(directory) / 'first.woff2'
            second = Path(directory) / 'second.woff2'
            command = [sys.executable, str(ROOT / 'tools/build-token-font.py')]
            subprocess.run(command + ['--output', str(first)], check=True)
            self.assertEqual(first.read_bytes(), (ROOT / 'page/fonts/ForbiddenStars.woff2').read_bytes())
            subprocess.run(command + ['--source', str(first), '--output', str(second)], check=True)
            self.assertEqual(first.read_bytes(), second.read_bytes())

if __name__ == '__main__':
    unittest.main()
