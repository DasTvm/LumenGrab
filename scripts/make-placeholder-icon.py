"""Generates the placeholder app icon (src-tauri/app-icon.png): a ring on a dark rounded square.

Placeholder only; the real logo comes later. Run `pnpm tauri icon src-tauri/app-icon.png`
afterwards to regenerate all platform icons.
"""
from PIL import Image, ImageDraw

SIZE = 1024
SS = 2  # supersampling for smooth edges
s = SIZE * SS
img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.225), fill=(24, 26, 32, 255))
c, r, w = s // 2, int(s * 0.27), int(s * 0.075)
d.ellipse((c - r, c - r, c + r, c + r), outline=(236, 238, 242, 255), width=w)
d.ellipse((c - int(r * 0.28), c - int(r * 0.28), c + int(r * 0.28), c + int(r * 0.28)), fill=(236, 238, 242, 255))
img.resize((SIZE, SIZE), Image.LANCZOS).save("src-tauri/app-icon.png")
