"""Rebuild the illustrative Star video and social card (Pillow + imageio-ffmpeg).

python -m pip install Pillow imageio-ffmpeg
python scripts/generate-site-media.py
Screenshots are captured separately from the authorized development portal.
"""
from pathlib import Path
import math
import subprocess

from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "site/assets"
MEDIA = ASSETS / "video"
MEDIA.mkdir(parents=True, exist_ok=True)


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


def star(draw, center, radius, fill, outline=None):
    x, y = center
    points = []
    for i in range(10):
        angle = -math.pi / 2 + i * math.pi / 5
        r = radius if i % 2 == 0 else radius * .45
        points.append((x + r * math.cos(angle), y + r * math.sin(angle)))
    draw.polygon(points, fill=fill, outline=outline)


def frame(t):
    im = Image.new("RGB", (1280, 720), "#1e2a44")
    d = ImageDraw.Draw(im)
    for x in range(24, 1280, 32):
        for y in range(24, 720, 32):
            d.ellipse((x, y, x+1, y+1), fill="#34415b")
    d.text((64, 37), "A SMALL CLICK. A LITTLE MOMENTUM.", font=font(16, True), fill="#f7d98a")
    d.text((64, 72), "Help Kintsugi find its people.", font=font(39, True), fill="#fbf8f0")
    d.rounded_rectangle((60, 151, 1220, 560), radius=18, fill="#0d1117", outline="#485367", width=2)
    d.rounded_rectangle((61, 152, 1219, 205), radius=17, fill="#161b22")
    d.rectangle((61, 180, 1219, 205), fill="#161b22")
    for x, color in [(87, "#ff6b65"), (109, "#efc15b"), (131, "#64c88a")]:
        d.ellipse((x-5, 175, x+5, 185), fill=color)
    d.text((304, 170), "github.com/evoelsewhere/kintsugi", font=font(16, mono=True), fill="#b7c0cd")
    d.ellipse((87, 230, 117, 260), fill="#e6edf3")
    d.text((132, 233), "evoelsewhere / kintsugi", font=font(24, True), fill="#58a6ff")
    d.rounded_rectangle((423, 232, 489, 261), radius=14, outline="#48515c")
    d.text((437, 237), "Public", font=font(13), fill="#9da7b3")
    starred = t >= 3.35
    d.rounded_rectangle((1007, 229, 1177, 272), radius=8, fill="#2b2a20" if starred else "#21262d", outline="#d6a84b" if starred else "#48515c")
    star(d, (1033, 250), 11, "#eac35b" if starred else "#b7c0cd")
    d.text((1055, 238), "Starred" if starred else "Star", font=font(18, True), fill="#eac35b" if starred else "#e6edf3")
    d.text((87, 301), "Code", font=font(16, True), fill="#e6edf3")
    d.text((181, 301), "Issues", font=font(16), fill="#9da7b3")
    d.text((282, 301), "Pull requests", font=font(16), fill="#9da7b3")
    d.text((439, 301), "Actions", font=font(16), fill="#9da7b3")
    d.line((83, 332, 141, 332), fill="#f78166", width=3)
    d.line((61, 335, 1219, 335), fill="#30363d")
    d.text((90, 362), "Kintsugi", font=font(37, True), fill="#e6edf3")
    d.text((90, 416), "Modernize the system you have.", font=font(24), fill="#c9d1d9")
    d.text((90, 451), "Keep everything it knows.", font=font(24), fill="#e0b04a")
    d.text((90, 508), "Self-hosted  /  Git-first  /  Apache-2.0", font=font(15, mono=True), fill="#9da7b3")
    progress = min(1, max(0, (t-1.0)/2.1))
    eased = progress*progress*(3-2*progress)
    x = 845 + (1090-845)*eased
    y = 470 + (251-470)*eased
    if 3.15 < t < 3.9:
        r = 18 + (t-3.15)*70
        d.ellipse((x-r, y-r, x+r, y+r), outline="#e0b04a", width=3)
    d.polygon([(x,y), (x+4,y+31), (x+12,y+24), (x+20,y+38), (x+27,y+34), (x+19,y+20), (x+31,y+18)], fill="white", outline="#060b13", width=2)
    if starred:
        d.text((64, 594), "Thank you for supporting open-source modernization.", font=font(24, True), fill="#f7d98a")
    else:
        d.text((64, 594), "Open the repository. Sign in. Click Star.", font=font(24, True), fill="#fbf8f0")
    d.text((64, 647), "Illustrative GitHub UI  ·  No account action is performed by this video", font=font(14), fill="#b9c2d6")
    return im


fps = 24
process = subprocess.Popen([
    imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-f", "rawvideo", "-vcodec", "rawvideo",
    "-s", "1280x720", "-pix_fmt", "rgb24", "-r", str(fps), "-i", "-",
    "-an", "-vcodec", "libx264", "-crf", "22", "-preset", "medium",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(MEDIA / "github-star.mp4"),
], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
for i in range(8*fps):
    process.stdin.write(frame(i/fps).tobytes())
process.stdin.close()
if process.wait() != 0:
    raise RuntimeError("Video encoding failed")
frame(0).save(MEDIA / "github-star-poster.jpg", quality=90, optimize=True)

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
print("Generated 8-second H.264 Star video, poster and 1200×630 social card")
