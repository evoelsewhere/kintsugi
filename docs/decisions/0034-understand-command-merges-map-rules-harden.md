# ADR-0034: One understand command; map, extract-rules and harden are parts of it

- Status: Accepted
- Date: 2026-10-13
- Decision register: D53

## Context
ADR-0033 already reduced the runtime stages to `assess` and `understand`: `understand` runs the topology fragments, the rule extraction and the security scan per selected catalog item. The commands `map`, `extract-rules` and `harden`, their stage plans and their stage ids were left behind as stand-alone whole-application stages, so the same method was described in four places and two of the three plans could no longer be reached from the portal.

## Decision
- `commands/modernize-understand.md` is the single specification of the phase. Its "Method reference" holds what the three commands defined: the topology schema and extraction principles, the rule card format and priorities, and the security-finding rules (secrets quarantine, finders, refuters, coverage gaps).
- The commands `modernize-map`, `modernize-extract-rules` and `modernize-harden` and the stage plans `map`, `extract-rules` and `harden` are removed. The shared topology extraction stays in `services/orchestrator/src/jobs/plans/topology.ts` (used by `assess`). The workflows `extract-rules.js` and `harden-scan.js` and their scripts stay: `understand` runs them per item.
- The portal's Topology, Rules and Security results remain views of the outputs of `understand`.
- Old job runs of the removed stages are not migrated: the data is development data and is cleaned.

## Consequences
- One stage id per runtime step; the command list the API serves shows two runtime stages.
- Not carried over (they were not wired into `understand`): persona flows, per-node descriptions and exportable Mermaid diagrams of the former `map`, and the remediation patch with its review loop of the former `harden`. `node_packets.py` and `merge_topology.py` stay for a later wiring.
