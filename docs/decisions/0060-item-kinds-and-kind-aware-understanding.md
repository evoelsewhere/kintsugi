# ADR-0060: Catalog items have a kind from a shared vocabulary, and understanding follows the kind

- Status: Accepted (amends [0031](0031-understand-stage-as-is-specification.md) §4 and [0033](0033-assess-catalog-understand-selection.md) §2)
- Date: 2026-10-23
- Decision register: D76

## Context

Every catalog item has a `kind` ([ADR-0033](0033-assess-catalog-understand-selection.md) §2, one of the `unitKinds` of `kintsugi.yaml`), and the design stage already varies by kind: a design set holds a profile per unit kind ([ADR-0053](0053-design-template-profiles-by-unit-kind.md)). The understanding side does not:

- **Detection is narrow and guesses silently.** The topology has four leaf kinds that become items (`module`, `job`, `screen`, plus `datastore`, which is never an item). There is no leaf for an API, a report or an event handler. `choose_kind` maps a leaf kind onto `unitKinds` through a short synonym table and, when nothing matches, returns the **first** entry of `unitKinds`: in the starter manifest (`[screen, api, batch-job, db-object, report]`) an unrecognised leaf becomes a `screen`.
- **No shared meaning.** `unitKinds` is a free list per project, so `screen` in one project, `transaction` in a second and `page` in a third mean the same thing and nothing can be built on the name: not a filter, not a default profile, not a report across projects.
- **One specification fits all.** An AS-IS specification has the same eleven sections ([ADR-0031](0031-understand-stage-as-is-specification.md) §4) for a billing calculation, a data-entry screen, a REST endpoint and a nightly batch job. What a person needs to **recreate** a screen (fields, validations, events, navigation) or a batch job (schedule, inputs and outputs, restart points) is not asked for, so the analyst may or may not write it.
- **The portal cannot slice by kind.** The catalog view shows a Kind column when there is more than one kind, but cannot filter or select by it, and a person who wants "all the screens of the invoicing module" ticks them one by one.
- **The links that matter cross kinds.** A screen calls an API that writes a table. In a web application these are often in two repositories ([ADR-0052](0052-several-legacy-repositories-per-application.md)); on a mainframe a screen map, a transaction, a program and a table share a name or a naming convention. Nothing today asks for the screen → API link.

The estate Kintsugi serves is both new stacks (a web front end calling a Java API) and mainframe (CICS and batch COBOL, JCL, copybooks, DB2). The vocabulary has to cover both without becoming a list of stack names: Kintsugi ships no stack-specific content ([ADR-0014](0014-no-code-graph-no-agent-config.md), `AGENTS.md`). The engine stays small: no parsers, no per-kind agents ([ADR-0023](0023-runtime-as-generic-agent-kernel.md)).

## Decision

### 1. A core vocabulary of item kinds

Kintsugi defines seven kinds by what they **are to the outside world**, not by technology. `unitKinds` stays the project's allowed list; the core kinds are the names Kintsugi knows how to detect, filter and write a profile for.

| Kind | An item that is… | Web / modern examples | Mainframe examples |
|---|---|---|---|
| `screen` | an interactive page or form a person works in | a routed view, page, form, dialog | a CICS transaction with a BMS map, an ISPF panel, a 3270 or green-screen program |
| `api` | a synchronous interface other programs call | a REST, SOAP or RPC endpoint group, a GraphQL schema | a CICS program exposed as a service, a stored procedure exposed to callers |
| `batch-job` | unattended work started by a schedule or an operator | a scheduled task, a cron script, a batch-framework job | a JCL job or procedure with the programs it runs |
| `report` | something that produces a document or an extract for people | a report template, an export | a print program writing a report dataset, a report writer definition |
| `event` | a handler that reacts to a message or a notification | a queue or topic listener, a webhook | an MQ-triggered program, an IMS message program |
| `integration` | an exchange of data with an external system | a file feed, an EDI or SFTP exchange, an outbound client | a file transfer step, an outbound queue writer |
| `module` | logic with no entry point of its own, used by other items (the default) | a service, a library of rules | a called subprogram, a copybook-heavy utility |

