"""Render the Star animation for the landing page (Playwright + Pillow).

python -m pip install playwright Pillow
python -m playwright install chromium
python scripts/render-github-star.py

Draws scripts/github-star/scene.html (the public repository in GitHub's dark theme, with
Primer Octicons, MIT) frame by frame and writes site/assets/video/github-star.gif and its
poster. Nothing is sent to GitHub: the page is a local rendering and no account is used.
"""
from pathlib import Path
import io
import json

from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCENE = ROOT / "scripts/github-star/scene.html"
ICONS = ROOT / "scripts/github-star/octicons.json"
OUT = ROOT / "site/assets/video"
SIZE = (960, 540)
FPS = 20
LENGTH = 7.6   # seconds of scene before the loop fades back to the start
FADE = 0.4
# small but telling colours a 128-colour palette would otherwise lose: the starred icon and
# its edges, the click ring, links and the green Code button
KEEP = ["#e3b341", "#c79a3a", "#9c7a35", "#6b5733", "#f0c661", "#4493f8", "#238636", "#f78166"]


def capture():
    frames = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1280, "height": 720}, device_scale_factor=2)
        page.add_init_script(f"window.OCTICONS = {ICONS.read_text(encoding='utf-8')};")
        page.goto(SCENE.as_uri())
        page.wait_for_load_state("networkidle")
        page.evaluate("document.fonts.ready")
        for i in range(round(LENGTH * FPS)):
            page.evaluate(f"window.render({i / FPS})")
            shot = Image.open(io.BytesIO(page.screenshot(type="png"))).convert("RGB")
            frames.append(shot.resize(SIZE, Image.LANCZOS))
        browser.close()
    return frames


def to_gif(frames):
    first = frames[0]
    steps = round(FADE * FPS)
    frames = frames + [Image.blend(frames[-1], first, (i + 1) / steps) for i in range(steps)]
    sample = Image.new("RGB", (SIZE[0], SIZE[1] * 4))
    for i, index in enumerate([0, len(frames) // 3, len(frames) // 2, len(frames) - steps - 1]):
        sample.paste(frames[index], (0, SIZE[1] * i))
    palette = sample.quantize(colors=128 - len(KEEP), method=Image.Quantize.MEDIANCUT)
    colors = palette.getpalette()[:3 * (128 - len(KEEP))]
    for color in KEEP:
        colors += [int(color[i:i + 2], 16) for i in (1, 3, 5)]
    palette.putpalette(colors)
    out, durations = [], []
    for im in frames:
        q = im.quantize(palette=palette, dither=Image.Dither.NONE)
        if out and q.tobytes() == out[-1].tobytes():
            durations[-1] += 1000 // FPS
        else:
            out.append(q)
            durations.append(1000 // FPS)
    out[0].save(OUT / "github-star.gif", save_all=True, append_images=out[1:], duration=durations,
                loop=0, optimize=False, disposal=1)
    first.save(OUT / "github-star-poster.jpg", quality=90, optimize=True)
    return len(out)


OUT.mkdir(parents=True, exist_ok=True)
count = to_gif(capture())
size = (OUT / "github-star.gif").stat().st_size
print(json.dumps({"frames": count, "bytes": size}))
