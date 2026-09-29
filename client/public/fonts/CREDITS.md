# Font credits

The interface (parchment and ink, `client/style.css`) uses four families, all under the
[SIL Open Font License 1.1](https://openfontlicense.org). Each licence text sits next to its font.
The files here are **subsets** made for web delivery by `scripts/fonts/subset.py` (fontTools
`pyftsubset`, WOFF2, hinting removed); no glyph was otherwise changed.

| File | Family | Used for | Upstream | Licence |
|---|---|---|---|---|
| `LXGWWenKai-Regular.woff2`, `LXGWWenKai-Medium.woff2` | LXGW WenKai 霞鹜文楷 | all Chinese body text | [lxgw/LxgwWenKai](https://github.com/lxgw/LxgwWenKai) | `LXGWWenKai-OFL.txt` (subsetting for web fonts is covered by its additional permission) |
| `MaShanZheng-ui.woff2` | Ma Shan Zheng 马善政毛笔楷书 | brush headings only | [googlefonts/mashanzheng](https://github.com/googlefonts/mashanzheng) | `MaShanZheng-OFL.txt` |
| `CormorantGaramond.woff2`, `CormorantGaramond-Italic.woff2` | Cormorant Garamond | Latin spell names (italic), numerals (lining) | [CatharsisFonts/Cormorant](https://github.com/CatharsisFonts/Cormorant) | `CormorantGaramond-OFL.txt` |
| `CourierPrime.woff2` | Courier Prime | Runes source code, pairing codes | [quoteunquoteapps/CourierPrime](https://github.com/quoteunquoteapps/CourierPrime) | `CourierPrime-OFL.txt` |

Coverage: the Chinese body font holds the 3500 common characters plus every CJK character in
`client/` and `src/` (everything the game can show); the brush font holds the characters of the UI,
the shared names and the seals. Anything else (a rare character in a player's name) falls back to the
system's serif. Re-run the script when new Chinese text lands in the sources.
