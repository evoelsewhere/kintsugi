from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[7]
HOOK = ROOT / "packages" / "agents" / "builtin" / "plugins" / "reverse_engineering" / "hooks" / "job_output.py"

VALID_TOPOLOGY = (
    '---\napp: "example"\nsystem: "Example app"\ndomains: 1\n---\n# Topology of Example app\n\n'
    "## Domains\n\n| Domain | Leaves | Data stores | LOC |\n| --- | --- | --- | --- |\n| Core | 1 | 0 | 10 |\n"
)


def run_hook(output_dir: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(HOOK), "--output-dir", str(output_dir), *extra],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=15,
    )


def report(result: subprocess.CompletedProcess[str]) -> dict[str, Any]:
    assert result.stdout.endswith("\n")
    assert result.stderr == ""
    return json.loads(result.stdout)


def test_clean_output_validates_topology_and_rule_headings(tmp_path: Path) -> None:
    (tmp_path / "assessment" / "sample-app").mkdir(parents=True)
    topology = tmp_path / "assessment" / "sample-app" / "topology.md"
    topology.write_text(VALID_TOPOLOGY, encoding="utf-8")
    rules = tmp_path / "assessment" / "sample-app" / "BUSINESS_RULES.md"
    rules.write_text("### RULE-001: Calculate the total\n\nRule body.\n", encoding="utf-8")

    result = run_hook(tmp_path)

    assert result.returncode == 0
    assert report(result)["findings"] == []


def test_credentials_are_not_checked(tmp_path: Path) -> None:
    lines = ["password: TEST_ONLY_SECRET_12345", "ghp_" + "A" * 24, "postgres://unit:TEST_ONLY_PASSWORD@invalid.example/db", ""]
    (tmp_path / "settings.txt").write_text("\n".join(lines), encoding="utf-8")
    (tmp_path / "output.pem").write_text("-----BEGIN PRIVATE KEY-----\nTEST_ONLY\n-----END PRIVATE KEY-----\n", encoding="utf-8")

    result = run_hook(tmp_path)

    assert result.returncode == 0
    assert report(result)["findings"] == []


def test_invalid_topology_and_rule_headings_have_malformed_exit_code(tmp_path: Path) -> None:
    (tmp_path / "topology.md").write_text("# Topology without front matter\n", encoding="utf-8")
    (tmp_path / "BUSINESS_RULES.md").write_text("### RULE-1: Missing zero padding\n", encoding="utf-8")

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 3
    assert {item["rule"] for item in data["findings"]} == {
        "invalid_topology_document",
        "invalid_rule_heading",
    }


def test_an_empty_rule_catalog_needs_the_explicit_marker(tmp_path: Path) -> None:
    rules = tmp_path / "BUSINESS_RULES.md"
    rules.write_text("# Business Rules\n\nAt extraction: 0 confirmed rules.\n", encoding="utf-8")
    assert {item["rule"] for item in report(run_hook(tmp_path))["findings"]} == {"missing_rule_heading"}

    rules.write_text("# Business Rules\n\n_No business rules were confirmed in this run._\n", encoding="utf-8")
    result = run_hook(tmp_path)
    assert result.returncode == 0
    assert report(result)["findings"] == []


def test_a_topology_without_a_domains_table_is_malformed(tmp_path: Path) -> None:
    (tmp_path / "topology.md").write_text('---\nsystem: "Example"\n---\n# Topology\n', encoding="utf-8")

    result = run_hook(tmp_path)

    assert result.returncode == 3
    assert report(result)["findings"][0]["rule"] == "invalid_topology_document"


def test_a_units_rules_document_is_checked_like_the_rule_catalog(tmp_path: Path) -> None:
    (tmp_path / "understanding").mkdir()
    (tmp_path / "understanding" / "rules.md").write_text("### RULE-tax.calc-1a2b3c4d: Round\n\nBody.\n", encoding="utf-8")
    assert run_hook(tmp_path).returncode == 0
    (tmp_path / "understanding" / "rules.md").write_text("### RULE-1: Bad id\n", encoding="utf-8")
    assert report(run_hook(tmp_path))["findings"][0]["rule"] == "invalid_rule_heading"


def test_large_files_that_are_not_validated_are_never_read(tmp_path: Path) -> None:
    (tmp_path / "scratch").mkdir()
    (tmp_path / "scratch" / "inventory.json").write_bytes(b"x" * (64 * 1_048_576))

    result = run_hook(tmp_path)

    assert result.returncode == 0
    assert report(result)["checked"] == {"files": 1, "bytes": 0}


