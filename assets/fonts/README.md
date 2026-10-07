# App fonts

From [Nerd Fonts](https://github.com/ryanoasis/nerd-fonts) (commit `c5dfa88`, 2026-10-06):

| File | Source | Used for |
| --- | --- | --- |
| `iMWritingQuatNerdFontPropo-Regular.ttf` | `patched-fonts/iA-Writer/Quattro` | All app text |
| `iMWritingQuatNerdFontPropo-Bold.ttf` | `patched-fonts/iA-Writer/Quattro` | Headings, buttons, emphasis |
| `iMWritingQuatNerdFontPropo-Italic.ttf` | `patched-fonts/iA-Writer/Quattro` | Italic text |
| `VictorMonoNerdFontPropo-LightItalic.ttf` | `patched-fonts/VictorMono` | The "Starting gently…" line on launch |

iM Writing is Nerd Fonts' build of iA Writer Quattro (renamed because "iA Writer"
is a Reserved Font Name under the OFL). Victor Mono's italic is a cursive script.

Each file has the Nerd Fonts icon glyphs (Unicode Private Use Area) removed, which
cuts it from about 2.4 MB to about 100–240 KB. Every text glyph is kept. To rebuild one:

```
pip install fonttools
python3 scripts/subset-nerd-font.py <nerd-fonts>/patched-fonts/iA-Writer/Quattro/iMWritingQuatNerdFontPropo-Regular.ttf assets/fonts/iMWritingQuatNerdFontPropo-Regular.ttf
```

These fonts cover Latin and Cyrillic. Hindi, Marathi, Chinese and Japanese text
falls back to the phone's own fonts.

Licenses: SIL Open Font License 1.1 (`LICENSE-iMWriting.md`, `LICENSE-VictorMono.txt`);
Nerd Fonts patcher, MIT (`LICENSE-NerdFonts.txt`).
