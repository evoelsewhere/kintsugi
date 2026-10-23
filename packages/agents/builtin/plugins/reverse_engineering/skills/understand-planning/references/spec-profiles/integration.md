---
kind: "integration"
version: 1
---
# Specification profile: integration

The sections an AS-IS specification of an exchange of data with an external system has, in addition to the base sections. They go between **Main flows** and **Dependencies**, in this order.

## Sections

| Section | What it holds | Evidence |
|---|---|---|
| Counterparty | the external system or party by logical name (never a URL with credentials) and what the exchange is for | configuration, client code, documentation in the repository |
| Direction, protocol and format | inbound, outbound or both; the protocol, the format and the layout by data object id | client and server code, file definitions |
| Field mapping | how fields of the system map to the exchange, with the conversions | mapping code, transformations |
| Schedule and volumes | when it runs and how much it moves, when the code or configuration says | schedules, limits |
| Error handling and reconciliation | what happens on a failed or partial exchange and how both sides are brought back in line | retry logic, control totals, error files |
| Security | how the exchange is authenticated and protected (names only, never a credential) | security configuration, key handling |

## Instructions

Write the exchange as an interface agreement a new team could implement. Mask every credential and every host name that carries one.

A section with nothing to say says "None." with the reason (for example "No authorization check in the code"), marked per the `evidence-marks` skill; it is never left out.