def test_oversized_validated_file_fails_closed_with_bounded_error_report(tmp_path: Path) -> None:
    (tmp_path / "BUSINESS_RULES.md").write_bytes(b"x" * (16 * 1_048_576 + 1))

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 5
    assert data["errors"] == [{"code": "file_too_large", "path": "BUSINESS_RULES.md"}]
    assert data["checked"]["bytes"] == 0


def test_rule_catalog_ignores_prose_headings_code_fences_and_a_bom(tmp_path: Path) -> None:
    rules = tmp_path / "BUSINESS_RULES.md"
    rules.write_text(
        "# Business Rules\n\n## Rule index\n\n### RULE-001: Total\n\n```\n### RULE-9: shown as an example\n```\n",
        encoding="utf-8",
    )
    (tmp_path / "topology.md").write_text("﻿" + VALID_TOPOLOGY, encoding="utf-8")

    result = run_hook(tmp_path)

    assert result.returncode == 0
    assert report(result)["findings"] == []


def test_finding_limit_fails_closed_and_keeps_report_bounded(tmp_path: Path) -> None:
    (tmp_path / "BUSINESS_RULES.md").write_text("### RULE-1: Missing zero padding\n" * 10_001, encoding="utf-8")

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 5
    assert len(data["findings"]) == 10_000
    assert data["errors"] == [{"code": "finding_count_limit_exceeded", "path": "BUSINESS_RULES.md"}]


def test_symlink_is_not_followed(tmp_path: Path) -> None:
    target = tmp_path / "outside.txt"
    target.write_text("password=TEST_ONLY_SECRET_12345\n", encoding="utf-8")
    link = tmp_path / "linked.txt"
    try:
        link.symlink_to(target)
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"symlink creation is unavailable: {exc}")

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 5
    assert data["findings"] == []
    assert data["errors"] == [{"code": "symlink_not_followed", "path": "linked.txt"}]
    assert "TEST_ONLY_SECRET_12345" not in result.stdout + result.stderr


def test_network_style_output_paths_are_rejected_without_opening(tmp_path: Path) -> None:
    result = run_hook(Path("//invalid.example/share"))

    assert result.returncode == 5
    assert report(result)["errors"] == [{"code": "network_path_not_allowed", "path": "."}]


def test_missing_cli_argument_has_machine_readable_usage_error() -> None:
    result = subprocess.run(
        [sys.executable, str(HOOK)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=15,
    )

    assert result.returncode == 64
    assert result.stderr == ""
    data = json.loads(result.stdout)
    assert data["errors"] == [{"code": "invalid_cli", "path": "."}]


def test_mermaid_problems_are_redacted_warnings_that_do_not_block(tmp_path: Path) -> None:
    marker = "TEST_ONLY_DIAGRAM_MARKER"
    app = tmp_path / "applications" / "sample-app" / "assessment"
    app.mkdir(parents=True)
    (app / "ARCHITECTURE.mmd").write_text(
        f'flowchart TB\n    svc_a["A"] --> end\n    svc_b[{marker}]\n', encoding="utf-8"
    )
    (app / "call-graph.mmd").write_text('flowchart TD\n    svc_a["A"] --> svc_b["B"]\n', encoding="utf-8")
    (app / "notes.md").write_text(
        "# Notes\n\n```mermaid\nsequenceDiagram\n    svc_a->>svc_b: one; two\n```\n", encoding="utf-8"
    )

    # The worker runs the hook isolated (-I): the lint still loads from beside the hook.
    result = subprocess.run(
        [sys.executable, "-I", str(HOOK), "--output-dir", str(tmp_path)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=15,
    )
    data = report(result)

    assert result.returncode == 0
    assert data["findings"] == []
    assert data["warnings"] == [
        {"category": "diagram", "line": 2, "path": "applications/sample-app/assessment/ARCHITECTURE.mmd", "redacted": True, "rule": "reserved-id"},
        {"category": "diagram", "line": 3, "path": "applications/sample-app/assessment/ARCHITECTURE.mmd", "redacted": True, "rule": "unquoted-label"},
        {"category": "diagram", "line": 5, "path": "applications/sample-app/assessment/notes.md", "redacted": True, "rule": "unescaped-semicolon"},
    ]
    assert marker not in result.stdout + result.stderr
