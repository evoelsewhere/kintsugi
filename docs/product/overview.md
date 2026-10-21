# Product overview

> *Kintsugi (金継ぎ)* is the Japanese art of repairing broken pottery with gold. It does not throw the old piece away; it makes it more valuable. The logo shows a legacy block (navy/cream) with a golden crack and square "modules" breaking away: monolith → modular.

## Problem

Migration and modernization at portfolio scale (tens to hundreds of applications) usually suffers from:
- Scattered artifacts: scorecards in spreadsheets, prompt libraries in separate repos, a knowledge base rebuilt by every project.
- Dependence on whichever AI harness each team or customer already has (GitHub Copilot, Claude Code, ChatGPT/Codex…), which is hard to standardize and hard to measure.
- No consistent way to measure AI effectiveness across projects (AI coverage, outcome ratio, defect rate…).

## What Kintsugi is

**An application portal that orchestrates the whole migration lifecycle from as-is to to-be architecture.**

1. **A project build step**: Kintsugi is a common engine, so each project first registers its AS-IS and TO-BE repos and writes its **standards** (target conventions, mappings, review rules) in its single document repo. See [build a project](../guides/build-project.md).
2. **A configurable delivery pipeline**: P0 Mobilize → P1 Discover & Assess → P2 Define To-Be → P3 Prepare Factory → P4 Migrate. See [delivery pipeline](../methodology/delivery-pipeline.md).
3. **Four pillars** (Admin · Delivery · Monitoring · Governance) on a shared core platform. See [building block view](../architecture/05-building-block-view.md).
4. **Two kinds of agents.** See [runtime and member harnesses](../architecture/concepts/runtime-and-member-harnesses.md).
   - **The Kintsugi Runtime, built on pi**, runs the platform's own agents: knowledge ingest, KB assistant, assessment, wave planning, to-be analysis, task planning, gate review, insight.
   - **Members' own AI harnesses** (Claude Code, GitHub Copilot, ChatGPT/Codex) do the implementation, with context supplied by Kintsugi.
5. **A self-hosted package with Git as the source of truth.**
   - Each project installs Kintsugi with Docker Compose.
   - Code, documents and deliverables live in Git.
   - Postgres keeps only operational state and indexes.
   - See [deployment view](../architecture/07-deployment-view.md) and [Git as source of truth](../architecture/concepts/git-as-source-of-truth.md).

## What Kintsugi is not

- Not another coding agent, and not a replacement for members' harnesses. Kintsugi provides context and quality control; members still do the implementation with their own tools.
- Not a project-management tool replacing Jira. Kintsugi syncs with the tracker and focuses on migration units and gates.
- Not a generic knowledge base. The KB serves the AS-IS / TO-BE of specific applications.

## Who it is for

The roles are listed in the [stakeholder table](../architecture/01-introduction-and-goals.md#13-stakeholders):
- delivery leads and PMs
- business analysts
- architects
- developers and QC
- the AI enablement roles: AI champion, AI engineer, prompt engineer, knowledge-management lead/engineer, AI practice owner

Terms are defined in the [glossary](../reference/glossary.md).
