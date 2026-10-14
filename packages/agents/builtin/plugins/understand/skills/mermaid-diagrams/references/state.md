# State diagram reference

Kintsugi's own reference for `stateDiagram-v2`, written for this skill. Used for lifecycles the code
implements: the status values of an order, an account or a batch run and the transitions between them.

## Basics

```mermaid
stateDiagram-v2
    [*] --> st_draft
    st_draft --> st_submitted : submit
    st_submitted --> st_approved : approve (RULE-021)
    st_submitted --> st_rejected : reject
    st_rejected --> st_draft : correct
    st_approved --> [*]
    st_draft : Draft (status D)
    st_submitted : Submitted (status S)
    st_approved : Approved (status A)
    st_rejected : Rejected (status R)
```

- `[*]` is the start (as a source) or the end (as a target).
- State ids follow the id rules of the skill (`st_` prefix); the description after `id : text` is
  plain text that may hold spaces. Use it for the legacy status code.
- Transition labels after ` : ` name the event or the program that triggers it, and the rule id when one
  applies. Write `;` as `#59;`.

## Composite states and choices

```mermaid
stateDiagram-v2
    [*] --> st_open
    state st_open {
        [*] --> st_new
        st_new --> st_partial : partial payment
        st_partial --> st_partial : partial payment
    }
    state chk_paid <<choice>>
    st_open --> chk_paid : payment posted
    chk_paid --> st_closed : balance is zero
    chk_paid --> st_open : balance remains
    st_closed --> [*]
```

- `state st_x { … }` groups sub-states; every `{` needs its `}` on its own line.
- `state chk_x <<choice>>` is a decision; `<<fork>>` and `<<join>>` split and merge parallel paths.
- `note right of st_x : text` adds a fact the transitions cannot show.

## Pitfalls

- Keywords and ids starting with `o` or `x` break transitions: keep the `st_` prefix.
- A state the code never reaches is a finding: draw it only if the code defines it, and say so.
- More than about 25 states or 40 transitions: split the lifecycle by phase.
