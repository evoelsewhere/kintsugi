#!/usr/bin/env python3
"""Fail-closed artifact checks for a runtime job output tree.

Credentials are deliberately not checked: Kintsugi runs on managed team/enterprise LLM plans and
legacy sources legitimately contain credentials the analysis must be able to cite.

Mermaid diagrams (`.mmd` files and mermaid fences in Markdown) are also checked with the
built-in lint (scripts/mermaid_lint.py); what it finds is reported as non-blocking warnings.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import stat
import sys
from pathlib import Path
from typing import Any, NoReturn

EXIT_CLEAN = 0
EXIT_MALFORMED = 3
EXIT_INPUT_ERROR = 5
EXIT_USAGE = 64

# Only the files that are validated or linted are read (see _needs_content); everything else, such as the
# run's scratch JSON, is counted and never opened, so its size cannot fail a job.
MAX_FILE_BYTES = 16 * 1_048_576
MAX_TOTAL_BYTES = 256 * 1_048_576
MAX_FILES = 100_000
MAX_DIRECTORIES = 100_000
MAX_ENTRIES = 200_000
MAX_FINDINGS = 10_000
MAX_WARNINGS = 1_000
DIAGRAM_SUFFIXES = (".mmd", ".md")
MERMAID_LINT = Path(__file__).resolve().parent.parent / "scripts" / "mermaid_lint.py"

# RULE-NNN estate ids, legacy item-namespaced RULE-<module>.<item>-NN (ADR-0033) and the
# citation-derived RULE-<module>.<unit>-<hash> ids (ADR-0038).
RULE_HEADING = re.compile(r"^### RULE-(?:\d{2,}|[a-z0-9][a-z0-9-]{0,62}(?:\.[a-z0-9][a-z0-9-]{0,62})?-(?:\d{2,}|[0-9a-f]{8}(?:-[a-z0-9][a-z0-9-]{0,31})?)): \S.*$")
# scripts/render_rules.py writes this line when no rule was confirmed: an empty catalog, not a malformed one.
NO_RULES_MARKER = "_No business rules were confirmed in this run._"
RULE_CANDIDATE = re.compile(r"^#{1,6}\s+RULE-", re.IGNORECASE)


class InputProblem(Exception):
    """The tree could not be scanned safely and completely."""


class JsonArgumentParser(argparse.ArgumentParser):
    """Keep usage failures on the same machine-readable stdout contract."""

    def error(self, message: str) -> NoReturn:
        print(
            json.dumps(
                {
                    "version": 1,
                    "exit_code": EXIT_USAGE,
                    "checked": {"files": 0, "bytes": 0},
                    "findings": [],
                    "warnings": [],
                    "errors": [{"path": ".", "code": "invalid_cli"}],
                },
                ensure_ascii=True,
                sort_keys=True,
            )
        )
        raise SystemExit(EXIT_USAGE)


def _is_link_or_junction(path: Path) -> bool:
    is_junction = getattr(os.path, "isjunction", None)
    return path.is_symlink() or (is_junction is not None and is_junction(path))


def _read_bounded(path: Path, expected_size: int) -> bytes:
    try:
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise InputProblem("file_open_failed") from exc

    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise InputProblem("not_regular_file")
        if info.st_size > MAX_FILE_BYTES:
            raise InputProblem("file_too_large")
        if info.st_size != expected_size:
            raise InputProblem("file_changed_during_scan")
        try:
            with os.fdopen(descriptor, "rb", closefd=False) as stream:
                content = stream.read(MAX_FILE_BYTES + 1)
        except OSError as exc:
            raise InputProblem("file_read_failed") from exc
        if len(content) > MAX_FILE_BYTES or len(content) != expected_size:
            raise InputProblem("file_changed_during_scan")
        return content
    finally:
        os.close(descriptor)


def _valid_topology_document(text: str) -> bool:
    """A topology document (scripts/render_topology.py): front matter naming the system, then a Domains table."""
    lines = text.lstrip("﻿").splitlines()
    if not lines or lines[0].strip() != "---":
        return False
    try:
        end = next(index for index in range(1, len(lines)) if lines[index].strip() == "---")
    except StopIteration:
        return False
    if not any(re.match(r'^system:\s*\S', line) for line in lines[1:end]):
        return False
    return any(line.strip() == "## Domains" for line in lines[end + 1 :])


def _load_mermaid_lint() -> Any:
    """The built-in Mermaid lint (scripts/mermaid_lint.py), or None when it is not shipped beside the hook."""
    try:
        spec = importlib.util.spec_from_file_location("kintsugi_mermaid_lint", MERMAID_LINT)
        if spec is None or spec.loader is None:
            return None
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    except (OSError, ImportError, SyntaxError):
        return None


def _diagram_warnings(lint: Any, relative: str, text: str) -> list[tuple[str, int]]:
    """Mermaid lint problems of a `.mmd` file or of the mermaid fences of a Markdown file: rule and line only."""
    if lint is None or not relative.lower().endswith(DIAGRAM_SUFFIXES):
        return []
    try:
        return [(str(problem.rule), int(problem.line)) for problem in lint.lint_text(relative, text)]
    except Exception:  # noqa: BLE001 - a lint defect must never block or break the scan
        return [("diagram_lint_failed", 1)]


def _lines_outside_fences(text: str) -> list[tuple[int, str]]:
    """(line number, line) of every line that is not inside a fenced code block."""
    kept: list[tuple[int, str]] = []
    fence = ""
    for line_number, line in enumerate(text.splitlines(), start=1):
        marker = line.lstrip()[:3]
        if marker in ("```", "~~~"):
            fence = "" if fence == marker else (fence or marker)
            continue
        if not fence:
            kept.append((line_number, line))
    return kept


def _needs_content(relative: str) -> bool:
    """Whether the hook looks inside this file: the artifacts it validates and the diagrams it lints."""
    name = relative.rsplit("/", 1)[-1]
    return name in ("topology.md", "BUSINESS_RULES.md", "rules.md") or relative.lower().endswith(DIAGRAM_SUFFIXES)


def _validate_artifact(relative: str, content: bytes) -> list[tuple[str, int]]:
    findings: list[tuple[str, int]] = []
    name = relative.rsplit("/", 1)[-1]
    text = content.decode("utf-8", errors="replace")
    if name == "topology.md":
        if not _valid_topology_document(text):
            findings.append(("invalid_topology_document", 1))
    elif name in ("BUSINESS_RULES.md", "rules.md"):
        headings = [
            (line_number, line)
            for line_number, line in _lines_outside_fences(text)
            if RULE_CANDIDATE.match(line)
        ]
        if not headings:
            if NO_RULES_MARKER not in text.splitlines():
                findings.append(("missing_rule_heading", 1))
        else:
            findings.extend(
                ("invalid_rule_heading", line_number)
                for line_number, line in headings
                if not RULE_HEADING.fullmatch(line)
            )
    return findings


def _scan(root: Path) -> dict[str, Any]:
    findings: list[dict[str, Any]] = []
    warnings: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    lint = _load_mermaid_lint()
    checked_files = 0
    checked_bytes = 0

    def input_error(relative: str, code: str) -> None:
        errors.append({"path": relative, "code": code})

    def add_finding(finding: dict[str, Any]) -> bool:
        if len(findings) >= MAX_FINDINGS:
            input_error(str(finding["path"]), "finding_count_limit_exceeded")
            return False
        findings.append(finding)
        return True

    if os.fspath(root).startswith(("\\\\", "//")):
        raise InputProblem("network_path_not_allowed")

    try:
        root_stat = root.lstat()
        if _is_link_or_junction(root) or not stat.S_ISDIR(root_stat.st_mode):
            raise InputProblem("output_dir_not_real_directory")
    except OSError as exc:
        raise InputProblem("output_dir_unavailable") from exc

    stack = [root]
    directories_seen = 0
    entries_seen = 0
    while stack:
        directory = stack.pop()
        directories_seen += 1
        if directories_seen > MAX_DIRECTORIES:
            input_error(".", "directory_count_limit_exceeded")
            break
        try:
            entries = []
            with os.scandir(directory) as iterator:
                for entry in iterator:
                    entries.append(entry)
                    entries_seen += 1
                    if entries_seen > MAX_ENTRIES:
                        input_error(directory.relative_to(root).as_posix() or ".", "entry_count_limit_exceeded")
                        stack.clear()
                        break
            entries.sort(key=lambda entry: entry.name, reverse=True)
        except OSError:
            input_error(directory.relative_to(root).as_posix() or ".", "directory_read_failed")
            continue
        if entries_seen > MAX_ENTRIES:
            break

        for entry in entries:
            path = Path(entry.path)
            relative = path.relative_to(root).as_posix()
            report_path = relative
            try:
                info = entry.stat(follow_symlinks=False)
            except OSError:
                input_error(relative, "entry_stat_failed")
                continue
            if _is_link_or_junction(path):
                input_error(relative, "symlink_not_followed")
                continue
            if stat.S_ISDIR(info.st_mode):
                stack.append(path)
                continue
            if not stat.S_ISREG(info.st_mode):
                input_error(relative, "not_regular_file")
                continue
            checked_files += 1
            if checked_files > MAX_FILES:
                input_error(".", "file_count_limit_exceeded")
                stack.clear()
                break
            if not _needs_content(relative):
                continue
            if info.st_size > MAX_FILE_BYTES:
                input_error(relative, "file_too_large")
                continue
            if checked_bytes + info.st_size > MAX_TOTAL_BYTES:
                input_error(relative, "total_bytes_limit_exceeded")
                stack.clear()
                break
            try:
                content = _read_bounded(path, info.st_size)
            except InputProblem as exc:
                input_error(relative, str(exc))
                continue
            checked_bytes += len(content)
            text = content.decode("utf-8", errors="replace")
            finding_limit_reached = False
            for rule, line_number in _validate_artifact(relative, content):
                if not add_finding(
                    {
                        "category": "malformed_artifact",
                        "rule": rule,
                        "path": report_path,
                        "line": line_number,
                        "redacted": True,
                    }
                ):
                    finding_limit_reached = True
                    break
            if finding_limit_reached:
                stack.clear()
                break
            for rule, line_number in _diagram_warnings(lint, relative, text):
                if len(warnings) >= MAX_WARNINGS:
                    break
                warnings.append(
                    {
                        "category": "diagram",
                        "rule": rule,
                        "path": report_path,
                        "line": line_number,
                        "redacted": True,
                    }
                )

    findings.sort(key=lambda item: (item["path"], item["line"], item["rule"]))
    warnings.sort(key=lambda item: (item["path"], item["line"], item["rule"]))
    errors.sort(key=lambda item: (item["path"], item["code"]))
    if errors:
        exit_code = EXIT_INPUT_ERROR
    elif findings:
        exit_code = EXIT_MALFORMED
    else:
        exit_code = EXIT_CLEAN
    return {
        "version": 1,
        "exit_code": exit_code,
        "checked": {"files": checked_files, "bytes": checked_bytes},
        "findings": findings,
        "warnings": warnings,
        "errors": errors,
    }


def main(argv: list[str] | None = None) -> int:
    parser = JsonArgumentParser(
        description="Scan a runtime job output directory before artifacts are committed."
    )
    parser.add_argument("--output-dir", required=True, type=Path, help="job output directory to scan")
    args = parser.parse_args(argv)
    report: dict[str, Any]
    try:
        report = _scan(args.output_dir)
    except InputProblem as exc:
        report = {
            "version": 1,
            "exit_code": EXIT_INPUT_ERROR,
            "checked": {"files": 0, "bytes": 0},
            "findings": [],
            "warnings": [],
            "errors": [{"path": ".", "code": str(exc)}],
        }
    print(json.dumps(report, ensure_ascii=True, sort_keys=True))
    return int(report["exit_code"])


if __name__ == "__main__":
    sys.exit(main())
