---
kind: "api"
version: 1
---
# Specification profile: api

The sections an AS-IS specification of a synchronous interface other programs call has, in addition to the base sections. They go between **Main flows** and **Dependencies**, in this order.

## Sections

| Section | What it holds | Evidence |
|---|---|---|
| Contract | the operations: method and path or operation name, parameters, and what each is for | routes, annotations, service definitions, program entry parameters |
| Request and response | the shape of what comes in and goes out, by data object id where one exists in the data objects of the item | DTOs, records, copybooks, schemas |
| Status and error codes | each status or return code, the case that produces it, and the message | exception handling, response building, return code assignment |
| Authentication and authorization | how the caller is identified and what it may call | filters, interceptors, security configuration, region security |
| Side effects | the data written, the events raised and the other interfaces called | writes, publishes, outbound calls |
| Transactions and idempotency | transaction boundaries, locking, and what happens when a call is repeated | transaction annotations, commit and rollback points, keys |
| Known callers | the items that call it, as catalog item ids (the screens first), with the operation each uses | the `usedBy` links of the brief and the call sites |

## Instructions

Specify the interface as a caller would need it to build a client without reading the code. State what is not enforced (an unchecked parameter, a missing authorization check) as an observation.

A section with nothing to say says "None." with the reason (for example "No authorization check in the code"), marked per the `evidence-marks` skill; it is never left out.
