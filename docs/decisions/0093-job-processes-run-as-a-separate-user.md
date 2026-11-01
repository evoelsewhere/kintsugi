# ADR-0093: Job processes run as an OS user of their own, and provider credentials stay out of spawn environments

- Status: Accepted
- Date: 2026-11-01
- Decision register: D107
- Amends [ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md) (the OS account as the job boundary)
- Related: [ADR-0009](0009-llm-provider-config.md), [ADR-0040](0040-kernel-shell-and-git-tools.md), [ADR-0092](0092-least-privilege-for-built-in-agents.md)

## Context

Every job process gets a cleared environment (`jobEnvironment`), so nothing leaks through its own `env`. The leak is
sideways: script steps, hooks, the agent child and the agent's `shell` and `git` processes run as the worker's OS user,
and a process can read the environment its peers of the same user were started with (`/proc/<pid>/environ` on Linux, the
process memory on Windows). The worker's holds `DATABASE_URL` and `KINTSUGI_SECRET_KEY` (in the Compose package the worker
gets the whole `.env`); with both, every stored credential can be decrypted. The agent child also had the provider's
environment credentials (cloud regions, keys read from variables) in the environment it was started with.

Three ways out were weighed: a separate OS user for job processes; the worker dropping its secrets from its environment
(not possible: the block `/proc/<pid>/environ` shows is the one the process was started with); and keeping provider
credentials out of spawn environments. Per-job containers stay rejected (ADR-0029).

## Decision

1. **A job user.** When the worker's environment sets `KINTSUGI_JOB_UID` and `KINTSUGI_JOB_GID` (numeric, never 0),
   every script step, hook and agent child is started as that user (`runProcess`'s `runAs`, POSIX only); the agent's
   `shell` and `git` processes inherit it. The worker image creates `kintsugi-job` (10002:10002, no login shell). A
   half or malformed setting stops the worker at start; it never falls back to running jobs as itself. Unset, jobs run
   as the worker's user as before, and on Linux and macOS the worker logs a warning saying they can read its environment.
2. **The workspace is handed over per job.** Before a job process starts, its output and scratch folders (with what an
   earlier attempt left there) are given to the job user; the source and inputs stay the worker's, readable but not
   writable for the job.
3. **Provider credentials on stdin only.** The agent child gets the provider's API key, inline secrets and environment
   credentials on stdin and sets the environment credentials in its own `process.env` after it started; its spawn
   environment carries only the cleared job environment and the non-secret cache setting. The kernel's own processes
   get the cleared job environment, never these.
4. **Running the worker so it can switch users.** Starting a process as another user needs `CAP_SETUID` and
   `CAP_SETGID`, which a non-root container user does not get from Docker. The Compose package therefore offers a block
   that runs the worker as root with `cap_drop: [ALL]` and only `SETUID`, `SETGID`, `CHOWN`, `FOWNER`, `DAC_OVERRIDE` and
   `KILL` (switch user, hand over and clean up workspaces, stop a job's process tree), `no-new-privileges`, the job user
   ids, and `safe.directory` for git in the worker and the app (the mirrors then have two owners). The block is
   commented out until it has been tried on a Linux host; turning it on by default is the follow-up.
5. **Platforms.** The boundary is the Linux image. On Windows the setting is refused; on Windows, macOS and development
   machines job processes run as the worker's user and are not isolated from its secrets.

## Consequences

- With the job user set, a job process can no longer read the worker's environment or files that only the worker can
  read; a prompt injection that reaches a process (a custom agent with `shell`, a model-written script step) cannot
  take `DATABASE_URL` or `KINTSUGI_SECRET_KEY`.
- Residual risks: a job can still read whatever it shares a user with (other job processes running at the same time,
  and the agent child's memory from its own `shell`), and its own workspace, and send it out: there is no network egress
  filtering, so restrict the worker's network where the legacy code is not trusted. A compromised worker is root in
  its container with the capabilities above.
- Not done here (follow-ups): the Compose default (item 4) after a probe on Linux (`services/runtime/test/secret-isolation.test.ts`
  holds the probe; it runs as root in the image with the ids set); a non-superuser Postgres role for the API and the
  worker (`POSTGRES_USER` stays the database owner today); an Agent Builder warning for `shell` and `git`.
