---
title: "UI conventions"
status: "draft"
version: 1
---
# UI conventions

> Required before any screen is converted. No screen is converted before this file is written.

## Design system / UI kit

| Item | Decision |
| --- | --- |
| Component library | <!-- name and version; converted screens use only these components --> |
| Layout templates | <!-- the page templates of the target base --> |
| Design tokens | <!-- colours, spacing, typography: where they are defined --> |

## Interaction rules

| Situation | Behaviour |
| --- | --- |
| Validation message | <!-- when it shows (on leave, on submit), where, how it is announced --> |
| Error state | <!-- --> |
| Empty state | <!-- the text and the action offered --> |
| Loading | <!-- indicator and when it appears --> |
| Confirmation | <!-- which actions ask for confirmation, and the wording rule --> |

## Internationalization

| Item | Decision |
| --- | --- |
| Resource files | <!-- where texts live; a text is never hard-coded --> |
| Dates and numbers | <!-- formats per locale --> |
| Supported locales | <!-- --> |

## Accessibility

| Item | Requirement |
| --- | --- |
| Standard | <!-- WCAG 2.2 AA --> |
| Keyboard | <!-- every action reachable, tab order follows reading order --> |

## Project-level UX decisions

Each modernization decision (for example menus → navigation, multi-window → tabs) is an ADR. Screens cite the ADR instead of deciding again.

| Decision | Record |
| --- | --- |
| <!-- multi-window screens become tabs --> | `../../02-architecture/adr/<number>-<title>.md` |
