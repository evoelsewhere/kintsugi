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
    assert {item["rule"] for item in report(run_hook(tmp_path))["findings"]} == {"missing_rule_entry"}

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
    app = tmp_path / "10-applications" / "sample-app" / "01-legacy"
    app.mkdir(parents=True)
    (app / "architecture.mmd").write_text(
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
        {"category": "diagram", "line": 2, "path": "10-applications/sample-app/01-legacy/architecture.mmd", "redacted": True, "rule": "reserved-id"},
        {"category": "diagram", "line": 3, "path": "10-applications/sample-app/01-legacy/architecture.mmd", "redacted": True, "rule": "unquoted-label"},
        {"category": "diagram", "line": 5, "path": "10-applications/sample-app/01-legacy/notes.md", "redacted": True, "rule": "unescaped-semicolon"},
    ]
    assert marker not in result.stdout + result.stderr


RULE_ID = "RULE-tax.calc-1a2b3c4d"
INDEX = (
    "# Business rules - tax/calc\n\n"
    "| ID | Name | Category | Priority | Confidence | Version | Status | Source | Rule file |\n"
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n"
    f"| {RULE_ID} | Round | Calculation | P0 | High | 1 | confirmed | `src/TAX.cbl:3` | [{RULE_ID}](rules/{RULE_ID}.md) |\n"
)


def rule_file(rule_id: str = RULE_ID, declared: str | None = None) -> str:
    return f'---\nid: "{declared or rule_id}"\nname: "Round"\n---\n# {rule_id}: Round\n\n## Summary\n\nText.\n'


def test_a_rules_index_with_its_rule_files_is_valid(tmp_path: Path) -> None:
    unit = tmp_path / "understanding"
    (unit / "rules").mkdir(parents=True)
    (unit / "rules.md").write_text(INDEX, encoding="utf-8")
    (unit / "rules" / f"{RULE_ID}.md").write_text(rule_file(), encoding="utf-8")

    result = run_hook(tmp_path)

    assert result.returncode == 0
    assert report(result)["findings"] == []


def test_an_index_row_whose_rule_file_is_missing_is_malformed(tmp_path: Path) -> None:
    (tmp_path / "rules.md").write_text(INDEX, encoding="utf-8")

    result = run_hook(tmp_path)

    assert result.returncode == 3
    assert [(item["rule"], item["line"]) for item in report(result)["findings"]] == [("missing_rule_file", 5)]


def test_an_aggregate_index_may_link_files_outside_its_tree(tmp_path: Path) -> None:
    (tmp_path / "BUSINESS_RULES.md").write_text(INDEX.replace(f"(rules/{RULE_ID}.md)", f"(../01-legacy/tax/calc/rules/{RULE_ID}.md)"), encoding="utf-8")

    assert run_hook(tmp_path).returncode == 0


def test_an_index_row_with_a_bad_id_or_no_link_is_malformed(tmp_path: Path) -> None:
    (tmp_path / "BUSINESS_RULES.md").write_text(
        INDEX + "| RULE-1 | Bad id | Policy | P2 | High | 1 | confirmed | `a:1` | [x](rules/x.md) |\n" + f"| {RULE_ID}-x | No link | Policy | P2 | High | 1 | confirmed | `a:1` | none |\n",
        encoding="utf-8",
    )

    findings = report(run_hook(tmp_path))["findings"]

    assert sorted((item["rule"], item["line"]) for item in findings) == [("invalid_rule_row", 6), ("missing_rule_file", 5), ("missing_rule_link", 7)]


def test_a_rule_file_must_declare_its_own_id_and_title(tmp_path: Path) -> None:
    (tmp_path / "rules").mkdir()
    (tmp_path / "rules" / f"{RULE_ID}.md").write_text(rule_file(declared="RULE-other.x-00000000"), encoding="utf-8")
    (tmp_path / "rules" / "RULE-tax.calc-ffffffff.md").write_text("# RULE-tax.calc-ffffffff: no front matter\n", encoding="utf-8")

    result = run_hook(tmp_path)

    assert result.returncode == 3
    assert sorted(item["rule"] for item in report(result)["findings"]) == ["invalid_rule_file", "invalid_rule_file"]


def test_an_index_with_no_rules_needs_the_explicit_line(tmp_path: Path) -> None:
    index = tmp_path / "rules.md"
    index.write_text("# Business rules\n\n| ID | Name |\n| --- | --- |\n", encoding="utf-8")
    assert {item["rule"] for item in report(run_hook(tmp_path))["findings"]} == {"missing_rule_entry"}

    index.write_text("# Business rules\n\n_No business rules were confirmed in this run._\n", encoding="utf-8")
    assert run_hook(tmp_path).returncode == 0


@pytest.mark.parametrize("prose,second", [
    ("See GAP-CARD01-0002.", ""),
    ("", "| GAP-CARD01-0002 | unresolved | Which mode? | legacy/a.cbl:10 | blocking |\n"),
])
def test_gap_problems_are_rejected_before_the_specification_is_reused(tmp_path: Path, prose: str, second: str) -> None:
    spec = tmp_path / "10-applications/demo/01-legacy/card/main/spec.md"
    spec.parent.mkdir(parents=True)
    spec.write_text("# Unit\n\n" + prose + "\n\n## Gaps and questions\n\n"
                    "| ID | Kind | Question | Where | Impact |\n| --- | --- | --- | --- | --- |\n"
                    "| GAP-CARD01-0001 | unresolved | Which mode? | legacy/a.cbl:10 | risk |\n" + second)
    result = run_hook(tmp_path)
    assert result.returncode == 3
    assert any(f["rule"] == "invalid_specification_gaps" for f in report(result)["findings"])
