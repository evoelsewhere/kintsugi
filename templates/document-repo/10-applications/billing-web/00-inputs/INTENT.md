---
title: "Migration intent"
status: "draft"
version: 1
---
# Migration intent

What the people who own this application want from its migration, in their words. The runtime reads it at the start of every stage; a statement here that conflicts with the standards or the architecture is raised as an open question, never silently followed.

## Scope

| In scope | Out of scope |
| --- | --- |
| <!-- modules, screens, batch jobs and interfaces the migration covers --> | <!-- what is left alone, retired or handled elsewhere --> |

## Target

| Item | Intent |
| --- | --- |
| Platform and technology | <!-- the intended target, see ../../../02-architecture/technology-stack.md --> |
| Behaviour | <!-- exact parity with the legacy system, or the changes the business has agreed --> |
| Look and feel | <!-- the same screens, or the project's UI kit --> |
| Data | <!-- migrated in full, archived, or started empty --> |

## Constraints

| Kind | Constraint | Source |
| --- | --- | --- |
| Time | <!-- a date the legacy system must be off by --> | <!-- --> |
| Regulation | <!-- audit trail, retention --> | <!-- --> |
| Technology | <!-- what must or must not be used --> | <!-- --> |
| Operations | <!-- no downtime outside a window --> | <!-- --> |

## Non-functional expectations

| Attribute | Expectation | Reference |
| --- | --- | --- |
| <!-- performance --> | <!-- as fast as today, or a number --> | <!-- Q-01 in ../../../02-architecture/quality-attributes.md --> |

## Known quirks of the legacy system

What the people who run the application know that the code does not say: workarounds, manual steps, behaviour that looks wrong but is relied on.

| Quirk | Where | Keep or change |
| --- | --- | --- |
| <!-- a report is rerun by hand every month end --> | <!-- --> | <!-- keep until the batch job replaces it --> |

## Repositories

<!-- The AS-IS and TO-BE repositories of this application, as declared in kintsugi.yaml. -->

| Role | Repository | Component |
| --- | --- | --- |
| legacy | <!-- org/billing-web-legacy --> | - |
| target | <!-- org/billing-web-ui --> | <!-- web --> |

## People

| Role | Name |
| --- | --- |
| Business owner | <!-- --> |
| Subject-matter experts (rule verdicts) | <!-- --> |
| Technical lead | <!-- --> |
