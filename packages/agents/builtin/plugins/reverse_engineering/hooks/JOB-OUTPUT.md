# JobOutput hook contract

## Purpose and lifecycle

Run this hook as a standard script step after a runtime job has written its candidate outputs and before the job output is committed or otherwise published. Invoke it inside the standard script environment (Python 3.12, standard library only, no network access). A non-zero exit blocks the output from being committed. This hook scans only the supplied output tree; it does not modify, delete, redact or upload files. It does not check for credentials: Kintsugi runs on managed team/enterprise LLM plans, and a pattern-based scan or rewrite produced false positives and corrupted generated scripts. The runtime must keep the output tree available until the report is recorded and a reviewer can correct findings.

## CLI

```text
python packages/agents/builtin/plugins/reverse_engineering/hooks/job_output.py --output-dir <job-output-directory>
```

`--output-dir` is required. The process writes one JSON report line to stdout on a normal scan, including usage and safety failures. It never writes scanned content, matching text, credential values, parser exceptions, or command arguments to the report. Stderr is reserved for unexpected interpreter/runtime failures; the implementation suppresses file contents and exception messages.

Exit codes:

| Code | Meaning | Commit allowed |
| ---: | --- | --- |
| `0` | Scan completed; no malformed-artifact findings (diagram warnings may be present) | Yes, subject to other job gates |
| `3` | Malformed artifact found | No |
| `5` | Scan incomplete or unsafe input (for example, symlink, special file, read failure, or a configured bound exceeded) | No |
| `64` | Invalid CLI invocation | No |

Input/safety errors take precedence over finding codes because an incomplete scan cannot be treated as clean. The hook is fail-closed.

## JSON report

The report has this shape (values shown are examples, not scan output):

```json
{
  "version": 1,
  "exit_code": 3,
  "checked": { "files": 1, "bytes": 18 },
  "findings": [
    {
      "category": "malformed_artifact",
      "rule": "invalid_topology_document",
      "path": "applications/sample-app/assessment/topology.md",
      "line": 1,
      "redacted": true
    }
  ],
  "warnings": [
    {
      "category": "diagram",
      "rule": "reserved-id",
      "path": "applications/sample-app/assessment/ARCHITECTURE.mmd",
      "line": 7,
      "redacted": true
    }
  ],
  "errors": []
}
```

`warnings` has the same redacted shape as `findings` and never changes the exit code (at most 1,000 are reported). The worker keeps their number and the first 20 on the step's summary (`jobOutputHook.diagramWarnings`, `jobOutputHook.diagramWarningsFirst`).

Each finding contains only a category, a stable rule identifier, a relative path, a one-based line number, and `redacted: true`; it never contains source content. Error entries contain a relative path and a stable error code, not exception text. Paths are relative to the supplied output directory.

## Checks

The hook validates artifacts when encountered at any depth:

- `topology.md` must be a topology document: front matter that names the `system`, then a `## Domains` section (`invalid_topology_document` otherwise). The raw topology JSON is scratch of the run and is checked by `scripts/render_topology.py`, not here.
- `BUSINESS_RULES.md` and a unit's `rules.md` must contain at least one section heading of the form `### RULE-NNN: <title>` (or the item-namespaced `RULE-<module>.<unit>-<hash>`). Any heading beginning with `RULE-` that does not match that shape is malformed; other headings (`## Rules`, `## Rule index`) and lines inside fenced code blocks are ignored. A leading byte-order mark is accepted.

Every `.mmd` file and every `mermaid` fence in a Markdown file is checked with the built-in Mermaid lint (`scripts/mermaid_lint.py`, the rules of the `mermaid-diagrams` skill; no rendering). Its problems are **warnings**: the lint is a heuristic subset of Mermaid's grammar, and a diagram problem is not worth discarding an otherwise valid output. A reviewer sees the warnings on the job and fixes the diagram in the pull request. Only the rule id, path and line are reported. If the lint cannot be loaded the scan continues without it; if it fails on a file, that file gets a `diagram_lint_failed` warning.

The checks identify required artifact structure; they do not prove that an artifact is semantically correct. Findings must be reviewed and corrected by the job owner.

## Bounds and hostile-input behavior

- Only `topology.md`, `BUSINESS_RULES.md`, `rules.md`, `.mmd` and `.md` files are opened; every other file (the run's scratch JSON, scripts, data) is counted and never read, so its size cannot fail a job.
- Maximum size of an opened file: 16 MiB; maximum aggregate bytes read: 256 MiB.
- Maximum regular files: 100,000.
- Maximum visited directories: 100,000; maximum directory entries: 200,000; maximum reported findings: 10,000. Exceeding any bound is a safety error and fails closed.
- Symlinks and Windows junctions are not followed. UNC/network-style output roots, non-regular files, unreadable files, files that change during scanning, and limit violations produce a safety error and exit `5`.
- JSON is decoded with duplicate-key and non-finite-number rejection. Parser errors are reduced to a stable finding; exception text is not emitted.
- The implementation uses only Python standard-library modules and performs no network access or writes to the output tree.

## Tests

Tests are in `hooks/tests/test_job_output.py`. Run from the repository root:

```text
python -m pytest -q packages/agents/builtin/plugins/reverse_engineering/hooks/tests
```
