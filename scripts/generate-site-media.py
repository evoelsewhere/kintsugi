"""Rebuild the social card (Pillow).

python -m pip install Pillow
python scripts/generate-site-media.py
Screenshots are captured separately from the authorized development portal; the Star
animation is rendered by scripts/render-github-star.py.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "site/assets"


def font(size, bold=False, mono=False):
    candidates = (
        ["/System/Library/Fonts/SFNSMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]
        if mono else
        [f"/System/Library/Fonts/Supplemental/Arial{' Bold' if bold else ''}.ttf",
         f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf"]
    )
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    return ImageFont.load_default(size=size)


social = Image.new("RGB", (1200, 630), "#1e2a44")
d = ImageDraw.Draw(social)
d.line([(840, 0), (810, 150), (900, 290), (815, 460), (860, 630)], fill="#e0b04a", width=6)
d.line([(900, 290), (1040, 240), (1200, 275)], fill="#b8822a", width=3)
d.text((72, 65), "KINTSUGI  /  OPEN-SOURCE MODERNIZATION", font=font(18, True), fill="#f7d98a")
d.text((72, 161), "Modernize the", font=font(68, True), fill="#fbf8f0")
d.text((72, 241), "system you have.", font=font(68, True), fill="#fbf8f0")
d.text((72, 341), "Keep everything it knows.", font=font(43), fill="#e0b04a")
d.text((72, 483), "Understand  /  Design  /  Build & review", font=font(22), fill="#c9d1e2")
d.text((72, 552), "Self-hosted. Git-first. People decide.", font=font(19), fill="#c9d1e2")
social.save(ASSETS / "social-card.jpg", quality=92, optimize=True)
print("Generated the 1200×630 social card")
