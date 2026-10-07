"""Usage: subset-nerd-font.py SRC.ttf DST.ttf

Drop the Nerd Fonts icon glyphs (Private Use Area) and keep every text glyph."""
import sys
from fontTools.ttLib import TTFont
from fontTools import subset

def is_pua(cp):
    return 0xE000 <= cp <= 0xF8FF or 0xF0000 <= cp <= 0x10FFFF

src, dst = sys.argv[1], sys.argv[2]
font = TTFont(src)
keep = sorted(cp for cp in font.getBestCmap() if not is_pua(cp))
opts = subset.Options()
opts.layout_features = ['*']
opts.name_IDs = ['*']
opts.name_languages = ['*']
opts.name_legacy = True
opts.glyph_names = False
opts.notdef_outline = True
opts.hinting = True
opts.legacy_kern = True
sub = subset.Subsetter(opts)
sub.populate(unicodes=keep)
sub.subset(font)
font.save(dst)
print(dst.split('/')[-1], len(keep), 'codepoints')