The first six are **entry kinds** (they say how the system is triggered); `module` is the **internal** kind. A project may declare any subset and may add kinds of its own (`unitKinds: [screen, api, batch-job, module, ledger-close]`); a kind outside the core has no built-in profile and is specified with the base sections (§4).

**Data is not an item kind.** Data objects stay in the DTO catalog that `extract-rules` already produces (`data-objects.md` per item and the generated `DATA_OBJECTS.md`), and a `datastore` leaf stays a non-unit leaf ([ADR-0033](0033-assess-catalog-understand-selection.md)). A file that only defines data (a copybook, an entity, a DDL script) belongs to the item the topology assigns it to, or is unassigned, as today. The kind profiles refer to data objects by their ids instead of redescribing them.

The default for a project that declares no `unitKinds` becomes the core vocabulary; today it is `["module"]` (`DEFAULT_UNIT_KINDS`).

### 2. One mapping from what the topology finds to a kind

The topology guidance of the `assess` command (`modernize-assess`, the instructions of the `legacy-analyst` that writes `extract_topology.py`) names the leaf kinds the extraction script may write: `screen`, `api`, `job`, `report`, `event`, `interface`, `module`, `datastore`. The script is still model-written and per application; Kintsugi only maps what it reports.

`topology_units.choose_kind` becomes:

1. the leaf kind itself, when it is in `unitKinds`;
2. a synonym in `unitKinds`, from a table covering the core names above and the common project spellings (`job` → `batch-job`, `batch`; `screen` → `ui`, `page`, `transaction`, `map`; `api` → `service-api`, `endpoint`, `rest`; `interface` → `integration`, `feed`; …), in order of preference;
3. `module`, when it is in `unitKinds`;
4. otherwise the first entry, **and an entry in the catalog's `ambiguities`** ("`<item>` has no kind in `unitKinds` for leaf kind `<x>`; shown as `<first>`").

A leaf with an entry point (existing rule in `catalog_from_topology.py`) still lifts a generic `module` leaf to the first entry kind that fits. An item has **one** kind. A file that serves two roles (a controller that renders a view and returns JSON) is classified by its main role; the other role is recorded as a `part` whose `kind` is set (the field already exists on `CatalogItemPart`).

The curation pass keeps its `kind` edit (`apply_catalog_edits.py`), so a wrong kind is corrected in the `assess` pull request; the item id does not change with its kind.

### 3. Links across kinds and repositories

The topology guidance asks for the edge that makes a slice possible: a `screen` that calls an endpoint gets a `call` edge to the `api` leaf that serves it, **across repositories** when the application has several ([ADR-0052](0052-several-legacy-repositories-per-application.md)), matched by route or operation name; on a mainframe, a screen to its transaction program and a program to the datastores it reads and writes. A call whose target cannot be found is an entry in the topology's ambiguities, not a guess. No new edge kind and no schema change: `call`, `dispatch`, `read` and `write` stay.

### 4. Specification profiles by kind

The AS-IS specification keeps its base sections ([ADR-0031](0031-understand-stage-as-is-specification.md) §4). A **specification profile** per kind adds sections to it and says how to fill them, in the way [ADR-0053](0053-design-template-profiles-by-unit-kind.md) does for design sets.

