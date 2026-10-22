# ADR-0052: A run reads every legacy repository of an application, each in its own folder

- Status: Accepted (amends 0033, 0051). The mount point `src/<repository id>/` becomes `as-is/<repository id>/` in [ADR-0055](0055-one-durable-workspace-per-job.md); citations are unchanged
- Date: 2026-10-22
- Decision register: D68

## Context

The manifest has always allowed several `legacy` repositories on one application (`applications[].repos`, "legacy code, many allowed"), and the portal shows them (`falo-skeleton`, `+1`). A run read only the first: the API took `application.asIs.legacy[0]`, the run recorded one `source_repository_id` and one `source_commit`, and the worker checked that one repository out into `src/`. The others were never mounted. In a live `assess` run of an application with `falo-skeleton` and `falo-unities`, every agent tool call walked the tree of `falo-skeleton` alone and the run showed a single source, `falo-skeleton@3fc7e7014615`: the inventory, the catalog, the understanding of every unit and the security review all missed `falo-unities`.

Giving the run both repositories raises three questions: where they are mounted, how files are cited when two repositories may hold the same relative path, and which commits a document records as its provenance. No application has run Kintsugi against the old layout, so nothing is kept for compatibility.

## Decision

**1. A run reads every legacy repository of its application, in the order they were linked.** The run records the list, `workflow.job_run.sources` (`[{repositoryId, commit}]`, migration 022). `source_repository_id` and `source_commit` keep the first one, which lists and the rebuild trigger read. A retry pins the commits of the failed run; a repository linked since is read at its current commit. A run recorded before the list existed has no `sources` and reads as one repository.

**2. Each repository is mounted in its own folder under `src/`, named by the repository's id** (`<data>/jobs/<id>/src/<repository id>/`), each a read-only detached worktree at its own commit. The id is a single safe path segment (`SOURCE_FOLDER_PATTERN` in `packages/domain/src/source.ts`); a run fails with the repository named if one is no longer registered, after releasing those that did mount.

**3. Files are cited `<repository id>/<path in the repository>`, always.** An application with one repository gets the same prefix as one with several, so the paths in the documents (the inventory, the catalog, rule citations, unit cards, traces) do not change when a second repository is linked, and catalog ids, which are kept by file overlap, survive. The tools and scripts see one tree (`src/`) whose first folders are the repositories; the extraction script, the catalog scripts and the mock agent need no knowledge of repositories. A unit card lists its `source` per repository (`{repo, paths}` with paths inside that repository).

**4. Provenance is the list of `<repository id>@<commit>`.** The `{sources}` placeholder (replacing `{repo}` and `{commit}`) is `id@commit,id@commit`; scripts take it as `--sources` (`inventory.py`, `finish_items.py`, `split_rules.py`, `render_rules.py`). The inventory and the catalog index carry `sources:` in their front matter, the understanding record carries `sources:`, the plan carries `catalogSources`, and a plan is stale when the catalog's sources differ from its own. The rule files keep their `Commit` column and `sourceCommit` field, which hold the same spec.

**5. The plugins follow.** A citation that drops the repository, or keeps the `src/` of the job workspace, still finds its item when exactly one catalog file has that path (`Owners.path_of` in `catalog_common.py`: a rule or finding is not lost to a model's habit); an ambiguous path is left out as before. A unit card's `source` paths are read back under their repository when the catalog is seeded from the cards (`reconcile_catalog.py`). `inventory.py` refuses a `--sources` entry that is not a folder of the measured tree. The three analysis jobs of `assess` each name the repositories they read, and the synthesis reports a repository nobody read as a gap. The topology job is told that edges may cross repositories. The member workflow `scaffold` takes `sourceDirs`, one clone per legacy repository (`sourceDir` stays for one).

**6. `legacy-data` repositories are not mounted.** They stay as they were: linked to the application and listed, not read by the runtime stages. Reading them is a separate decision.

## Consequences

- The portal's run list and detail show every repository with its commit; the stage pages name every repository the worker reads.
- Every citation in a document starts with a repository folder. A person reading `falo-unities/lib/util.c:12` knows the repository without opening the card.
- The agents' prompts say that the source is `src/` with one folder per repository and that citations start with the folder; the workflows `extract-rules` and `harden-scan` cite accordingly.
- A repository whose id is not a safe folder name cannot be read; the registry's ids are already restricted to that shape for the mirrors.
- Two repositories whose ids differ only in case would share a folder on a case-insensitive file system; ids are unique in the registry and the worker runs on Linux.
- Cost: the first run of an application that already had documents with unprefixed paths re-keys them; none exists yet.

## Alternatives considered

- **Prefix only when an application has several repositories.** Keeps the one-repository paths as they were, but linking a second repository later rewrites every path and the file-overlap matching of the catalog then retires every item; two modes to keep right. Rejected.
- **One run per repository.** The catalog, the plan and the units are per application, and a unit may span repositories; one run could not see the whole estate. Rejected.
- **Merge the repositories into one checkout.** Loses which repository a file is from and breaks on paths that collide. Rejected.
