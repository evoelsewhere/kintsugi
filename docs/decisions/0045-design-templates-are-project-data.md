# ADR-0045: Design templates are project data, kept in the document repo

- Status: Accepted (the agent instruction of decision 5 is the runtime `design` stage since [ADR-0049](0049-design-sets-generated-by-the-runtime.md); the design sets live in `01-standards/templates/<set>/` since [ADR-0051](0051-document-repo-layout-legacy-and-modern.md); the rest stands)
- Date: 2026-10-21
- Decision register: D61

## Context

[ADR-0044](0044-design-phase-common-basic-detail.md) adds basic and detail design before implementation. What those documents contain differs from project to project: how many levels there are, which files each has, which sections and tables, which identifiers, and what a reviewer requires before accepting one. Many projects start from a format the customer already uses.

Kintsugi ships no stack-specific content ([ADR-0014](0014-no-code-graph-no-agent-config.md), [ADR-0028](0028-remove-rulebook-single-document-repo.md)), and the document repo holds Markdown only ([ADR-0042](0042-markdown-only-document-repo-by-bounded-context.md)). A template that only guides the author is not enough: the same definition must also tell an agent what to write, let a script check the result, give a reviewer the rubric, and let the portal show conformance. If those were four separate descriptions they would drift.

## Decision

1. **A project defines its design as *design sets*.** A design set is a named group of documents produced together for a unit (for example `basic`, `detail`, `db`, `report`). The engine knows no set names; a project defines as many as it needs. Sets live in the document repo, under `standards/design/<set>/`, and change by pull request like any standard.

2. **One definition per set, in Markdown.** `set.md` holds its identity in the front matter (scalars and short lists, as every document of the repo, [Document formats](../reference/document-formats.md)) and the documents of the set as a table in its body, followed by a description for people:

   | Front matter | Meaning |
   |---|---|
   | `id`, `title`, `version` | identity; `version` is an integer raised on a change that affects existing designs |
   | `appliesTo` | unit kinds (from `unitKinds`) the set is for; empty means every kind |
   | `needs` | sets that must exist before this one (the order of work) |
   | `stage` | the pipeline stage that produces it (optional) |

   | Files table column | Meaning |
   |---|---|
   | `Path` | the document, relative to the unit's `design/<set>/` |
   | `Template` | a file in the set's folder |
   | `Required` | `yes` or `no` |
   | `When` | unit kinds that need the file; empty means every kind the set applies to |

3. **The template file carries its own contract, next to the text it governs.** A template is a Markdown file whose body is the skeleton an author starts from. Under each heading an HTML comment (invisible when rendered) holds the section's contract, one directive per line:

   ```
   ## Business rule coverage
   <!--
   required
   table: Rule | Design item | Notes
   seed: rules
   check: covers-rules(Rule)
   guidance: Every rule of the unit appears once; point to the design item that handles it.
   -->
   ```

   | Directive | Meaning |
   |---|---|
   | `required` | the section must be present and not empty |
   | `table` | the columns, when the section is a table; the table must have exactly these columns |
   | `seed` | what the scaffold fills in from what Kintsugi already knows; `rules` lists the unit's rules |
   | `check` | a named check from the vocabulary below; repeatable |
   | `guidance` | what to write, read by people and used as the agent's instruction |

   The heading text identifies the section. Front matter holds no list of records because the parsers read scalars and lists of scalars only; a record list belongs in a table or in a section, as everywhere else in the repo.

4. **The checks are a closed, declarative vocabulary.** `no-placeholder` (no `TODO` or `TBD` left), `covers-rules(column)` (every business rule of the unit appears in the column), `refs-resolve(column -> source)` (the identifiers a design points to exist; the source is `rules`, `requirements`, `components` for `COM-…` ids, or the id of a set the design needs, whose design items are then the targets), `id-pattern(column, regex)`, `max-length(n)`, `one-of(column, a|b|c)`. Required sections and table columns are checked by `required` and `table`. A project chooses and parameterises the checks; it cannot add code to the engine. Checks that need project code are out of scope here ([ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md)).