- **Where.** Built-in profiles are files of the `reverse_engineering` plugin (`skills/understand-planning/references/spec-profiles/<kind>.md`). A project may replace one with `01-standards/specifications/<kind>.md` in its document repo, a document written by people through pull requests. The project's file **replaces** the built-in one as a whole; there is no merging, so a reader sees the full contract in one file.
- **Format.** Markdown only ([ADR-0042](0042-markdown-only-document-repo-by-bounded-context.md)): front matter `kind` (equal to the file name) and `version` (an integer, raised on a change that affects existing specifications); a `## Sections` table `Section | What it holds | Evidence`; a `## Instructions` section for the analyst.
- **Resolution.** `scope_items.py` resolves the profile of each selected item (project file, else built-in, else none) and puts it in the brief the specification job starts from. The `legacy-analyst` stays the one agent: no agent per kind.
- **Output.** `spec.md` gains the profile's sections between **Main flows** and **Dependencies**, each as a `##` heading with the section's name; a section with nothing to say says "None." with the reason instead of staying empty. `finish_items.py` checks that every heading is there and reports each missing one; the specification is not sent back to the agent, and a missing section is a finding for the reviewer of the pull request.
- **Recorded.** `understanding.md` records `profile: <kind>@<version>` and, when a section is absent, `profileMissing`, so a later run can tell that a specification predates a newer profile. An understood item is also **stale** when the profile of its kind has a higher version than the recorded one (the project's file when it is usable, else the built-in one), or when it was written with the profile of another kind; the catalog says why (`staleReason`: `source` or `profile`). A specification recorded without a profile is not stale for this reason.

The built-in profiles, stack-neutral and each about a page:

| Kind | Sections added to the specification |
|---|---|
| `screen` | **Layout and fields** (name, type and length, source, editable); **Validations**; **Events and actions** (each button, key or link and what it does); **Navigation** (from, to, with which data); **Services called** (the `api` items, by id); **Authorization** (who sees and who may act); **Messages** |
| `api` | **Contract** (operation, parameters); **Request and response** (data object ids); **Status and error codes**; **Authentication and authorization**; **Side effects** (data written, events raised); **Transactions and idempotency**; **Known callers** (the `screen` and other items, by id) |
| `batch-job` | **Trigger and schedule**; **Inputs and outputs** (files, tables, datasets); **Steps** (order, conditions, return codes); **Restart and recovery**; **Volumes and windows**; **Predecessors and successors** |
| `report` | **Parameters and selection**; **Data sources**; **Layout** (columns, groupings, totals); **Calculations**; **Output format and destination**; **Frequency and audience** |
| `event` | **Source** (queue, topic, trigger); **Message layout** (data object ids); **Handling and ordering**; **Retries and poison messages**; **Side effects** |
| `integration` | **Counterparty**; **Direction, protocol and format**; **Field mapping**; **Schedule and volumes**; **Error handling and reconciliation**; **Security** |
| `module` | none; the base sections |

A `batch-job` item on a mainframe is the JCL job; the programs its steps run are `module` items it depends on (`dispatch` edges), and the brief of the job lists them so the specification can describe the steps without re-reading the programs.

### 5. Selection and planning by kind

- The catalog the API serves already carries each item's `kind` and `dependsOn`, so the API does not change and the selection endpoint still takes item ids.
- The understand page's kind filter shows how many items each kind has, and a **Select shown** action selects every selectable item the filters show. The size limit of a run (about 60 items) applies after the expansion.
- An **Add dependencies** action adds the items the current selection depends on (`dependsOn` of the item graph, one level deep, retired and blocked items left out). A screen plus the APIs it calls is one selection, one pull request, one review.
- The AI plan for understanding order ([ADR-0041](0041-ai-plan-for-understanding-order.md)) knows the kind: the item graph carries it, the planning skill has a rule that an entry item comes with what it calls (a screen with its APIs, APIs before the screens that use them), and each planned batch records its kind mix (`kinds`), which the portal shows. The planner still proposes an order, never a selection.

### 6. Design and the rest

The work item and the modern unit card keep the item's kind, and the design stage keeps choosing its profile from it ([ADR-0053](0053-design-template-profiles-by-unit-kind.md)). There is no legacy-to-target kind mapping: the unit key `<module>/<unit>` and its kind are the same on both sides. The rule and security steps, the traceability matrix and the Overview run do not depend on the kind.

### User decisions recorded
1. Data stays in the DTO catalog; it is not an item kind.
2. The vocabulary covers both new stacks and mainframe.
3. The change starts as an ADR; implementation follows it in the phases below.

## Consequences

- A person can filter and select by what an item is, and a specification asks for what is needed to recreate that kind of item. This is the main gain.
- A silent misclassification becomes a visible ambiguity and a catalog edit, and a project that declares the core names gets the same behaviour as every other.
- Specifications of an entry kind become longer, so a run costs more tokens per item; `module` items cost the same as today.
- The extraction script gets a larger contract (more leaf kinds, cross-repository edges). It stays model-written, so the quality depends on the instructions and on the review of the `assess` pull request; unmatched calls are reported, not invented.
- A project that wants its own kind (`ledger-close`) gets the base specification until it writes a profile at `01-standards/specifications/<kind>.md`.
- Two items for one role (a screen split over several files, a front end and a back end for one dialog) are still two items; the slice selection and the `Known callers` and `Services called` sections are what joins them.
- Existing catalogs keep their kinds. A project that wants the new detection runs `assess` again; reconciliation keeps item ids ([ADR-0033](0033-assess-catalog-understand-selection.md) §2), and a changed kind is a catalog change reviewed in that pull request.
- Documentation to update on acceptance: [document-repo-item-catalog.md](../reference/document-repo-item-catalog.md) (the vocabulary, the mapping, the ambiguity), [document-repo-manifest.md](../reference/document-repo-manifest.md) (`unitKinds` default), a new reference page for specification profiles beside [design-templates.md](../reference/design-templates.md), ADR-0031 §4 and ADR-0033 §2 (a pointer to this ADR), and the register.
- `_generated/DATA_ACCESS.md` joins the catalog's data store links into a read/write matrix by data store and by item. The topology edges say read or write, not create, update or delete, so it is not a CRUD matrix.
- Not decided here: a kind-aware Overview.

### Rollout
1. **Vocabulary and detection**: the core kinds and the default, the topology leaf kinds and the synonym table, the `module` fallback with the ambiguity entry, the kind counts and Select shown in the portal. No change to specifications.
2. **Profiles**: the profile format and resolution, the six built-in profiles, the check, the record in `understanding.md`.
3. **Slices**: the cross-kind edges in the topology guidance and the Add dependencies action.

All three phases are implemented. They are covered by unit tests of the scripts and the portal helper; a run on one web application (front end, API, batch) and one mainframe sample (a transaction with its map, a JCL job with its programs, a report program) is still to be done.

## Alternatives considered

- **Keep `kind` a free word per project.** Rejected: nothing can be filtered, profiled or compared on a name with no shared meaning, and the first-entry fallback keeps guessing.
- **A kind per technology (`cobol-program`, `spring-controller`, `jcl`).** Rejected: it puts stack knowledge in Kintsugi ([ADR-0014](0014-no-code-graph-no-agent-config.md)) and splits things that are one thing to a person (a screen is a screen in Vue and in CICS).
- **A kind per agent (a screen analyst, a batch analyst).** Rejected: it multiplies agents to maintain and review for what is a change of sections; one analyst with a profile does it ([ADR-0023](0023-runtime-as-generic-agent-kernel.md)).
- **Several kinds or tags on one item.** Rejected: selection and profiles need one answer. A second role is a `part` with its own kind.
- **Data as an item kind.** Rejected by the user decision above: the DTO catalog already carries data objects with their rules and citations, and a data item would duplicate it and break the file-coverage rule for definition files.
- **Profiles merged with the base, section by section.** Rejected for the reason [ADR-0053](0053-design-template-profiles-by-unit-kind.md) §4 gives: a reader has to open two files to know the contract.
- **A closed enum of kinds in code.** Rejected: a project has kinds the core does not (`ledger-close`); the core is a vocabulary with built-in profiles, not a limit.
