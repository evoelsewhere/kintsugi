# Your first modernization project

This walkthrough takes an installed Kintsugi portal from an empty project to a reviewed unit. It covers the implemented assess, understand, design, member build and runtime review flow. The wider P0–P4 delivery method includes activities the team performs outside the portal; see the [delivery pipeline](../methodology/delivery-pipeline.md).

## 1. Prepare the installation

An installation administrator first [deploys the Docker images](docker-images.md), adds a [runtime LLM provider](configure-llm-providers.md), and configures Git servers and credentials in Settings → Git. Grant users the installation permissions and explicit Project Access they need. A role alone does not give a member access to every project.

Use a small application or a representative pilot. Have its legacy source, an empty document repository and scaffolded target repositories ready. The runtime reads source; members implement in the target repositories with their own Git credentials.

## 2. Register the project and its standards

In **Administration → Projects**, create a project, select its single document repository, add an application and link its `legacy`, optional `legacy-data`, and `target` repositories. Publish `kintsugi.yaml` with the starter structure, review the pull request and merge it. Wait for repository sync before running a stage.

Write target conventions, legacy-to-target mappings, review rules and design templates in `01-standards/`. Put shared architecture and components under `02-architecture/`. These are Markdown documents, reviewed in Git. Use [Build a project](build-project.md) for the exact setup and [Define design templates](define-design-templates.md) for the design contract.

## 3. Assess the application

Open **Delivery → Assessment & Catalog**, select the project and application, then start assessment. Review its runs and logs. The resulting document pull request contains the inventory, topology, catalog and rebuild assessment.

Check that the catalog identifies meaningful units, source references match the selected commit, and reported risks are supported by evidence. Review and merge the document pull request, then let Kintsugi sync it. The catalog is the menu for the next step; a successful job is not a human approval.

## 4. Understand selected units

Open **AS-IS Understanding → Catalog** and select a few representative items or a module. Run understanding on that selection. An optional understanding plan recommends an order based on dependencies; people choose the scope.

Review each unit's rules, specification, data objects, findings and traceability in the document pull request. Resolve uncertainty with the people who know the legacy behavior; do not assume an AI statement is confirmed. Merge approved results. Generated application views are rebuilt from the merged units.

## 5. Generate and review a design set

In **Unit Design**, select understood units and a design set defined by your project's templates. Confirm its prerequisites: the relevant standards, common design and any earlier design sets must be available at the chosen document revision.

Run the design, then inspect its proposed documents in Git. Review the handling of each business rule, interfaces, data changes, test expectations and unresolved decisions. Merge the accepted design before a member builds it. The number and names of design sets come from your project; the engine does not impose a stack.

## 6. Connect a member's AI client

Follow the [member guideline](member-quickstart.md) to install the CLI from **your installation's** `/guideline`, sign in to the project, run `kintsugi init`, and install the permitted `modernize` plugin. An administrator enables it under the project's Member plugins settings.

In a fresh client session opened in the target repository, use the plugin's build command with the unit path. Claude Code uses:

```text
/modernize:build billing/invoice my-project
```

Replace the example unit and project with the actual IDs. Codex receives the command as a skill; select the installed `modernize` build skill in its skill picker. The [client reference](../reference/member-cli.md) explains differences between clients.

Review the proposed implementation plan, let the member's assistant implement and test it, and inspect the canary that proves the tests can fail. The member commits the change and opens a merge request. Record its URL and full head commit through the build flow so the portal can associate it with the unit.

## 7. Request an independent review

Open **Delivery → Build** and check the recorded merge request and commit for the unit. Request a runtime review. It reads that revision against the unit's rules, merged design and project standards; it does not execute the target code or modify the merge request.

Review findings in the proposed `_build/review.md` document. The member fixes the code, reruns tests and records the new merge request revision before requesting another review. A person decides acceptance. Clean-build verification is a later stage; a runtime review alone does not certify that the code builds.

## 8. Monitor and repeat

- **Monitoring**: inspect stage runs, document writes, repository sync and worker health. Read errors before retrying a failed run.
- **Governance → Telemetry**: inspect model calls, tokens, cache reads and cost.
- **Monitoring → Members**: inspect bounded plugin activity. Raw client transcripts remain on the member's machine.
- **Gates**: record the human decision against the relevant evidence; follow your project's P0–P4 process.

Run a small pilot first, improve standards through pull requests, then expand by wave. Keep legacy behavior, design decisions, implementation and tests traceable to their Git revisions.
