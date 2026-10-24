# ADR-0071: Members build, the runtime reviews

- Status: Accepted
- Date: 2026-10-23
- Decision register: D85
- Amends: [ADR-0068](0068-design-generation-in-the-modernize-plugin.md), [ADR-0069](0069-common-member-base-and-plugin-distribution.md)

## Context

After the design of a unit is merged, the unit has to be implemented, tested, reviewed and, in the end, shown to be right. Which of these should the runtime do? The runtime reads the legacy code and writes documents through pull requests; it has no toolchain for the target stack, no way to run a project's build and tests safely beyond the worker's container, and it would have to write code into a repository that [ADR-0028](0028-remove-rulebook-single-document-repo.md) reserves for members. A member, on the other hand, already has the toolchain, the repository and an AI client; what the project lacks is a common method, and a record of which unit was built in which merge request so that someone else can look at it.

The upstream `code-modernization` plugin (`transform`, `verify`, the `test-engineer` and `architecture-critic` agents), `feature-dev` (read, plan, build, then review by someone else), `pr-review-toolkit` (reviewers that each look for one kind of fault) and `ralph-loop` (repeat until a stated criterion holds) were read for the method. What is taken from them: tests that name the rule they pin, a suite that executed no case proves nothing, a canary that shows the tests can fail, and a reviewer who did not write the code. What is left out: the live pane, the strategies `uplift` and `reimagine` ([ADR-0043](0043-rebuild-only.md)), and dual execution of the legacy system.

## Decision

1. **The runtime of `modernize` does two things: `design` ([ADR-0068](0068-design-generation-in-the-modernize-plugin.md)) and `review`.** The runtime never implements or tests, and writes no code and no merge request.
2. **A member implements and tests a unit on their machine**, in the target repository, with their own AI client, the Kintsugi CLI and the member command `build` of `modernize` (installed with `kintsugi add modernize`, run as `/kintsugi:build <module>/<unit>`). The command reads the unit's rules, merged design and the standards with the Kintsugi tools, plans and waits for a yes, builds, writes unit tests that name the rules they pin, counts the cases that ran and shows with a canary that the tests can fail. The method is in two skills, `build-method` and `unit-testing`, which a member receives with the command. The member decides what to commit and opens the merge request themselves.
3. **Kintsugi only collects what was built.** The command ends with `activity_record` calls ([ADR-0069](0069-common-member-base-and-plugin-distribution.md)): `build.test` (details `cases`, `failed`, `canary`) and `build.mr` (summary = the unit, details `mr`, `branch`, `commit`, and the counts). A merge request that builds several units gets one record per unit. These are counts and links, never code or document content; Kintsugi shows only an `http(s)` link and a well-formed commit.
4. **The runtime reviews the merge request.** The Build page lists the merge requests members recorded; reviewing one starts the stage `review` on its units. A run is the units of one merge request at one commit and one target repository; the target repository is mounted read-only under `to-be/` **at the head commit the member recorded** (the worker fetches the mirror when the commit is newer than its last sync). A script lists the files the merge request changes (against the merge base with the default branch); an independent `code-reviewer` job per unit, which did not write the code, reads the code and the tests against the unit's rules, design and the project's standards through five lenses (fidelity, tests, hidden failures, design, security) and writes its findings; a script reads the notes (a note that does not read counts as *not reviewed*, never as clean) and renders `10-applications/<app>/02-modern/<module>/<unit>/_build/review.md` for each unit, in one pull request on the document repository. The reviewer cannot run the code and says so.
5. **The member fixes; the runtime reads again.** The review changes nothing. The member fixes the findings in the same merge request, pushes, and runs the command again, which records the new head commit; the page shows the earlier review as out of date, and the review is started again.
6. **One plugin with two audiences.** `modernize` has the audience `both` in `kintsugi.json`: its commands and agents carry their own `metadata.audience` (`runtime`: `design`, `review`; `member`: `build`), its skills are shared. The member bundle ([ADR-0069](0069-common-member-base-and-plugin-distribution.md)) holds the commands and agents whose audience is `member` and the skills they name; a runtime command, agent or script is never sent to a member's machine. A plugin of `both` can be granted to members like a member plugin.
7. **`verify` comes later.** The proof that a merged unit builds and passes from clean, with a verdict, is not part of this decision.

## Consequences

- `COMMAND_ORDER` is `assess`, `understand`, `plan-understand`, `design`, `build`, `review`. `StageScope` gains `target` and `mr` (the merge request: URL, head commit, branch). The runner reads a pinned commit of a target repository; `MirrorCheckouts.checkout` syncs the mirror once when the pinned commit is missing.
- The API gets a module `delivery/build`: `GET …/build` (the designed units with the member's record and the state of the review, and the merge requests with their units) and `POST …/build/reviews` (the units of one merge request, and the target). It starts the run pinned to the head commit; it refuses units without a recorded merge request, selections that span several merge requests, and units being reviewed.
- The portal's Build page lists the units with two ways for each — build it with your own AI client (the commands to type) and review its merge request on the portal — and the merge requests members recorded.
- A member's record is trusted only as data to display and to name a commit to read. It decides nothing about whether a unit is correct; the proof is `verify`, later.
- The runtime still writes no code and the target repositories stay read-only for it ([ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md)): no new infrastructure.
- The reviewer's text and the code it reads are data; planted instructions are reported, not followed.

## Alternatives considered

- **The runtime implements and tests on the portal**, writing a pull request to the target repository and running the project's commands in the worker. It needs a code writer, a toolchain in the worker image and a way to run model-written code; none of it exists, and the members' own machines have all of it. It was designed and built first, then set aside in favour of this.
- **A second plugin for members.** No schema change, but the method and the skills would exist twice and drift.
- **The member pastes the findings back into the merge request.** The review is published as a document next to the unit's design; posting it as comments on the merge request needs the server's comment API and is a follow-up.
