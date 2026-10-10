---
description: Run this first — checks the environment where the code builds, records which source commit was checked, and says what to fix before anything else runs
argument-hint: <app> [target-stack]
arguments: app target_stack
metadata:
  audience: member
  upstream: commands/modernize-preflight.md
  agents: []
  reads: [kintsugi.yaml, assessment/<app>/INTENT.md, assessment/<app>/PREFLIGHT.md]
  writes: [assessment/<app>/PREFLIGHT.md]
  gates: [a person who knows the system answers the five Check 0 questions in the portal]
---

Check whether this environment — the member's machine, where the code builds — can analyze and eventually
modernize the application `$app`, and tell the member exactly what to fix before the other stages run into it.
Modernization runs fail late and confusingly when this is skipped: tests can't run without a build toolchain, the
member's proof scripts can't run without their interpreter, and dependency maps come out wrong when half the source
isn't in the tree.

This command runs in the member's harness through Kintsugi's member plugin. The five Check 0 questions are not
asked here: the portal asks them as a task for a person who knows the system, and the worker writes the answers to
`assessment/$app/PREFLIGHT.md`. This command does the checks that need a shell and a build toolchain, and the
source-completeness and scope-boundary checks.

Run every check even when an early one fails — the point is one complete
readiness report, not the first error.

## Where the code lives

Kintsugi already knows the code: the application's source repositories are registered in `kintsugi.yaml`
(`role: source`), and the task pack names the repository and the commit to check. The member works on a local
clone of each source repository, read-only, with the workspace repository checked out next to the target
repository. Nothing is ever copied, linked or cloned by this command.

- Locate the local clone of the source repository (from the task pack, or ask the member where it is). If it is
  missing, say how to clone it and stop the checks that need it, but still run the rest.
- Say in one line which repository and which commit you checked (`git -C <clone> rev-parse HEAD`), and whether it
  matches the commit recorded in `assessment/$app/INTENT.md`. A mismatch is a finding, not a reason to check out
  another commit yourself.
- If `$target_stack` starts with `--`, it is a flag, not a stack.

Never modify anything in the source repository. Kintsugi's member hooks refuse writes to it; do not work around them.

## Check 0 — The human answers (asked in the portal; these answers are not in the source)

The most expensive modernization mistakes are things a person who knows the
system answers in seconds. The portal asks **only** the five questions below — adds none —
and accepts "don't know" for any of them.

**The portal asks them as a task, never in chat text.** Each question has its own options, one of them "Don't
know", and the person can type an answer instead. Do not ask them in this session and do not answer them yourself.
Read the **Answers** section of `assessment/$app/PREFLIGHT.md`; if the task is still open, run the other checks —
none of them needs the answers — and say the task is pending.

1. **Scope** — Is this code the complete system, or one slice of a larger
   codebase? If a slice: what *outside* it depends on code *inside* it, and is
   breaking those consumers acceptable? (Check 6 verifies the crossing from the
   source; the answer says whether it *matters*.)
2. **Build & test locally** — Can this environment restore, build, and run the
   tests? Roughly how long does the full CI pipeline take?
3. **Bespoke build infrastructure** — Is there organization-specific build or
   dependency machinery (an internal package feed, a code generator, a wrapper
   around the standard build tool) a newcomer would not guess? Where is it
   documented?
4. **Prior attempts** — Has anyone tried to modernize this before? What went wrong?
5. **Off limits** — Is anything in this code not allowed to change in this
   pass (a component another team owns, a frozen branch, generated code)?

The worker writes each question in a section of `PREFLIGHT.md` called **Answers**, with the
person's answer **verbatim** under it — never paraphrase away a caveat — and commits it as `kintsugi-bot` with a
`Kintsugi-Actor: <user>` trailer. If a question has no answer (the person skipped it, or the task is still open),
**an open item the human must fill in** stands under it. All five always appear. When you write `PREFLIGHT.md`
below, keep the Answers section exactly as recorded.

## Check 1 — Detect the stack

Fingerprint the source repository from file extensions and manifests: languages, build
system, deployment and config descriptors. Report what you found and the rough
file split.

## Check 2 — Analysis tooling

The analysis stages (`assess`, `map`, `extract-rules`) run as Kintsugi runtime jobs and script steps in Kintsugi's
sandbox, so their tooling is not needed here. The member commands that run on this machine still need some. Check
availability (`command -v`), version and what degrades without it:

| Tool | Used by | Without it |
|---|---|---|
| `python3` (3.8 or newer; on Windows it may be `python` or `py -3`: use whichever runs Python 3 wherever a command says `python3`) | uplift, transform, reimagine, verify (member commands) | the plugin's proof and equivalence scripts can't run |
| `scc` (or `cloc`) | optional, local sizing | LOC falls back to `find` + `wc`; the runtime `assess` stage computes its own metrics either way |
| `lizard` | optional, local complexity | complexity is estimated from decision-keyword counts; the runtime stage is unaffected |

