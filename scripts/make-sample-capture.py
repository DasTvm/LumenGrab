"""Generates src/platform/mock/sample-capture.png: a fake app window used as the mock capture.

Original artwork (flat shapes, no text, no third-party assets). Used only in browser mock mode.
"""
from PIL import Image, ImageDraw

W, H = 1440, 900
img = Image.new("RGB", (W, H), (226, 230, 238))
d = ImageDraw.Draw(img)

# window
d.rounded_rectangle((120, 90, W - 120, H - 90), radius=16, fill=(250, 251, 253), outline=(205, 210, 220), width=2)
d.rounded_rectangle((120, 90, W - 120, 150), radius=16, fill=(236, 239, 245))
d.rectangle((120, 130, W - 120, 150), fill=(236, 239, 245))
for i, c in enumerate([(236, 106, 94), (244, 191, 79), (97, 197, 84)]):
    x = 152 + i * 28
    d.ellipse((x - 8, 120 - 8, x + 8, 120 + 8), fill=c)

# sidebar
d.rectangle((121, 150, 380, H - 91), fill=(241, 243, 248))
for i in range(7):
    y = 190 + i * 56
    d.rounded_rectangle((148, y, 148 + 150 - (i % 3) * 24, y + 16), radius=8, fill=(205, 211, 224))

# content: heading, lines, cards, chart
d.rounded_rectangle((424, 190, 424 + 320, 190 + 28), radius=10, fill=(40, 46, 60))
for i in range(3):
    d.rounded_rectangle((424, 244 + i * 28, 424 + 620 - i * 90, 244 + i * 28 + 12), radius=6, fill=(196, 202, 216))
for i in range(3):
    x = 424 + i * 290
    d.rounded_rectangle((x, 360, x + 262, 500), radius=14, fill=(255, 255, 255), outline=(220, 224, 233), width=2)
    d.rounded_rectangle((x + 20, 382, x + 20 + 90, 382 + 12), radius=6, fill=(196, 202, 216))
    d.rounded_rectangle((x + 20, 420, x + 20 + 140, 420 + 34), radius=10, fill=(47, 111, 237) if i == 0 else (90, 98, 116))
d.rounded_rectangle((424, 530, 424 + 842, 530 + 200), radius=14, fill=(255, 255, 255), outline=(220, 224, 233), width=2)
bars = [60, 110, 80, 150, 120, 170, 100, 140, 90, 160]
for i, b in enumerate(bars):
    x = 460 + i * 78
    d.rounded_rectangle((x, 710 - b, x + 44, 710), radius=8, fill=(47, 111, 237) if i % 3 == 0 else (160, 190, 245))

img.save("src/platform/mock/sample-capture.png", optimize=True)
