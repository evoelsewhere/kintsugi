# ADR-0081: Regenerate an existing design

- Status: Accepted (amends [ADR-0049](0049-design-sets-generated-by-the-runtime.md): "no regeneration of an existing design")
- Date: 2026-10-26
- Decision register: D95

## Context

[ADR-0049](0049-design-sets-generated-by-the-runtime.md) generates a design set once per unit and never overwrites it: the scaffold leaves a file that exists as it is, and the API refuses a unit that has the set already. It deferred regeneration "until staleness ([ADR-0045](0045-design-templates-are-project-data.md)) needs it".

Staleness needs it now. A project raises the `version` of a design set or a profile when its template changes ([ADR-0053](0053-design-template-profiles-by-unit-kind.md)); the portal then shows every design written against the older template as stale, and the only way to bring it up to date was to delete the unit's folder by hand in the document repository, merge that, and then generate. The same is true of a design the first run got wrong. The risk ADR-0049 named is still the one that matters: a person may have corrected the design in its pull request or afterwards, and a regeneration must not silently throw that away.

## Decision

1. **A design run can regenerate.** `POST …/design/runs` accepts `regenerate: true` with the set and the units. A unit is accepted when it **has a design of the set** (at least one file that conforms or has problems, whatever its version) and **no run or open pull request** on that set; a unit with no design is refused with the conflict `unwritten` ("generate it first"), a unit that is running or in a pull request keeps the conflicts of a first run. A set of the application regenerates the same way (`@app`).
2. **A regeneration is a normal run.** The stage is the same; the run's `inputs.scope` carries `regenerate: true`, which the plan passes to the scaffold (`scaffold_design.py --regenerate`) and states in the designer's task. The scaffold writes a fresh skeleton for every required document, and for every optional document the unit already has, into the run's output even though the file exists in the pinned documents; a file this run already wrote is kept, so a retried run does not lose finished work. Nothing is written under the pinned documents.
3. **The result is a pull request, never a commit.** The documents arrive as changes to the existing files in one pull request titled `Regenerate design …`; the default branch changes only when people merge it. The previous version stays in Git and is the left side of the pull request's diff, which is how a person sees what a regeneration drops.
4. **The designer starts again from the template.** Its task says that what is under `docs/` at the final paths is the previous version, replaced and not a source; what a person recorded in it as an answered question is not in the specification and is raised again with an assumption. A person's corrections are therefore **not carried over by the engine**: the confirmation in the portal says so, and the pull request is where a person re-applies one.
5. **The portal offers it where the need is seen.** The Units tab has a Generate / Regenerate mode for the chosen set, with "Select stale" for the designs written against an older template; a unit's page has a Regenerate button beside its set when the design exists; the application's own design has one in its card. A confirmation precedes every run.

## Consequences

- Raising a template's version has a way forward: select the stale units, regenerate, review the pull request.
- Cost: a regeneration is a full design run (the designer, the reviewer, a fix round for the units), so it is started on a selection, not on everything by default.
- The loss of a person's edits is bounded by review, not prevented: nothing reaches the default branch unreviewed, and the diff shows the loss. A later decision could feed the previous design to the designer as input for the parts a person changed; that needs a way to tell a person's change from the generator's, which the documents do not record.
- `scaffold_design.py` gains `--regenerate`; the run's scope, the API body and the portal's selection gain one flag each. No migration: `inputs` is JSON.

## Alternatives considered

- **Delete the design in the pull request that raises the template version.** Needs a person per unit and a merge before the next run; a design with no files looks missing, and the units are then offered as "next" without any trace of what they replaced.
- **Overwrite in place on the default branch.** Fast, but a design is lost with no review and no diff.
- **Regenerate automatically when a template version rises.** Hides cost and replaces designs nobody asked to replace; a person chooses the units.
- **Merge the new design with the old one.** Needs to know what a person changed; the generator's output and a person's edit are indistinguishable in the file.
