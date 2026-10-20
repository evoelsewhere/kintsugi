#!/usr/bin/env python3
"""Mask credential-shaped values in a runtime job output tree, in place.

Runs before the JobOutput hook (job_output.py), which stays the fail-closed backstop: whatever
this script cannot mask (binary files, credential-shaped file names, a pattern it does not
know) is still found and blocked there. The patterns are the hook's own, imported from it, so
the two never disagree about what a credential looks like.

A value becomes a short preview and `****` (the convention the agents are told to follow), a
private key block is removed, a password in a connection string becomes `***`. The report on
stdout names the rule, file and line of every masking, never a value.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any

HOOK = Path(__file__).resolve().parent / "job_output.py"
MAX_FILE_BYTES = 1_048_576
MAX_FILES = 10_000
MAX_REPORTED = 1_000
MAX_KEY_BLOCK_LINES = 200
PREVIEW = 2
KEY_REMOVED = "[private key removed]"


def _load_hook() -> Any:
    spec = importlib.util.spec_from_file_location("kintsugi_job_output", HOOK)
    if spec is None or spec.loader is None:
        raise ImportError("job_output.py not found")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


hook = _load_hook()

CONNECTION_PASSWORD = re.compile(r"(://[^\s/:@]{1,128}:)[^\s/@]{4,256}(@)")
ADO_PASSWORD = re.compile(r"(?i)((?:password|pwd)\s*=\s*)[^;]{4,256}\Z")


def _preview(value: str, keep: int) -> str:
    return value[:keep] + "****"


def mask_line(line: str) -> str:
    """One line with every credential-shaped value masked (what the hook would flag, as far as it can be)."""
    line = hook.CLOUD_KEY.sub(lambda m: _preview(m.group(0), 4), line)
    line = hook.TOKEN.sub(lambda m: _preview(m.group(0), 4), line)
    line = hook.BEARER.sub("Bearer ****", line)
    line = hook.CONNECTION_URI.sub(lambda m: CONNECTION_PASSWORD.sub(r"\1***\2", m.group(0)), line)
    line = hook.ADO_CONNECTION.sub(lambda m: ADO_PASSWORD.sub(r"\1***", m.group(0)), line)
    spans: list[tuple[int, int, str]] = []
    for match in hook.ASSIGNMENT.finditer(line):
        value = match.group(1)
        core = value.rstrip(".])}")
        if hook.PLACEHOLDER.fullmatch(core):
            continue
        spans.append((match.start(1), match.end(1), _preview(core, PREVIEW) + value[len(core):]))
    for start, end, replacement in reversed(spans):
        line = line[:start] + replacement + line[end:]
    return line


def mask_text(text: str) -> tuple[str, list[tuple[int, str]]]:
    """The masked text and (line, rule) of every line that changed; line numbers are kept."""
    lines = text.split("\n")
    masked: list[tuple[int, str]] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        if hook.PRIVATE_KEY.search(line):
            masked.append((index + 1, "private_key"))
            lines[index] = KEY_REMOVED
            # The key body is base64 the patterns do not see: blank it up to the END line.
            end = index + 1
            while end < len(lines) and end - index <= MAX_KEY_BLOCK_LINES and lines[end].strip() != "":
                done = "-----END" in lines[end]
                lines[end] = ""
                end += 1
                if done:
                    break
            index = end
            continue
        rules = hook._credential_rules(line.rstrip("\r"))
        if rules:
            new = mask_line(line)
            if new != line:
                lines[index] = new
                masked.extend((index + 1, rule) for rule in sorted(rules))
        index += 1
    return "\n".join(lines), masked


def _files(root: Path) -> list[Path]:
    found: list[Path] = []
    for directory, names, files in os.walk(root, followlinks=False):
        names.sort()
        for name in sorted(files):
            path = Path(directory) / name
            if path.is_symlink():
                continue
            found.append(path)
            if len(found) >= MAX_FILES:
                return found
    return found


def mask_tree(root: Path) -> dict[str, Any]:
    if root.is_symlink() or not root.is_dir():
        raise SystemExit(5)
    items: list[dict[str, Any]] = []
    changed_files = 0
    for path in _files(root):
        try:
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_FILE_BYTES:
                continue
            raw = path.read_bytes()
            text = raw.decode("utf-8")
        except (OSError, UnicodeDecodeError):
            continue  # binary or unreadable: the hook decides about it
        masked_text, masked = mask_text(text)
        if not masked:
            continue
        path.write_bytes(masked_text.encode("utf-8"))
        changed_files += 1
        relative = path.relative_to(root).as_posix()
        # A credential-shaped file name is not echoed (the hook redacts it the same way).
        shown = "[redacted-path]" if hook._credential_rules(relative) else relative
        for line, rule in masked:
            if len(items) < MAX_REPORTED:
                items.append({"rule": rule, "path": shown, "line": line})
    return {"version": 1, "files": changed_files, "masked": items}


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 2 or args[0] != "--output-dir":
        print(json.dumps({"version": 1, "error": "invalid_cli"}))
        return 64
    report = mask_tree(Path(args[1]))
    print(json.dumps(report, ensure_ascii=True, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
