# Document reference identifiers

Published references identify facts in the document repository ([ADR-0075](../decisions/0075-compact-stable-document-reference-ids.md)). They are independent of database primary keys, runtime run IDs and canonical unit paths.

## Generated references

| Family | Example | Owner | Matching identity |
|---|---|---|---|
| Business rule | `RULE-CARD01-0001` | `split_rules.py` | Canonical primary source citation and normalized rule name |
| Security finding | `SEC-CARD01-0001` | `split_findings.py` | Canonical source citation, CWE and normalized title |
| Specification gap | `GAP-CARD01-0001` | `finish_items.py` | Kind, evidence location and normalized question |

`CARD01` is the catalog item's immutable `referenceCode`. Assess derives a module abbreviation from its key (initials for several words, otherwise its first four characters), disambiguates collisions, then appends the unit number. A module `code` has at most eight uppercase letters/digits, starting with a letter; the complete unit scope has at most sixteen. Modules and units keep their allocated codes across reconciliation and retirement. Scope numbers use at least two digits; reference sequences use at least four, growing without truncation. `APP00` is reserved for the standalone application-wide rule renderer. Uniqueness is per application, so links outside an application must include the document path.

## Allocation history

The unit's legacy directory holds `identifiers/rules-ids.md`, `identifiers/findings-ids.md` and `identifiers/gaps-ids.md`. Each file has front matter `type`, `scope`, `version: 1`, `allocated`, followed by a table:

| Column | Meaning |
|---|---|
| ID | The published reference |
| Fingerprints | Comma-separated SHA-256 identities associated with this reference |
| Anchor | SHA-256 matching anchor; no source content or credential values |
| Status | `active` or `retired` |

The allocator first matches historical identities, including retired entries. For a rule or finding, exactly one active anchor and exactly one current candidate can preserve the ID across a label edit. A shared citation with ambiguous candidates gets fresh IDs. Conflicting records with identical identities fail rather than choose by ordering. GAP matching includes the question itself: changing its meaning or wording allocates a new identity. Priority, confidence, severity, explanatory text and array order are not identity fields. A changed source citation can allocate a new ID; matching does not guess semantic equivalence across source changes.

Removed entries remain in the ledger. Their numbers are never assigned to other identities. A missing or malformed ledger for published output is an error; restore the file from Git. Ledgers and the catalog are machine maintained and must be retained with their documents. Start and Retry claim scopes atomically in Postgres across API processes. An active run or an unresolved pull request prevents another run on the same units; closed PRs require Abandon. A retry whose pinned history predates a competing merge is refused, including fresh retries, so a new run reads the current ledgers. Each allowed concurrent understand run owns distinct unit paths. The RULE and SEC steps also have separate ledgers.

The specification job uses unique draft GAP numbers from its brief's scope, consistently in prose and its gaps table. Finish maps them to persistent IDs in one simultaneous replacement and publishes the normalized specification with its ledger. The output hook rejects dangling references, duplicate IDs, invalid kinds/impacts, conflicting equivalent rows and missing gaps sections before the specification can be cached as successful. Finish merges equivalent rows, maps every draft alias to the retained published ID and validates the same contract. An explicit `None.` section is valid and retires all previous gaps.

## Other identifiers

| Identifiers | Convention |
|---|---|
| Requirements, shared components | Existing short project codes, e.g. `REQ-INV-001`, `COM-LOG-01`; author maintained |
| API operations, tests, events, validation, layout, batch steps, report columns, errors | Existing unit-local IDs from project design templates (`API-001`, `TC-001`, `EVT-001`, `VAL-001`, `ITM-001`, `STEP-01`, `COL-01`, `ERR-0001`); preserve once published |
| Unit, module, application | Canonical path keys remain stable; referenceCode is a separate readable alias |
| Runs, attempts, artifacts, accounts, repositories | Existing opaque database or runtime IDs |
| Digests, fingerprints, commits | Full integrity/identity values; never replace with display counters |
| Permission codes, harness IDs, route keys | Existing protocol vocabulary |

Historical reference formats remain readable. Generation requires a catalog produced by the current assess stage and its merged allocation history. Regenerating an existing repository requires deliberate handling of old reviews and design references; readers do not silently rewrite them.
