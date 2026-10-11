# ADR-0029: Job workspaces instead of OS sandboxes

- Status: Accepted
- Date: 2026-10-11
- Decision register: D06, D07, D32, D47
- Supersedes: [ADR-0021](0021-sandboxed-child-processes.md) (pi-sandbox child processes), [ADR-0020](0020-docker-api-via-socket-proxy.md) (Docker socket proxy)
- Amends: [ADR-0004](0004-runner-container-per-job.md) (runtime job isolation), [ADR-0027](0027-builtin-modernization-content.md) decision 5 (the standard script environment)

## Context

ADR-0004 isolated every runtime job in its own Docker container; ADR-0020 limited the worker's Docker
API access with a socket proxy; ADR-0021 proposed OS-level sandboxes per job instead (bubblewrap on
Linux, `sandbox-exec` on macOS, through pi-sandbox). Each of these needs host features the package
cannot count on everywhere: a Docker socket in the worker, user namespaces, or a specific OS. None of
them works the same on Windows, macOS and Linux, and developers on Windows could not run a real job.

What a job actually needs is narrower:

- the source repository at a fixed commit, and the step's inputs, which it must not change;
- one place to write results, checked before anything is published;
- no credentials or Kintsugi tokens it could read and leak;
- bounded time and output, and a reliable stop.

Runtime agent jobs have no shell (ADR-0023): the kernel's tools read only under the allowed roots and
write only to the output directory. Script steps (ADR-0027 decision 5) run Kintsugi's own scripts or
scripts a model wrote in an earlier job.

## Decision

1. **A job runs in a job workspace, not an OS sandbox.** "Sandbox" in older documents means this
   workspace. The same implementation runs on Windows, macOS and Linux:

   | Directory | Content | Access |
   |---|---|---|
   | `<data>/jobs/<id>/src` | detached worktree of the source repository at the job's commit | read-only (file attributes) |
   | `<data>/jobs/<id>/in` | the step's inputs: earlier steps' outputs, declared document-repo files | read-only (file attributes) |
   | `<data>/jobs/<id>/out` | the job's results | writable |
   | `<data>/jobs/<id>/tmp` | scratch; `HOME`, `TEMP`, `TMPDIR` point here | writable, deleted when the step ends |

2. **Script steps and hooks** run as child processes of the worker with:
   - `cwd` = the job directory and explicit path arguments only (no shell);
   - a cleared environment: `PATH`, `HOME`/`USERPROFILE`/`TEMP`/`TMP`/`TMPDIR` (into `tmp`), `LANG`,
     `PYTHONDONTWRITEBYTECODE` and similar; never credentials, `DATABASE_URL`, `KINTSUGI_SECRET_KEY` or
     Kintsugi tokens;
   - Python as `python3 -I -B -X utf8` (isolated mode: no `PYTHON*` variables, no user site, the
     script's directory not on `sys.path`); Node with its permission model (`--permission`, reads limited
     to the workspace and the script, writes to `out` and `tmp`, no child processes);
   - a wall-clock timeout and an output-size cap, enforced by killing the whole process tree
     (`taskkill /T /F` on Windows, the process group elsewhere); aborts kill the tree too;
   - the script's sha256 recorded with the run, for built-in and model-written scripts alike.
3. **Agent jobs** run in the worker process through the agent runtime (ADR-0023). The kernel's path
   confinement is their isolation: `read`, `ls`, `grep`, `find` only under `src` and `in`,
   `outputs_write` only under `out`. LLM credentials are decrypted per job and stay in memory.
4. **After every step**, before anything is indexed or published:
   - `out/restricted/` is stored as encrypted restricted records (`governance.restricted_record`) and
     removed from `out`; it never reaches Git, logs or summaries;
   - the JobOutput hook (`hooks/job_output.py`) checks `out/` as a script step; any finding fails the step
     with a reason built from the hook's redacted report;
   - the files are indexed as artifacts with their provenance.
   A top-level run then hands `out/` to the document repo writer (ADR-0019).
5. **There is no OS-level isolation**, and the documents say so: no network blocking, and the process
   runs as the worker's OS user. The controls are the workspace boundary, the cleared environment,
   read-only sources and inputs, the kernel's path confinement for agents, the limits, and the JobOutput
   hook before anything is published.
6. **The standard script environment** of ADR-0027 decision 5 is this workspace: same interpreters
   (Python 3.12, Node 22, standard libraries only, nothing installed at run time), same read-only source
   and inputs, same writable output and scratch, same limits and provenance. It is not a bubblewrap
   sandbox, and "no network" is not enforced; scripts that need the network are not run.
7. **The package needs no Docker socket and no per-job container.** The `docker-proxy` and
   `egress-proxy` services and the `kintsugi-runner` image are removed; the worker image carries Git,
   Python 3.12 and Node 22.

## Consequences

- Real jobs run on every developer platform, including Windows, with the same code as production.
- A malicious script or a compromised dependency can read what the worker's OS user can read and can
  open network connections. Mitigations: run the worker as a dedicated unprivileged user with access to
  its data directory only, keep credentials out of its filesystem (they live encrypted in Postgres),
  never install packages at run time, and review every built-in script change. Operators who need
  network isolation put the worker container on a network without internet access except to the LLM
  providers and Git servers.
- Memory, CPU and process-count limits are not enforced per step (the container's limits apply to the
  whole worker); time and output size are.
- Read-only marking is advisory on Windows directories (only files honour the attribute) and does not
  stop a process running as root on Linux; the worker must not run as root.
- Agent jobs share the worker process: a pi failure is contained by the kernel's job loop, not by a
  process boundary. Moving agent jobs into a child process stays possible behind the same workspace.

## Alternatives considered

- **Per-job Docker containers (ADR-0004) with a socket proxy (ADR-0020).** Rejected: needs the Docker
  socket in the worker and runner images, and does not work for development without Docker.
- **pi-sandbox / bubblewrap / sandbox-exec (ADR-0021).** Rejected: different on every OS, unavailable on
  Windows, and dependent on host kernel features (user namespaces) that hardened hosts disable.
- **A VM per job.** Rejected: far too heavy for a self-hosted package.
