"""Encode an authorized UI capture sequence as a 30-second timelapse GIF.

Requires Pillow and imageio-ffmpeg. Capture with the browser tools first, then:
    python scripts/encode-portal-tour.py /path/to/capture-directory

The directory must contain manifest.json and frames/<file>.jpg. Raw captures and
the intermediate MP4 stay outside the published site. The UI is not recolored.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess

from PIL import Image
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("capture_directory", type=Path)
args = parser.parse_args()
capture = args.capture_directory.resolve()
scenes = json.loads((capture / "manifest.json").read_text())
# The first capture is a scrolled portfolio view; start on its complete overview.
if scenes[0]["label"] == "Portfolio overview":
    scenes = scenes[1:]
if not scenes:
    raise ValueError("The capture sequence is empty")
for scene in scenes:
    if not re.fullmatch(r"\d{3}\.jpg", scene["file"]):
        raise ValueError("Capture filenames must be three digits followed by .jpg")
    if scene["seconds"] <= 0:
        raise ValueError("Every scene needs a positive duration")
    with Image.open(capture / "frames" / scene["file"]) as shot:
        if shot.size != (1280, 720):
            raise ValueError("Every capture must be 1280×720")

destination = ROOT / "site/assets/tour"
destination.mkdir(parents=True, exist_ok=True)
fps = 10
total_frames = 300
duration = sum(scene["seconds"] for scene in scenes)
counts = [max(1, round(scene["seconds"] / duration * total_frames)) for scene in scenes]
counts[-1] += total_frames - sum(counts)
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
intermediate = capture / "portal-tour-light.mp4"
process = subprocess.Popen([
    ffmpeg, "-y", "-f", "rawvideo", "-vcodec", "rawvideo", "-s", "1280x720",
    "-pix_fmt", "rgb24", "-r", str(fps), "-i", "-", "-an", "-c:v", "libx264",
    "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    str(intermediate),
], stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
chapters = []
elapsed = 0
for scene, count in zip(scenes, counts, strict=True):
    with Image.open(capture / "frames" / scene["file"]) as shot:
        pixels = shot.convert("RGB").tobytes()
    for _ in range(count):
        process.stdin.write(pixels)
    chapters.append({"at": round(elapsed / fps, 1), "title": scene["label"]})
    elapsed += count
process.stdin.close()
if process.wait() != 0:
    raise RuntimeError("Timelapse video encoding failed")

subprocess.run([
    ffmpeg, "-y", "-i", str(intermediate), "-filter_complex",
    "[0:v]mpdecimate,scale=1120:-2:flags=lanczos,split[a][b];"
    "[a]palettegen=max_colors=128:stats_mode=diff[p];"
    "[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
    "-fps_mode", "vfr", "-final_delay", str(round(counts[-1] * 100 / fps)),
    "-loop", "0", str(destination / "portal-tour-light.gif"),
], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
with Image.open(capture / "frames" / scenes[0]["file"]) as poster:
    poster.save(destination / "portal-tour-light-poster.jpg", quality=92, optimize=True)
manifest = {"source": "https://kintsugi.fhmq9.cloud", "theme": "light", "durationSeconds": 30,
            "captureMethod": "Timelapse of actual browser navigation; waiting time omitted",
            "application": "AWS CardDemo development data", "scenes": chapters}
(destination / "chapters.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Encoded {len(scenes)} actual UI scenes as a 30-second GIF: "
      f"{(destination / 'portal-tour-light.gif').stat().st_size / 1024 / 1024:.2f} MiB")
