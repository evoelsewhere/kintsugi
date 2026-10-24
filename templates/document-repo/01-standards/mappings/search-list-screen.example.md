---
title: "Search-list screen"
status: "draft"
version: 1
---
# Search-list screen

- **Recognize in legacy**: a screen with filter fields, a search action and a result grid.
- **Target template**: <!-- template / component in the UI kit -->.
- **Behaviours to preserve**: default sort, paging size, empty-result message, export.
- **Allowed deviations**: only those covered by an ADR in `../../02-architecture/adr/`.

## Field mapping

| Legacy control | Target component | Validation | Notes |
| --- | --- | --- | --- |
| <!-- text field with a mask --> | <!-- text input --> | <!-- rule id --> | <!-- --> |
| <!-- grid --> | <!-- data table --> | - | <!-- sorting, paging --> |

## Events

| Legacy event | Target event | Notes |
| --- | --- | --- |
| <!-- Search button click --> | <!-- submit the form --> | <!-- --> |
