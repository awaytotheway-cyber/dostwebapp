from PIL import Image
import os
import shutil

SRC_CANDIDATES = [
    "assets/dost-icon-source.png",
    r"C:\Users\91878\.cursor\projects\c-cc-dost-app\assets\dost-icon-source.png",
]


def find_src() -> str:
    for path in SRC_CANDIDATES:
        if os.path.exists(path):
            return path
    raise FileNotFoundError("dost-icon-source.png not found")


def fit_square(im: Image.Image, size: int, pad_ratio: float = 0.12) -> Image.Image:
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    cropped = im.crop((left, top, left + side, top + side))
    canvas = Image.new("RGBA", (size, size), (249, 246, 240, 255))
    inner = int(size * (1 - 2 * pad_ratio))
    resized = cropped.resize((inner, inner), Image.Resampling.LANCZOS)
    offset = (size - inner) // 2
    canvas.paste(resized, (offset, offset), resized)
    return canvas


def make_transparent_fg(im: Image.Image, size: int, pad_ratio: float = 0.14) -> Image.Image:
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    cropped = im.crop((left, top, left + side, top + side)).convert("RGBA")
    pixels = cropped.load()
    for y in range(cropped.height):
        for x in range(cropped.width):
            r, g, b, a = pixels[x, y]
            if r > 220 and g > 210 and b > 190 and abs(r - g) < 30 and abs(g - b) < 40:
                pixels[x, y] = (r, g, b, 0)
            elif r > 235 and g > 230 and b > 220:
                pixels[x, y] = (r, g, b, 0)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = int(size * (1 - 2 * pad_ratio))
    resized = cropped.resize((inner, inner), Image.Resampling.LANCZOS)
    offset = (size - inner) // 2
    canvas.paste(resized, (offset, offset), resized)
    return canvas


def main() -> None:
    src_path = find_src()
    os.makedirs("assets", exist_ok=True)
    if src_path != "assets/dost-icon-source.png":
        shutil.copyfile(src_path, "assets/dost-icon-source.png")

    src = Image.open(src_path).convert("RGBA")

    icon = fit_square(src, 1024, 0.10)
    icon.convert("RGB").save("assets/icon.png", "PNG", optimize=True)

    splash = fit_square(src, 1024, 0.18)
    splash.convert("RGB").save("assets/splash-icon.png", "PNG", optimize=True)

    adaptive = make_transparent_fg(src, 1024, 0.16)
    adaptive.save("assets/adaptive-icon.png", "PNG", optimize=True)

    fav = fit_square(src, 48, 0.08)
    fav.convert("RGB").save("assets/favicon.png", "PNG", optimize=True)

    for path in [
        "assets/icon.png",
        "assets/splash-icon.png",
        "assets/adaptive-icon.png",
        "assets/favicon.png",
    ]:
        print(path, os.path.getsize(path))


if __name__ == "__main__":
    main()
