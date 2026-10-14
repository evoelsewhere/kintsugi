from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[7]
HOOK = ROOT / "packages" / "agents" / "builtin" / "plugins" / "understand" / "hooks" / "job_output.py"

VALID_TOPOLOGY = {
    "system": "Example app",
    "root": {"id": "root", "name": "root", "kind": "group", "children": []},
    "edges": [],
    "entryPoints": [],
    "deadEnds": [],
    "observations": ["Example observation"],
    "flows": [
        {"name": "Example flow", "steps": [{"label": "Start", "nodes": ["root"]}]}
    ],
}


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
    topology = tmp_path / "assessment" / "sample-app" / "topology.json"
    topology.write_text(json.dumps(VALID_TOPOLOGY), encoding="utf-8")
    rules = tmp_path / "assessment" / "sample-app" / "BUSINESS_RULES.md"
    rules.write_text("### RULE-001: Calculate the total\n\nRule body.\n", encoding="utf-8")

    result = run_hook(tmp_path)

    assert result.returncode == 0
    assert report(result)["findings"] == []


def test_credential_findings_are_redacted_in_json_and_stderr(tmp_path: Path) -> None:
    marker = "TEST_ONLY_NOT_A_CREDENTIAL_9F31"
    (tmp_path / "output.txt").write_text(f"API_KEY={marker}\n", encoding="utf-8")

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 2
    assert data["findings"] == [
        {
            "category": "credential",
            "line": 1,
            "path": "output.txt",
            "redacted": True,
            "rule": "credential_assignment",
        }
    ]
    assert marker not in result.stdout + result.stderr


def test_token_and_bearer_shapes_are_detected_without_echo(tmp_path: Path) -> None:
    prefixed = "ghp_" + "A" * 24
    bearer = "B" * 24
    camel_case = "TEST_ONLY_CAMEL_CASE_VALUE"
    (tmp_path / "tokens.txt").write_text(
        f"service-token={prefixed}\nAuthorization: Bearer {bearer}\ndbPassword={camel_case}\n",
        encoding="utf-8",
    )

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 2
    assert {item["rule"] for item in data["findings"]} >= {"token", "bearer_token", "credential_assignment"}
    assert any(item["line"] == 3 and item["rule"] == "credential_assignment" for item in data["findings"])
    assert prefixed not in result.stdout + result.stderr
    assert bearer not in result.stdout + result.stderr
    assert camel_case not in result.stdout + result.stderr


def test_credential_shaped_file_names_are_redacted_too(tmp_path: Path) -> None:
    marker = "TEST_ONLY_PATH_SECRET_2931"
    path = tmp_path / f"password={marker}.txt"
    path.write_text(f"api_key={marker}\n", encoding="utf-8")

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 2
    assert data["findings"][0]["path"] == "[redacted-path]"
    assert marker not in result.stdout + result.stderr


def test_cloud_key_and_connection_string_are_detected_without_echo(tmp_path: Path) -> None:
    marker = "AKIA" + "A" * 16
    (tmp_path / "output.txt").write_text(
        f"access key {marker}\npostgres://unit:TEST_ONLY_PASSWORD@invalid.example/db\n",
        encoding="utf-8",
    )

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 2
    assert {item["rule"] for item in data["findings"]} == {"cloud_access_key", "connection_string"}
    assert marker not in result.stdout + result.stderr
    assert "TEST_ONLY_PASSWORD" not in result.stdout + result.stderr


def test_private_key_header_is_detected_without_echoing_body(tmp_path: Path) -> None:
    marker = "TEST_ONLY_PRIVATE_KEY_BODY"
    (tmp_path / "output.pem").write_text(
        f"-----BEGIN PRIVATE KEY-----\n{marker}\n-----END PRIVATE KEY-----\n",
        encoding="utf-8",
    )

    result = run_hook(tmp_path)

    assert result.returncode == 2
    assert "private_key" in {item["rule"] for item in report(result)["findings"]}
    assert marker not in result.stdout + result.stderr


def test_invalid_topology_and_rule_headings_have_malformed_exit_code(tmp_path: Path) -> None:
    (tmp_path / "topology.json").write_text('{"system":"sample"}', encoding="utf-8")
    (tmp_path / "BUSINESS_RULES.md").write_text("### RULE-1: Missing zero padding\n", encoding="utf-8")

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 3
    assert {item["rule"] for item in data["findings"]} == {
        "invalid_topology_schema",
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


def test_credentials_and_malformed_artifacts_have_combined_exit_code(tmp_path: Path) -> None:
    (tmp_path / "topology.json").write_text("{}", encoding="utf-8")
    (tmp_path / "settings.txt").write_text("password: TEST_ONLY_SECRET_12345\n", encoding="utf-8")

    result = run_hook(tmp_path)

    assert result.returncode == 4
    assert {item["category"] for item in report(result)["findings"]} == {
        "credential",
        "malformed_artifact",
    }
    assert "TEST_ONLY_SECRET_12345" not in result.stdout + result.stderr


def test_duplicate_json_keys_are_malformed(tmp_path: Path) -> None:
    (tmp_path / "topology.json").write_text(
        '{"system":"first","system":"second"}', encoding="utf-8"
    )

    result = run_hook(tmp_path)

    assert result.returncode == 3
    assert report(result)["findings"][0]["rule"] == "invalid_topology_schema"


def test_oversized_file_fails_closed_with_bounded_error_report(tmp_path: Path) -> None:
    (tmp_path / "oversized.txt").write_bytes(b"x" * (1_048_576 + 1))

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 5
    assert data["errors"] == [{"code": "file_too_large", "path": "oversized.txt"}]
    assert data["checked"]["bytes"] == 0


def test_finding_limit_fails_closed_and_keeps_report_bounded(tmp_path: Path) -> None:
    marker = "TEST_ONLY_SECRET_12345"
    (tmp_path / "many.txt").write_text((f"password={marker}\n") * 10_001, encoding="utf-8")

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 5
    assert len(data["findings"]) == 10_000
    assert data["errors"] == [{"code": "finding_count_limit_exceeded", "path": "many.txt"}]
    assert marker not in result.stdout + result.stderr


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
    app = tmp_path / "assessment" / "sample-app"
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
        {"category": "diagram", "line": 2, "path": "assessment/sample-app/ARCHITECTURE.mmd", "redacted": True, "rule": "reserved-id"},
        {"category": "diagram", "line": 3, "path": "assessment/sample-app/ARCHITECTURE.mmd", "redacted": True, "rule": "unquoted-label"},
        {"category": "diagram", "line": 5, "path": "assessment/sample-app/notes.md", "redacted": True, "rule": "unescaped-semicolon"},
    ]
    assert marker not in result.stdout + result.stderr


def test_diagram_warnings_never_hide_a_credential_finding(tmp_path: Path) -> None:
    (tmp_path / "ARCHITECTURE.mmd").write_text(
        'flowchart TB\n    svc_a["password=TEST_ONLY_NOT_A_SECRET_42"] --> end\n', encoding="utf-8"
    )

    result = run_hook(tmp_path)
    data = report(result)

    assert result.returncode == 2
    assert [item["rule"] for item in data["findings"]] == ["credential_assignment"]
    assert [item["rule"] for item in data["warnings"]] == ["reserved-id"]
    assert "TEST_ONLY_NOT_A_SECRET_42" not in result.stdout + result.stderr
