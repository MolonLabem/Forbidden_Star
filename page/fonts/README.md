# Card fonts

The four `FSLazurski-*.woff2` faces contain Lazurski text outlines and the site's
existing Forbidden Stars game symbols. The CSS family remains `ForbiddenStars`
for compatibility with canvas rendering and HTML descriptions. The original
`ForbiddenStars.woff2` is retained as the symbol source; Headline titles and
EventFont labels keep their own typefaces.

## Sources and preparation

Lazurski source: [the published wFonts archive](https://www.wfonts.com/font/lazurski),
downloaded from `https://static.wfonts.com/download/data/2015/10/28/lazurski/lazurski.zip`.
The regular, italic, bold and bold italic Cyrillic files carry
`Copyright (C) 1990-1992 ParaGraph JV.`. Original copyright and embedding metadata
are retained. The archive contains no license text; availability for download
does not establish a new license or place these outlines under the site's license.

The legacy CP1251 mappings were rebuilt as Unicode from the AFII glyph names.
Outlines were normalized to 2048 units per em and old hinting was removed.
Game glyph outlines, advances and baselines were copied unchanged from
`ForbiddenStars.woff2` into all four faces. The imported glyphs retain their
source copyright and Bitstream/DejaVu notices in each font's metadata; those
notices do not relicense the Lazurski outlines. The combined family is named
`FS Lazurski` internally to distinguish the modified files.

## Stable symbol mapping

| Meaning | Existing code | Private-use alias |
| --- | --- | --- |
| Bolter on a die `[B]` | `}` U+007D | U+E200 |
| Shield on a die `[S]` | `{` U+007B | U+E201 |
| Morale on a die `[M]` | `<` U+003C | U+E202 |
| Die `[D]` | `\|` U+007C | U+E203 |
| Temporary bolter `(B)` | `#` U+0023 | U+E204 |
| Temporary shield `(S)` | `@` U+0040 | U+E205 |
| Forge token | U+E100 | U+E100 |
| Reinforcement token | U+E101 | U+E101 |
| Cache token | U+E102 | U+E102 |

All game glyphs have identical outlines and metrics in the four faces. The
cache token keeps its existing 90-degree presentation rotation in `wording.js`.
Canonical card text retains its readable notation and token wording.
