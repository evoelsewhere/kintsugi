# ADR-0086: Record what of the source a job was shown, and check citations against it

- Status: Accepted
- Date: 2026-10-29
- Decision register: D100

## Context

[ADR-0085](0085-checked-citations-and-bounded-absence.md) checks that a citation names a file of the sources and lines it has. It cannot tell a line the agent read from a line it never saw: a plausible line number in a real file passes. The agent's own word about what it read is not evidence either. The kernel already knows: every `read` and `grep` passes through it, and pi's `read` reports how many lines it kept after truncation. What it emitted was the call and its input (`tool.call`), not the lines shown.

Two limits shape the decision:

- **Not every read is visible.** `shell` and `git` can print source (`sed -n`, `cat`, `git show`) and the kernel cannot tell which lines from the command. A line missing from such a record may still have been read: the record's coverage is then unknown, not empty.
- **A specification also carries citations it did not read itself.** The specification job is given the unit's rules and findings, whose citations were checked by their own workflows (citation referees, refuters); copying one is not a defect.

## Decision

1. **The kernel reports what it showed.** A new job event `source.read` (`tool`, `path` relative to the job workspace, `from`, `to`; `to` null for the rest of the file) is emitted by `read` (from its `offset` and `limit` and pi's truncation details: the lines the output kept) and by `grep` (each run of consecutive lines its output showed, matches and context, after truncation). The event carries no content. A script of `codemode` calls the same tools, so its reads are reported too. The launcher passes the event between processes; nothing else in the runtime changes, and no tool is added.
2. **The orchestrator keeps a record per agent step.** An agent step may name `readsTo` (a scratch path, placeholders allowed). The runner collects the job's `source.read` events of files under `as-is/` across its attempts, merged per file, with paths as citations name them (`<repository id>/<path>`), and counts the calls of `shell` and `git`. It saves `{agent, complete, unrecorded, files}` there; `complete` is false when such a call was made.
3. **The understand stage checks the specification against it.** The specification step saves its record at `scratch/<app>/understand/reads/<module>/<unit>.json` (`understandReadsPath`, `understand_reads_path`; intermediate, never published). `finish_items.py` reads it and writes into the unit's `understanding.md`:
   - `readRecord` (`complete` or `partial`), and `sourceLines` and `sourceLinesShown`, the lines of the item's files and how many of them the job was shown;
   - `citationsUnshown` and a section *Citations the specification job was not shown*: the valid source citations of `spec.md` whose lines no single read showed, leaving out those a rule or finding of the item cites (copied from a checked document). When the record is partial the section says which tools read without telling which lines, so a reader does not take the list for proof.

   As with ADR-0085, the check reports and never corrects or fails. Without a record (a run before this change, or a step without `readsTo`) nothing is said.
4. **Security.** The event and the record hold paths and line numbers only, never file content; the record stays in the job's scratch and is not committed. No tool, permission or reach is added to the agents, so the kernel's security boundary is unchanged; the change was reviewed against [the security concept](../architecture/concepts/security.md) on that basis.

## Consequences

- A reviewer sees how much of a unit's code the analyst was shown and which citations name lines it never saw; the known-answer eval can compare runs on it.
- A citation inside a range that was shown can still not support its statement: the record shows reading, not understanding.
- An agent that reads through `shell` makes its record partial. If that turns out to be common, the agents' instructions (or `denyCommandPatterns`) can steer reading to `read` and `grep`; the record shows how often it happens first.
- Each read adds an event to the job's stream; reads are few compared with streamed text.

## Not done

- Records for the agents of workflows (`extract-rules`, `harden-scan`) and for the design and review stages, whose documents cite the source too.
- Keeping the record beyond the run (in the database) or showing coverage in the portal.
- The provenance marker of untrusted content on tool results (`read`, `grep`, `web_fetch`, and the member MCP bridge), planned with this work; it touches the member bridge and gets its own decision.

## Alternatives considered

- **Derive the reads from `tool.call` inputs in the orchestrator.** The input says what was asked (`offset`, `limit`), not what was shown: a read without a limit is cut at 2,000 lines or 50 KB, which only the tool knows.
- **Parse `shell` commands for the files and lines they print.** Fragile and unbounded (pipes, globs, `awk`); counting the calls and calling the record partial is honest about what is not known.
- **Fail a run on an unshown citation.** Too early: the level of noise (copied citations, shell reads) is to be seen on real runs first.
