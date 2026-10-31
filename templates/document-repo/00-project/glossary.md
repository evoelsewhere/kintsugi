---
title: "Glossary"
status: "draft"
version: 1
---
# Glossary

One row per term the project uses. Add a column per language the project works in, and keep one spelling per term: documents, designs and code names follow this table. A term used in a business rule or a design that is not here is added in the same pull request.

## Terms

| Term | Japanese | Vietnamese | Definition | Notes |
| --- | --- | --- | --- | --- |
| Unit | ユニット | Đơn vị | The thing being migrated: one screen, API, batch job, report, event handler, integration or internal module, `<app>/<module>/<unit>` | Sample row: replace it |
| Item | アイテム | Mục | An entry of an application's catalog (`<module>/<item>`); once selected for migration it becomes a unit | Sample row: replace it |
| Business rule | ビジネスルール | Quy tắc nghiệp vụ | A behaviour of the legacy system that the target must keep, with an id `RULE-…` | Sample row: replace it |

## Abbreviations

| Abbreviation | Meaning | Used in |
| --- | --- | --- |
| AS-IS / TO-BE | the legacy system / the target system | all documents |
| ADR | architecture decision record | `02-architecture/adr/` |
| COM | common component | `02-architecture/common/` |
| G0-G4 | the gates of the pipeline | the portal |

## Names not to translate

| Name | Why |
| --- | --- |
| <!-- a product, a screen id, a table name --> | <!-- appears in code and the legacy system as written --> |
