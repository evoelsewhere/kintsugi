# Commit conventions

> Defines commit identity, trailers, and the default auto-commit behavior.

Every commit by Kintsugi has the **commit identity** as author and committer and carries the trailers that apply to it. The commit identity is an installation setting that admins with `git.manage` set in the portal (Settings → Git → Commit identity): a name and a plain email address, by default `kintsugi-bot <kintsugi-bot@kintsugi.invalid>` (`.invalid` never delivers mail). Use an address the Git server maps to the bot account to link the commits to it. The writer reads it for each write, so a change applies from the next write on; an unset or unusable value falls back to the default. The table below writes `kintsugi-bot` for whatever identity is set.

| Who | Branch | Author | Trailers |
|---|---|---|---|
| Kintsugi worker (PR) | `kintsugi/<agent>/<job-id>` | `kintsugi-bot` | `Kintsugi-Job: <id>`, `Kintsugi-Agent: <agent>@<version>` |
| Kintsugi worker (auto-commit) | default branch | `kintsugi-bot` | same as above |
| State change on behalf of a user | default branch (`units/**`) | `kintsugi-bot` | `Kintsugi-Actor: <user>`, `Kintsugi-Unit: <unit-id>` |
| Change published by a user from the portal (e.g. `kintsugi.yaml`) | `kintsugi/<user>/<write-id>` (PR) | `kintsugi-bot` | `Kintsugi-Actor: <user>` |
| Members | own branches | the member | `Assisted-by: <harness>` when AI-assisted |
| Standards and plugins changes | own branches, PR reviewed by the architect | the member | — |

Provenance records the document repo commit an artifact was produced against.

The `autoCommitPaths` default is `units/**`, `tasks/**`, `knowledge/**/generated/**`, and `assessment/**/generated/**` ([manifest schema](document-repo-manifest.md)). The starter template omits `autoCommitPaths` and therefore inherits all defaults; an explicit list replaces them. `**` spans folders, while `*` matches only within one path segment. Paths outside those defaults are delivered through pull requests. The planned uniform gate-record files are not auto-commit paths and will arrive by pull request.
