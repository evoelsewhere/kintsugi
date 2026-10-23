---
kind: "screen"
version: 1
---
# Specification profile: screen

The sections an AS-IS specification of an interactive page, form, panel or transaction with a map a person works in has, in addition to the base sections. They go between **Main flows** and **Dependencies**, in this order.

## Sections

| Section | What it holds | Evidence |
|---|---|---|
| Layout and fields | a table of the fields on the screen: name, type and length, where the value comes from, whether it can be edited, the labels a person sees | the UI definition (template, view, form, map, panel) and the handler that fills it |
| Validations | every check on input, with the rule, when it runs (as typed, on submit, on the server) and the message shown | validators, handlers, map attributes |
| Events and actions | each button, key, link or menu entry and what it does, in order, including what it changes | event handlers, key assignments, form actions |
| Navigation | where a person comes from and goes to, and what data travels with them | routes, transfers of control, links |
| Services called | the interfaces the screen calls, as catalog item ids of `api` items where they are in the catalog, with the data sent and returned | client calls, service invocations, transaction links |
| Authorization | who may open the screen and who may use each action | role checks, security configuration, transaction profiles |
| Messages | the messages and codes it can show and the case for each | message tables, resource files, literals |

## Instructions

Describe the screen as a person using it sees it, then say what the code does. A field table is the core of the profile: list every field the code reads or writes, even when the layout file is missing (record the missing file as a gap).

A section with nothing to say says "None." with the reason (for example "No authorization check in the code"), marked per the `evidence-marks` skill; it is never left out.
