# ADR-0036: The `mermaid-diagrams` skill is the WH-2099 mermaid skill

- Status: Accepted
- Date: 2026-10-14
- Decision register: D51 (amended)

## Context
[ADR-0032](0032-mermaid-diagrams-skill.md) gave Kintsugi a `mermaid-diagrams` skill written for its own artifacts: a diagram type per artifact, syntax-safety rules for untrusted legacy names, size limits and a short set of condensed references (flowchart, sequence, er, c4, state), adapted from softaworks/agent-toolkit. It covered five diagram types and nothing else, so a diagram of another kind (a gantt, a class diagram, a mindmap, an architecture or a block diagram) had no syntax reference.

[WH-2099/mermaid-skill](https://github.com/WH-2099/mermaid-skill) (MIT, commit `982d903`) is a maintained skill whose references are synchronised with the Mermaid documentation: 23 diagram types and the configuration pages (theming, directives, layouts, math).

## Decision
1. The built-in `mermaid-diagrams` skill, in both plugins (`understand` and `modernize`, kept identical by a test), is the WH-2099 skill **as published**: its `SKILL.md` and its `references/`, with the MIT licence in `LICENSE`. Only the `name` in the frontmatter changes (`mermaid` to `mermaid-diagrams`), so the agents, the commands' `metadata.skills`, the tests and the lint keep working unchanged.
2. The Kintsugi-specific text of the previous skill is **removed from the skill**: the artifact-to-diagram table, the syntax-safety rules for untrusted names, the size limits, the checklist and the five condensed references. ADR-0032 decision 2 is superseded by this decision.
3. Everything else of ADR-0032 stands: every diagram is Mermaid, the drawing agents load the skill, `scripts/mermaid_lint.py` checks the rules (ids, keywords, quoted labels, `click`/`href`, size limits) and the JobOutput hook reports its findings as non-blocking warnings.

## Consequences
- Agents can draw any Mermaid diagram type and read an up-to-date syntax reference for it.
- The agents are no longer told in the skill to sanitise ids, quote labels or stay within the size limits, nor which diagram fits which artifact. The commands and agent files still name the artifact diagrams, and the JobOutput hook still reports the rule violations as warnings, but a runtime agent has no shell and cannot run the lint itself, so more diagrams may reach a review with warnings, and a name crafted in the legacy source is no longer warned about in the prompt.
- The skill's `SKILL.md` asks for theming and ends with a `$ARGUMENTS` placeholder that a runtime job leaves as text; the portal themes diagrams itself, and the lint does not reject an `init` directive.
- The `references/` grow from about 15 KB to about 570 KB per plugin (two copies); they stay on disk beside the job inputs and are read on demand, so a job's system prompt carries only the `SKILL.md` text, which is shorter than before.
- To restore the Kintsugi rules, add them back to `SKILL.md` (the previous text is in the Git history before this change) or to the agent files.

## Alternatives considered
- **Replace the references only and keep the Kintsugi `SKILL.md`**: keeps the safety rules and the size limits in the prompt; not chosen, the skill was to be replaced as published.
- **Take the skill under its own name (`mermaid`)**: would change every agent, command, test and the ADR-0032 vocabulary for no gain.
