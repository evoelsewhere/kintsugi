"""Edit continuous recordings of the real portal into the landing-page clip.

Requires Pillow and imageio-ffmpeg. Record real interactions with browser tools,
then run: python scripts/render-portal-motion.py /path/to/recordings

Each scene directory contains capture.json, timestamped JPEG frames and recorded
click targets. Raw recordings and intermediate encodes are not published.
"""
import argparse
from bisect import bisect_right
import json
from pathlib import Path
import subprocess

from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("recordings", type=Path)
args = parser.parse_args()
source = args.recordings.resolve()
destination = ROOT / "site/assets/motion"
destination.mkdir(parents=True, exist_ok=True)
work = source / "rendered"
work.mkdir(exist_ok=True)
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
FPS = 30
TRANSITION = 0.3
SCENES = [
    ("01-discover", "Understand the system you have."),
    ("02-understand", "Make business rules visible."),
    ("03-design", "Design from your own standards."),
    ("04-design-detail", "Keep design and tests connected."),
    ("05-measure", "See every run. Track every token."),
]


def font(size, bold=False):
    for file in [f"/System/Library/Fonts/Supplemental/Arial{' Bold' if bold else ''}.ttf",
                 f"/usr/share/fonts/truetype/dejavu/DejaVuSans{'-Bold' if bold else ''}.ttf"]:
        if Path(file).exists():
            return ImageFont.truetype(file, size)
    return ImageFont.load_default(size=size)


def cursor_at(events, t):
    previous = (1000, 540)
    for event in events:
        target = (event["x"], event["y"])
        when = event["at"] / 1000
        if t < when:
            progress = min(1, max(0, (t - when + .45) / .45))
            eased = progress * progress * (3 - 2 * progress)
            return tuple(a + (b-a)*eased for a, b in zip(previous, target)), None
        if t < when + .4:
            return target, (t-when) / .4
        previous = target
    return previous, None


def render_frame(data, folder, t, number, title):
    times = [frame["at"] / 1000 for frame in data["frames"]]
    frame = data["frames"][max(0, bisect_right(times, t)-1)]
    with Image.open(folder / frame["file"]) as shot:
        ui = shot.convert("RGBA")
    overlay = Image.new("RGBA", ui.size)
    draw = ImageDraw.Draw(overlay)
    (x, y), pulse = cursor_at(data["events"], t)
    if pulse is not None:
        radius = 7 + 12*pulse
        draw.ellipse((x-radius, y-radius, x+radius, y+radius), outline=(184, 130, 42, round(150*(1-pulse))), width=1)
    draw.polygon([(x,y), (x,y+18), (x+4.2,y+14.2), (x+7.4,y+21),
                  (x+10.8,y+19.4), (x+7.6,y+13), (x+13,y+12.5)],
                 fill="#1e2a44", outline="white", width=1)
    ui = Image.alpha_composite(ui, overlay).convert("RGB")
    # Keep the entire recorded viewport fixed; all UI movement comes from the
    # real interactions, without a camera zoom, pan or crop.
    ui = ui.resize((1200, 675), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (1280, 800), "#f7f2e6")
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle((37, 17, 1243, 698), radius=18, fill="#ded5c0")
    mask = Image.new("L", ui.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1199, 674), radius=15, fill=255)
    canvas.paste(ui, (40, 20), mask)
    entrance = min(1, t/.35)
    offset = round(12*(1-entrance)**2)
    d.text((42, 725+offset), f"0{number+1}", font=font(21, True), fill="#b8822a")
    d.text((92, 716+offset), title, font=font(29, True), fill="#1e2a44")
    d.text((1127, 729), "Kintsugi", font=font(17), fill="#5b6781")
    progress = (number + min(1, t / (data["durationMs"]/1000))) / len(SCENES)
    d.line((40, 779, 1240, 779), fill="#ded5c0", width=2)
    d.line((40, 779, 40+1200*progress, 779), fill="#b8822a", width=2)
    return canvas


durations = []
records = []
for number, (name, title) in enumerate(SCENES):
    folder = source / name
    data = json.loads((folder / "capture.json").read_text())
    if data["method"] != "Continuous browser viewport recording during real UI interactions":
        raise ValueError("Use continuous recordings, not the old slideshow captures")
    count = round(data["durationMs"] / 1000 * FPS)
    duration = count / FPS
    durations.append(duration)
    output = work / f"{number}.mp4"
    encoder = subprocess.Popen([
        ffmpeg, "-y", "-f", "rawvideo", "-vcodec", "rawvideo", "-s", "1280x800",
        "-pix_fmt", "rgb24", "-r", str(FPS), "-i", "-", "-an", "-c:v", "libx264",
        "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(output),
    ], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    for index in range(count):
        encoder.stdin.write(render_frame(data, folder, index/FPS, number, title).tobytes())
    encoder.stdin.close()
    if encoder.wait() != 0:
        raise RuntimeError(f"Encoding failed for scene {name}")
    if number == 0:
        render_frame(data, folder, .6, number, title).save(destination / "portal-motion-poster.jpg", quality=92, optimize=True)
    records.append({"scene": name, "title": title, "durationSeconds": duration,
                    "recordedFrames": len(data["frames"]), "clicks": len(data["events"])})

inputs = [part for number in range(len(SCENES)) for part in ["-i", str(work / f"{number}.mp4")]]
filters = []
for number in range(1, len(SCENES)):
    left = "0:v" if number == 1 else f"mix{number-1}"
    offset = sum(durations[:number]) - TRANSITION*number
    filters.append(f"[{left}][{number}:v]xfade=transition=fade:duration={TRANSITION}:offset={offset}[mix{number}]")
subprocess.run([
    ffmpeg, "-y", *inputs, "-filter_complex", ";".join(filters), "-map", f"[mix{len(SCENES)-1}]",
    "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", str(destination / "portal-motion.mp4"),
], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def timestamp(seconds):
    ms = round(seconds*1000)
    return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02}.{ms%1000:03}"


total = sum(durations) - TRANSITION*(len(SCENES)-1)
captions = ["WEBVTT\n"]
for number, record in enumerate(records):
    start = sum(durations[:number]) - TRANSITION*number
    end = sum(durations[:number+1]) - TRANSITION*(number+1) if number+1 < len(records) else total
    record["at"] = round(start, 3)
    captions.append(f"{timestamp(start)} --> {timestamp(end)}\n{record['title']}\n")
(destination / "portal-motion.vtt").write_text("\n".join(captions))
(destination / "provenance.json").write_text(json.dumps({
    "source": "https://kintsugi.fhmq9.cloud", "theme": "light", "application": "AWS CardDemo development data",
    "captureMethod": "Continuous browser viewport recordings of real navigation, typing, tabs and scrolling",
    "edit": "Fixed full viewport; small cursor and subtle click pulses at recorded targets, captions and crossfades; no zoom, pan or crop",
    "durationSeconds": round(total, 3), "outputFps": FPS, "scenes": records,
}, indent=2) + "\n")
print(f"Rendered {total:.1f}s of product motion from {sum(r['recordedFrames'] for r in records)} recorded frames; "
      f"MP4: {(destination / 'portal-motion.mp4').stat().st_size / 1024 / 1024:.2f} MiB")
