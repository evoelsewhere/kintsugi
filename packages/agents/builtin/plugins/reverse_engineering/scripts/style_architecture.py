#!/usr/bin/env python3
"""Give an agent-written flowchart (architecture.mmd) the house style of the mermaid-diagrams skill.

Usage: style_architecture.py --input FILE --out FILE

Agents draw the structure; this script makes sure the styling is there whatever the agent did: when
the flowchart defines no `classDef` at all and assigns no class, the five standard classes (ui,
service, batch, store, external) are defined and given to every node by what the node is (its
shape, its group's title, its label). Literal `\\n` in a label becomes `<br/>`. Nothing the agent
drew is removed or reordered; a diagram that already styles itself, or that is not a flowchart,
is copied unchanged. Standard library only, no network access (ADR-0029).
"""

from __future__ import annotations

import argparse
import colorsys
import re
import sys
from pathlib import Path

# One class per kind of box; fills are translucent so they read on a light and a dark page.
CLASSES = {
    "ui": "fill:#3b82f6,fill-opacity:0.14,stroke:#3b82f6,stroke-width:1.5px",
    "service": "fill:#45a557,fill-opacity:0.14,stroke:#45a557,stroke-width:1.5px",
    "batch": "fill:#ff990a,fill-opacity:0.16,stroke:#ff990a,stroke-width:1.5px",
    "store": "fill:#a855f7,fill-opacity:0.14,stroke:#a855f7,stroke-width:1.5px",
    "external": "fill:#8f8f8f,fill-opacity:0.12,stroke:#8f8f8f,stroke-width:1.5px,stroke-dasharray:4 3",
}

HEADER = re.compile(r"^\s*flowchart\b", re.IGNORECASE)
FENCE = re.compile(r"^\s*(```|~~~)\s*(mermaid)?\s*$")
SUBGRAPH = re.compile(r'^\s*subgraph\s+[A-Za-z][A-Za-z0-9_]*\s*(?:\[\s*"?([^\]"]*)"?\s*\])?')
# A node written with a quoted label: id, the shape's opening bracket, the label.
NODE = re.compile(r'\b([A-Za-z][A-Za-z0-9_]*)(\[\(|\(\(|\(\[|\[\[|\{\{|\[/|\[|\(|\{)\s*"([^"]*)"')
STORE_GROUP = re.compile(r"data\s*stores?|databases?|storage|persistence|stores?\b", re.IGNORECASE)
EXTERNAL_GROUP = re.compile(r"external|third[- ]?party|integrations?|vendors?", re.IGNORECASE)
STORE_LABEL = re.compile(r"\b(postgres(?:ql)?|mysql|mariadb|oracle|mongo(?:db)?|redis|kafka|rabbit(?:mq)?|database|cache|queue|topic|elastic(?:search)?|s3|bucket)\b", re.IGNORECASE)
UI_LABEL = re.compile(r"controller|screen|page|\bui\b|view|\bapi\b|endpoint|gateway|portal|front.?end|activity|fragment|form", re.IGNORECASE)
BATCH_LABEL = re.compile(r"\bjobs?\b|batch|scheduler|cron|\betl\b|worker|task runner", re.IGNORECASE)


STYLE_LINE = re.compile(r"^\s*(classDef|style|linkStyle)\b")
# rgb(37,99,235) / rgba(37, 99, 235, 0.12) / rgb(37 99 235 / 12%) and hsl(...) / hsla(...), as a value of fill, stroke or color.
COLOR_VALUE = re.compile(
    r"\b(fill|stroke|color)\s*:\s*(rgba?|hsla?)\(\s*([\d.]+)(?:deg)?\s*[, ]\s*([\d.]+)%?\s*[, ]\s*([\d.]+)%?\s*(?:[,/]\s*([\d.]+%?)\s*)?\)",
    re.IGNORECASE,
)


def plain_colors(line: str) -> str:
    """A classDef, style or linkStyle line with its rgb()/rgba()/hsl()/hsla() colours as #rrggbb plus fill-opacity or
    stroke-opacity: the commas of a colour function split the style list and the diagram does not parse."""
    if not STYLE_LINE.match(line):
        return line

    def replace(match: re.Match[str]) -> str:
        prop, fn, first, second, third, alpha = match.groups()
        try:
            a, b, c = float(first), float(second), float(third)
            if fn.lower().startswith("hsl"):
                r, g, bl = colorsys.hls_to_rgb((a % 360) / 360, c / 100, b / 100)
                red, green, blue = (round(value * 255) for value in (r, g, bl))
            else:
                red, green, blue = (max(0, min(255, round(value))) for value in (a, b, c))
            opacity = None
            if alpha is not None:
                opacity = float(alpha[:-1]) / 100 if alpha.endswith("%") else float(alpha)
        except ValueError:
            return match.group(0)
        out = f"{prop}:#{red:02x}{green:02x}{blue:02x}"
        if opacity is not None and prop != "color":
            out += f",{prop}-opacity:{max(0.0, min(1.0, opacity)):g}"
        return out

    return COLOR_VALUE.sub(replace, line)


def classify(shape: str, label: str, group: str) -> str:
    if shape == "[(":
        return "store"
    if EXTERNAL_GROUP.search(group):
        return "external"
    if STORE_GROUP.search(group) or (STORE_LABEL.search(label) and shape in ("[(", "(") and not UI_LABEL.search(label)):
        return "store"
    first = label.split("\\n")[0]
    if BATCH_LABEL.search(first):
        return "batch"
    if UI_LABEL.search(first):
        return "ui"
    return "service"


def style(text: str) -> str:
    lines = text.splitlines()
    # An agent may wrap the diagram in a Markdown fence although the file is plain Mermaid.
    if lines and FENCE.match(lines[0]):
        lines = lines[1:]
    if lines and FENCE.match(lines[-1]):
        lines = lines[:-1]
    lines = [plain_colors(line) for line in lines]
    body = [line for line in lines if line.strip() and not line.lstrip().startswith("%%")]
    if not body or not HEADER.match(body[0]):
        return text
    # Literal "\n" inside a quoted label is a line break the renderer does not know.
    lines = [re.sub(r'"([^"]*)"', lambda m: '"' + m.group(1).replace("\\n", "<br/>") + '"', line) if "\\n" in line else line for line in lines]
    already = any(re.match(r"^\s*classDef\b", line) or ":::" in line or re.match(r"^\s*class\s", line) for line in lines)
    if already:
        return "\n".join(lines) + "\n"

    kinds: dict[str, str] = {}
    group = ""
    depth: list[str] = []
    for line in lines:
        opened = SUBGRAPH.match(line)
        if opened:
            depth.append(opened.group(1) or "")
            group = depth[-1]
            continue
        if re.match(r"^\s*end\s*$", line):
            if depth:
                depth.pop()
            group = depth[-1] if depth else ""
            continue
        for match in NODE.finditer(line):
            kinds.setdefault(match.group(1), classify(match.group(2), match.group(3), group))
    if not kinds:
        return "\n".join(lines) + "\n"

    out = list(lines)
    out.append("")
    out.extend(f"    classDef {name} {css}" for name, css in CLASSES.items() if name in set(kinds.values()))
    for name in CLASSES:
        members = [node for node, kind in kinds.items() if kind == name]
        if members:
            out.append(f"    class {','.join(members)} {name}")
    return "\n".join(out) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Apply the house style to a flowchart that has none.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        text = args.input.read_text(encoding="utf-8")
    except OSError as error:
        print(f"style_architecture.py: cannot read {args.input.name}: {error.strerror}", file=sys.stderr)
        return 2
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(style(text), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
