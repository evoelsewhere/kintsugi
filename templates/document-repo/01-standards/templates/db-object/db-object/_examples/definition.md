---
template: "db-object/db-object@1"
unit: "billing-db/schema/statement"
---
# Statement: definition

## Objects

| Object | Type | Definition |
| --- | --- | --- |
| statement | table | CREATE TABLE statement (customer_id VARCHAR(12) NOT NULL, period CHAR(7) NOT NULL, total NUMERIC(14,2) NOT NULL, closed_at TIMESTAMP, PRIMARY KEY (customer_id, period)) |
| ix_statement_period | index | CREATE INDEX ix_statement_period ON statement (period) |

## Columns

| Object | Column | Type | Null | Default | Notes |
| --- | --- | --- | --- | --- | --- |
| statement | customer_id | VARCHAR(12) | no | - | replaces STMT-CUST-ID |
| statement | period | CHAR(7) | no | - | YYYY-MM; replaces STMT-PERIOD |
| statement | total | NUMERIC(14,2) | no | - | sum of the invoice lines of the period |
| statement | closed_at | TIMESTAMP | yes | - | set when the period is closed |

## Constraints and indexes

| Object | Name | Kind | Columns | Rule |
| --- | --- | --- | --- | --- |
| statement | pk_statement | primary | customer_id, period | - |
| statement | ck_statement_total | check | total | RULE-001 |