Give the platform's install one-liner for anything missing.

## Check 3 — Build toolchain (prove it on THIS code, not just presence)

**3a — Read the build definition first.** Something already builds this system.
Find the CI or pipeline definition (`azure-pipelines.yml`, `Jenkinsfile`,
`.github/workflows/`, `.gitlab-ci.yml`, build JCL procs, a `Makefile`) and the
build configuration above or beside the source (`Directory.Build.props` and
`nuget.config`; a parent POM, `settings.xml` or `.mvn/`; a private-registry
`.npmrc` or `pip.conf`; a root `build/`, `eng/` or `scripts/`). It is the most
honest record of the pinned toolchain, where dependencies really come from and
what a naive build skips. Quote the pinned version and the dependency source,
and flag anything bespoke: a homegrown binary-resolution scheme is what a
transformation must not discover halfway through. Never quote credentials from these files (feed tokens in
`nuget.config`, `.npmrc` or `settings.xml`): name the file and the setting, and mask the value.

**3b — Smoke test, escalating.** Find the compiler or interpreter for the
detected stack (GnuCOBOL `cobc`, a JDK with Maven or Gradle, `cc`/`make`,
`dotnet`, ...), then prove it works on this code:

- **Level 1, any stack:** syntax-compile one representative file
  (`cobc -fsyntax-only`, `javac`, `gcc -fsyntax-only`). Catches missing
  copybooks and includes, dialect flags, fixed versus free format.
- **Level 2, any stack with a build system:** restore and build ONE whole small
  project the way 3a says CI does. A one-file compile misses private feeds,
  code generation, shared props and pinned SDKs — where large codebases hide
  their surprises.

Build outputs must not land in the source clone: send them to a scratch directory outside it (`mktemp -d`) or
use the build tool's out-of-tree option; if the build tool can only build in place, build a throwaway copy in a
scratch directory instead.

A failed smoke test is the most valuable output of this command: report the
actual error and diagnose it (missing copybook or include path, missing dialect
flag, a dependency the standard feed cannot resolve). Level 2 being *impossible*
(no build system, a mainframe stack with no local runtime) is a fact, not a
failure: equivalence then falls back to recorded traces.

If `$target_stack` was given (else take the target from `assessment/$app/INTENT.md`), prove it with a throwaway project, not a version
string: in a scratch directory outside the source clone and the target repository (`mktemp -d`), create the
smallest project the stack allows, restore, build, run one passing test with its
real package manager and test framework, then delete it. A target that cannot
build here is a finding.

## Check 4 — Source completeness

The map is only as good as what is in the tree. Look for the stack's equivalents of:

- **Referenced-but-missing includes** — copybooks, headers, imports that resolve
  nowhere. Count them and list the top names.
- **Deployment and config descriptors** — JCL, CICS CSD, `web.xml` or route
  configs, cron and scheduler definitions. Without them, entry points and the
  code-to-storage join are guesswork.
- **Data definitions** — DDL, schemas, record layouts, ORM mappings.
- **Binary-only artifacts** — load modules, jars, DLLs with no source. Flag them now.

## Check 5 — Optional context

- **Production telemetry** — is an APM MCP server connected, or are batch logs
  and runtime exports available? (Enables the runtime overlay in assess.)
- **Version control** — does the source repository have real history, or one squashed import commit? (Change
  frequency sharpens risk ranking.)

## Check 6 — Scope boundary (is `$app` the whole world, or a slice?)

Every downstream stage assumes the registered source repositories of `$app` *are* the system. When the code is one
part of a larger codebase — a module of a monorepo that was split out, one solution among several repositories, a
subsystem sharing includes with sibling repositories — that assumption is the most dangerous
in the run, and nothing else checks it. Look for references that reach outside the source repository (relative
paths above its root, a parent build file or solution that is not in it, project or module references to sibling
repositories, packages built from other repositories and pulled from an internal feed), and for other source
repositories registered for this application or project that share code with it. If either is true, report both directions:

- **Outbound** — things inside that depend on source outside (project or module
  references, shared includes, a parent build file). The map and the delta
  catalog only see what is in the registered source repositories, so each one is a dependency they will
  silently miss. List them, and say whether registering another source repository would close the gap.
- **Inbound** — things outside that depend on things inside: the **blast
  radius**. An in-place migration of a node with outside consumers breaks each of
  them. Grep the manifests of the sibling repositories you have locally for references into this code, list the nodes
  they use, and say plainly that each needs an explicit decision *before* any
  in-place change: keep it buildable for old and new consumers during the
  transition, widen the scope to include the consumers, or schedule the break.

