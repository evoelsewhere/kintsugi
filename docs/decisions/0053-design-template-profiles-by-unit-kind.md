# ADR-0053: A design set has a profile per unit kind

- Status: Accepted (amends [0045](0045-design-templates-are-project-data.md) and [0050](0050-design-sets-scope-and-instructions.md); the kind of a set is no longer `appliesTo` and the `When` column)
- Date: 2026-10-22
- Decision register: D69

## Context

A design set ([ADR-0045](0045-design-templates-are-project-data.md)) is one folder: `set.md`, which lists the documents, and one template per document. The units of a project differ by **kind** (a screen, an API, a batch job, a database object, a report), and a good detail design differs with them: a screen design has layouts and events, a batch design has a schedule and restart points. The set could express that in two ways only:

- `appliesTo` on the set and a `When` column on a file: a document exists for some kinds. The *template* is still one for all, so a screen and a batch job share the sections of one `logic.md`, or the project defines a set per kind (`detail-screen`, `detail-batch`, …) and every `needs`, waiver, pipeline stage and portal row is repeated per kind.
- Sections written as optional: nothing tells the designer which ones belong to a kind, and nothing checks that the right ones are filled.

A designer also writes better from a finished example than from a contract alone, and the set had no place for one that the checks would not mistake for a template.

No project runs Kintsugi on design sets yet, so nothing is kept for compatibility.

## Decision

**1. A set may hold one profile per unit kind**, a folder named after the kind (a value of `unitKinds` in `kintsugi.yaml`):

```text
01-standards/templates/<set>/
  set.md                      identity, version, scope, needs, stage, reads; the base files table; the set's Instructions
  <template>.md               a base template, used by every kind that has no template of that name in its profile
  _examples/<template>.md     a finished document, read by the designer, never checked
  <kind>/                     the profile of one unit kind
    profile.md                kind, version; files added or redefined, files removed; the kind's Instructions
    <template>.md             replaces the base template of the same name, or is a document only this kind has
    _examples/<template>.md   the example for this kind (before the set's)
```

Names beginning with `_` are not kinds, as for modules and units ([ADR-0051](0051-document-repo-layout-legacy-and-modern.md)). A set of scope `application` has no unit kind and cannot have profiles.

**2. The files of a set for a kind** are the base table of `set.md`, plus the files `profile.md` lists, minus the paths it removes. A path the profile lists that the base also lists is redefined (its template and `Required` are the profile's). A set applies to a kind when the result has at least one file, which replaces `appliesTo` and the `When` column. A set with no base files and a profile for `screen` and `api` is a set for those two kinds only; a profile that removes every base file turns the set off for its kind.

**3. `profile.md`** has front matter `kind` (equal to its folder) and `version` (an integer, raised on a change that affects existing designs), and an optional `removes` list. Its optional files table has the columns of `set.md` without `When`: `Path | Template | Required`. Its body is a description for people, and a `## Instructions` section for the designer, read after the set's own.

**4. A template is replaced as a whole file, never merged.** For a document of a kind, the template is `<kind>/<template>.md` if it exists, else `<template>.md`. There is no inheritance of sections, so a reader of a profile template sees the whole contract in one file, and the checks of a template never depend on a second file. A project keeps two similar templates in step by copying, which a review sees; a merge language is the kind of mini-language ADR-0045 avoids.

**5. Each profile has its own version, and a document names the template it used.** The front matter reads `template: "detail@2"` for a base template and `template: "detail/screen@3"` for a profile's. A design is stale when its reference names the template in use and an older version; it is wrong when it names another one (a base reference where the kind now has its own template). The version in the reference is the set's for a base template and the profile's for a profile's, so raising the batch profile makes the batch designs stale and no other. `{{set.version}}` in a template is the version of the template in use.

**6. Examples feed the designer, not the checks.** `_examples/<template>.md` next to a profile (else next to the set) is named in the scaffold's manifest for each document that has one, and the designer is told to read it as the shape and depth to match, never to copy its content. It is data like any document of the repo: not parsed, not checked, not listed as a set file.

**7. The validator reports** (in addition to what ADR-0045 reports):
- a kind folder without `profile.md`, a `kind` that does not match its folder, a missing or non-integer `version`;
- a kind folder that is not in the project's `unitKinds`;
- a profile in an application set;
- a `removes` path that is not a base file, or a path both removed and defined;
- a profile file whose template is in neither the profile folder nor the set folder;
- a template in a kind folder that no file of that kind uses (a misspelled override would otherwise be silent);
- `appliesTo` in `set.md` or a `When` column, which are replaced by profiles.

A unit set with neither base files nor profiles is a fault; for an application set the files table is required as before.

**8. Where it shows.** The portal lists a set's profiles, each with its version, files and instructions, and the unit drawer shows which template a document expects (`detail/screen@3`) next to the one it was written against. The scaffold writes the reference of the template in use and its manifest lists, per document, the template file, the reference and the example.

## Consequences

- A project adds a kind's variation by adding a folder, in a pull request; nothing else about the set (its `needs`, its waivers, its pipeline stage) changes.
- The starter ships profiles for the common kinds, and `unitKinds` in its `kintsugi.yaml` declares them.
- The three readers (the TypeScript reader the API runs, `design_lib.py`, and the portal's views) stay equal through the shared fixtures, which gain profiles and examples.
- Cost: a project with ten kinds has up to ten profile folders per set. Accepted; the base templates keep the common case small, and a kind with no folder costs nothing.
- Limit: no section-level inheritance, no profile per application or per module, no example that is checked. Each can be added later without changing this layout.

## Alternatives considered

- **Keep `appliesTo` and `When`, add a set per kind.** No new concept, but `needs`, waivers, stages and the portal's rows multiply by the number of kinds. Rejected.
- **Section-level inheritance (a profile template that overrides or adds sections).** Smaller files, but the effective contract exists nowhere on disk, checks depend on a merge, and the portal would need the merge to show a template. Rejected for whole-file replacement; revisit if copies prove a burden.
- **One version for the set.** A change to the batch profile would make every screen design stale. Rejected for a version per profile.
- **Examples as templates with a directive.** Mixes the contract with a sample and makes the checker skip files by a flag. A separate `_examples/` folder keeps them out of the contract.
