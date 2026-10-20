from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[7]
HOOKS = ROOT / "packages" / "agents" / "builtin" / "plugins" / "understand" / "hooks"
HOOK = HOOKS / "job_output.py"
MASK = HOOKS / "mask_output.py"

# Credential-shaped test values; none of them is a real secret.
VALUES = {
    "assignment": "TEST_ONLY_hunter2_value",
    "cloud": "AKIA" + "ABCDEFGHIJKLMNOP",
    "token": "ghp_" + "a1b2c3d4e5f6g7h8i9j0k1l2",
    "bearer": "Bearer " + "abcdefghijklmnopqrstuvwxyz0123",
    "uri_password": "s3cretpass",
    "ado_password": "AdoSecret99",
}


def run(script: Path, output_dir: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script), "--output-dir", str(output_dir)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )


def report(result: subprocess.CompletedProcess[str]) -> dict[str, Any]:
    assert result.stderr == ""
    return json.loads(result.stdout)


def sample() -> str:
    return "\n".join(
        [
            "# Notes",
            f"db.password = {VALUES['assignment']}",
            f"aws key {VALUES['cloud']} is hardcoded",
            f"token seen: {VALUES['token']}",
            f"Authorization: {VALUES['bearer']}",
            f"url postgres://app:{VALUES['uri_password']}@db.internal/main",
            f"Server=db;User Id=sa;Password={VALUES['ado_password']};",
            "api_key: changeme",
            "plain prose line",
            "",
        ]
    )


def test_masks_every_credential_kind_and_the_hook_then_passes(tmp_path: Path) -> None:
    target = tmp_path / "applications" / "demo" / "assessment" / "analysis"
    target.mkdir(parents=True)
    file = target / "structure.md"
    file.write_text(sample(), encoding="utf-8")

    assert run(HOOK, tmp_path).returncode == 2

    result = run(MASK, tmp_path)
    data = report(result)

    assert result.returncode == 0
    assert data["files"] == 1
    assert {item["rule"] for item in data["masked"]} >= {
        "credential_assignment",
        "cloud_access_key",
        "token",
        "bearer_token",
        "connection_string",
    }
    assert all(item["path"] == "applications/demo/assessment/analysis/structure.md" for item in data["masked"])
    text = file.read_text(encoding="utf-8")
    for value in VALUES.values():
        assert value not in text
        assert value not in result.stdout
    # Previews stay, the placeholder and the prose are untouched, and no line moved.
    assert "db.password = TE****" in text
    assert "AKIA****" in text
    assert "api_key: changeme" in text
    assert "plain prose line" in text
    assert len(text.split("\n")) == len(sample().split("\n"))
    assert run(HOOK, tmp_path).returncode == 0


def test_removes_a_private_key_block_but_keeps_the_lines_around_it(tmp_path: Path) -> None:
    file = tmp_path / "keys.md"
    file.write_text(
        "before\n-----BEGIN RSA PRIVATE KEY-----\nTUlJRXBBSUJBQUtDQVFFQQ==\nbWFzay10ZXN0\n-----END RSA PRIVATE KEY-----\nafter\n",
        encoding="utf-8",
    )

    data = report(run(MASK, tmp_path))

    assert [item["rule"] for item in data["masked"]] == ["private_key"]
    text = file.read_text(encoding="utf-8")
    assert "TUlJRXBBSUJBQUtDQVFFQQ" not in text and "bWFzay10ZXN0" not in text
    assert text.startswith("before\n[private key removed]\n")
    assert text.endswith("after\n")
    assert run(HOOK, tmp_path).returncode == 0


def test_a_second_pass_changes_nothing(tmp_path: Path) -> None:
    (tmp_path / "a.md").write_text(sample(), encoding="utf-8")
    report(run(MASK, tmp_path))
    before = (tmp_path / "a.md").read_text(encoding="utf-8")

    data = report(run(MASK, tmp_path))

    assert data == {"version": 1, "files": 0, "masked": []}
    assert (tmp_path / "a.md").read_text(encoding="utf-8") == before


def test_binary_files_and_symlinks_are_left_for_the_hook(tmp_path: Path) -> None:
    binary = tmp_path / "blob.bin"
    binary.write_bytes(b"\xff\xfe\x00password=TEST_ONLY_hunter2_value\n")

    data = report(run(MASK, tmp_path))

    assert data["files"] == 0
    assert binary.read_bytes().startswith(b"\xff\xfe")


def test_reports_never_echo_a_credential_shaped_file_name(tmp_path: Path) -> None:
    name = "password=" + VALUES["assignment"] + ".md"
    (tmp_path / name).write_text("token: " + VALUES["token"] + "\n", encoding="utf-8")

    result = run(MASK, tmp_path)

    assert VALUES["assignment"] not in result.stdout
    assert report(result)["masked"][0]["path"] == "[redacted-path]"


def test_usage_error(tmp_path: Path) -> None:
    result = subprocess.run([sys.executable, str(MASK)], cwd=ROOT, capture_output=True, text=True, timeout=15, check=False)
    assert result.returncode == 64