5. **One definition, five uses.**
   - *Scaffold*: a script creates `units/<module>/<unit>/design/<set>/…` from the template: it substitutes a closed list of variables (`{{unit.id}}`, `{{unit.title}}`, `{{app.id}}`, `{{kind}}`, `{{set.id}}`, `{{set.version}}`), removes the directive comments, seeds what Kintsugi already knows (the unit's rules), and leaves a `TODO` in each required section so `no-placeholder` flags what is not written. Text under a section's heading in the template is not carried over, since the guidance lives in the directive.
   - *Instruction*: the member plugin's `design` command takes the guidance of each section as the agent's brief; changing a template changes behaviour without changing the plugin.
   - *Validation*: a script in the member's harness runs the checks and lists concrete problems before the pull request is opened.
   - *Review*: the runtime `design-review` uses the same checks as its rubric, then judges the content.
   - *Portal*: sets, files and the conformance of each unit are shown from the same data.

6. **Provenance and staleness.** Each design file records `template: <set>@<version>` in its front matter. Whether a design is stale (its template has a newer version) is derived by the API when read, not stored, like item status in the catalog ([ADR-0033](0033-assess-catalog-understand-selection.md)). The team decides whether to bring a stale design up to date.

7. **Waivers are recorded.** A unit may waive a required file with a reason: a `waived` list in the front matter of `unit.md`, one entry per file, written `<set>/<file>: <reason>`. The checks accept it and the review shows it.

8. **The template is validated too.** A script checks every set: unique ids, existing template files, known checks with valid parameters, `needs` without cycles, `appliesTo` kinds declared in the manifest. It runs on the pull request that changes `standards/design/`.

9. **A neutral starter.** `templates/document-repo/standards/design/` ships a `basic` and a `detail` set for the `module` kind, with a guide to define a project's own. A skill of the member plugin helps convert a customer's sample (a spreadsheet or a document) into a set; the conversion is an onboarding step of the project, not engine behaviour.

10. **A pipeline stage may name its set.** A stage has an optional `produces: <set>`; the manifest reader checks the shape, the API checks that the set exists.

## Consequences

- A project changes its design format by editing Markdown in `standards/design/` and merging a pull request; no Kintsugi release and no plugin change is involved.
- The strongest checks (`covers-rules`, `refs-resolve`) work because `understand` already produced identified rules and traces; a plain document template cannot offer them.
- New code: the types and the check vocabulary in `packages/domain` (`design-template.ts`), the Markdown parser and checker in the reader (`hooks/reader/design.ts`, which owns the Markdown helpers), path helpers for the standards folder and the unit's design set in `document-layout.ts` (mirrored in `scripts/paths.py` and the reader's `layout.ts`), `scaffold_design.py`, `check_design.py` and `validate_design_templates.py` in the `modernize` plugin, and API and portal reading of the sets and their conformance. The member side needs Python and the API needs TypeScript, so the checker exists twice; shared conformance fixtures, run by both test suites, keep the two identical.
- Limits accepted for now: one format per project (no per-application override), Markdown only (a later exporter can render a design as a spreadsheet or a document, the repo does not store one), and no project-written checks.
- Risk: a template that is too strict blocks work, one that is too loose checks nothing. The pilot in P3 exists to tune it; `version` and the derived staleness make a later change visible instead of silent.

## Alternatives considered

- **Fixed templates in the engine.** Cheap, but every project differs; the first request for another format would need a release; rejected.
- **A YAML or JSON schema per set.** Machine-friendly, but the document repo is Markdown ([ADR-0042](0042-markdown-only-document-repo-by-bounded-context.md)) and a template should read as the document it produces; the front matter keeps the schema while the body stays the skeleton; rejected.
- **A template language with logic (loops, conditions).** Powerful, and a second language to learn, review and secure; the engine stays small ([ADR-0014](0014-no-code-graph-no-agent-config.md)); rejected.
- **Only an AI review against free-form guidance.** Flexible but non-deterministic and not checkable in a harness before the pull request; kept as the second step after the deterministic checks.