If the source repository is standalone, one line saying so is the whole check.

## Check 7 — Is the source protected from edits?

Every command is written never to edit the source repository, and Kintsugi's member hooks refuse writes to it, but a
hook only covers the tools it sees. This check is **read-only**: never edit a settings file and never suggest
loosening a permission.

- **Member hooks** — is Kintsugi's member plugin installed and enabled in this harness, with its source-protection
  hook active, and does it know the path of the local source clone? Say which plugin version you found.
- **Permission rules** — read whichever exist: the project's `.claude/settings.json` and
  `.claude/settings.local.json`, and the user settings (`~/.claude/settings.json`, or `settings.json` in
  `CLAUDE_CONFIG_DIR`). In each `permissions.deny` list, look for an `Edit` rule covering everything under the
  source clone: an absolute `Edit(//<real path of the clone>/**)`, a project-relative rule when the clone sits
  inside the project (`Edit(/<clone dir>/**)`; in user settings a leading `/` anchors at `~/.claude`), or a broader
  `Edit` deny. **If the clone's path goes through a symlink or junction, the rule must cover its real path**: a rule
  matches the path it names, not a link's target. A `Write(...)` rule does not count: file writes are matched
  through `Edit`. Report only which file holds the rule and the rule itself; user settings can hold credentials, so
  quote nothing else.

The status is ✅ or ⚠️, never ❌, and changes no command's verdict:

- **✅** — the member hook is active, or matching deny rules exist (best: both). Name the plugin version, the file
  and the rules. If one is a bare `Edit`, say it also blocks the workspace and target repositories, where commands write.
- **⚠️** — neither found. Say how to install or enable Kintsugi's member plugin, and print this snippet for the
  project's `.claude/settings.json` (merged into `permissions.deny` if that list exists):

  ```json
  { "permissions": { "deny": ["Edit(//<real path of the source clone>/**)"] } }
  ```

  Managed (organization) settings are not read here, so a rule set there would not show up.

Say this on either status, so a green row is not read as a guarantee: a hook or a permission rule covers the
harness's file tools and the shell commands it recognizes (`sed`, `tee`, `> file`), not a script that opens the
files itself. The hard guarantee is the operating system: a read-only clone (file permissions), a read-only mount,
or a sandbox that blocks shell writes.

## Report

Write `assessment/$app/PREFLIGHT.md` in your checkout of the workspace repository, on your own branch, and open a
pull request to the workspace repository (commit with an `Assisted-by: <harness>` trailer). Never push to its
default branch: Kintsugi indexes the file when the pull request merges. **Lead with the Answers section, exactly as
the portal recorded it, and the Check 6 finding** — downstream stages (`brief` above all) read those two. Record
which source repository and commit you checked, and on which machine (platform, not hostname).
Then a table, one row per check, status ✅ / ⚠️ / ❌, what was found and the fix
for anything not green, then a **Ready / Ready-with-gaps / Not ready** verdict per
stage:

- `assess`, `map`, `extract-rules` — Checks 1 and 4 mostly green and few missing includes (their tooling runs in
  Kintsugi's sandbox, so Check 2 does not gate them).
- `brief` — needs only the discovery artifacts (plus `DELTA_CATALOG.md` for a
  same-stack uplift); no tooling.
- `transform`, `reimagine` — also need Check 3 green for the **target** stack. A
  red legacy toolchain is Ready-with-gaps, not Not-ready: equivalence falls back
  to recorded traces instead of dual execution (normal for code with no local
  runtime).
- `harden` — runs in Kintsugi's sandbox like `assess`; stack-specific SAST tooling found here (Check 2) lets a
  member confirm dependency findings that the scan could only read from manifests.
- `uplift` — Check 3 green for the **target** version, plus, when `$target_stack`
  looks like a version bump: (a) is the **source** runtime also here? Both present
  means a true dual run; target-only means equivalence degrades to recorded
  outputs (say which). (b) Is the ecosystem's **migration tool** installed
  (`upgrade-assistant`, OpenRewrite, `pyupgrade`, `ng`)? Missing is
  Ready-with-gaps: the delta catalog is then agent-derived only. (c) Did Check 6
  find **inbound consumers**? That is Ready-with-gaps — no plan exists yet to
  record a decision in — but the gap that matters most: name the shared nodes and
  say `brief` must give each an explicit transition decision, and `uplift` will
  not migrate a shared node in place without one.

Print the table in the session too. End with the single most important fix if
anything is red, the link to the pull request, and the next step: the `assess` stage for `$app`, started from the
portal once the pull request is merged and the Check 0 task is answered.
