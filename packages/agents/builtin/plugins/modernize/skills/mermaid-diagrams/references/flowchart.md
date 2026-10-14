# Flowchart reference

Condensed from softaworks/agent-toolkit `skills/mermaid-diagrams/references/flowcharts.md` (MIT, see
`../LICENSE-softaworks`), rewritten to the rules of this skill: sanitized ids, quoted labels, no
inline styles. Used for `ARCHITECTURE.mmd`, `call-graph.mmd`, `data-lineage.mmd`, `critical-path.mmd`,
module graphs and phase plans.

## Header and direction

`flowchart TB` (or `TD`) top to bottom, `LR` left to right, `BT`, `RL`. The header is the first line.

## Node shapes

| Shape | Syntax | Use for |
|---|---|---|
| Rectangle | `svc_a["Text"]` | programs, services, steps |
| Rounded | `svc_a("Text")` | user-facing steps |
| Stadium | `ui_a(["Text"])` | start and end of a flow |
| Subroutine | `svc_a[["Text"]]` | shared library routine, copybook |
| Cylinder | `db_a[("Text")]` | data stores (tables, files, queues) |
| Circle | `ev_a(("Text"))` | events, junctions |
| Decision | `chk_a{"Text?"}` | branches on the critical path |
| Hexagon | `job_a{{"Text"}}` | batch jobs, schedulers |
| Parallelogram | `io_a[/"Text"/]` | inputs and outputs (files, reports) |

Every label is quoted, even plain words, so a later edit cannot break the diagram.

## Edges

| Syntax | Meaning |
|---|---|
| `a --> b` | arrow (calls, writes, sequence) |
| `a --- b` | line without arrow (association) |
| `a -.-> b` | dotted arrow (reads, optional or async) |
| `a ==> b` | thick arrow (the critical path) |
| `a -->\|"label"\| b` | labelled edge; quote anything beyond letters, digits, spaces, `.`, `,`, `-` |
| `a --> b & c` | fan-out: two edges (counts as two against the limit) |

Do not use the inline text form `a -- text --> b`; always use `-->|"text"|`.

## Subgraphs

```mermaid
flowchart TB
    subgraph dom_billing["Billing"]
        direction LR
        svc_invoice["INVOICE"]
        svc_rates["RATES"]
    end
    subgraph dom_customers["Customers"]
        svc_custupd["CUSTUPD"]
    end
    svc_invoice --> svc_rates
    svc_custupd --> svc_invoice
```

- Every subgraph has an id and a quoted title: `subgraph dom_x["Title"]`, closed by `end`.
- A `direction` inside a subgraph is ignored when its nodes link outside it; do not rely on it.
- Link nodes, not subgraph ids; nested subgraphs that are themselves linked break the layout.

## Classes

```mermaid
flowchart TD
    ui_login(["Login screen"]):::entry
    svc_auth["AUTHCHK"]
    ui_login --> svc_auth
    class svc_auth service
    classDef entry stroke-width:3px
    classDef service fill:#eef7ee,stroke:#3c7a3c
```

`:::name` on a node or `class id1,id2 name` assign a class; every class needs a `classDef`. Use classes
for meaning (kind, entry point, critical step), not decoration; avoid `style` lines.

## Patterns

Decision on a critical path:

```mermaid
flowchart TD
    ui_start(["Order received"]) --> chk_credit{"Credit OK?"}
    chk_credit -->|yes| svc_post["Post order"]
    chk_credit -->|no| svc_hold["Hold for review"]
    svc_post ==>|"p50 120 ms, p99 900 ms"| db_orders[("ORDERS")]
```

Phase plan (never a gantt):

```mermaid
flowchart LR
    ph_1["Phase 1 - pilot: billing"] --> ph_2["Phase 2 - customers"]
    ph_1 --> ph_3["Phase 3 - reporting"]
    ph_2 --> ph_4["Phase 4 - decommission"]
    ph_3 --> ph_4
```

## Pitfalls

- Keywords as ids (`end`, `default`, `class`, `style`, …) and ids starting with `o` or `x` break edges.
- A `%%` comment after a statement on the same line is a syntax error; comments go on their own line.
- Unquoted parentheses, brackets, colons, semicolons or quotes inside a label end the shape early.
- More than 40 edges or about 25 nodes: collapse to domain level or split (see SKILL.md).
