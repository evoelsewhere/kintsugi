---
kind: "event"
version: 1
---
# Specification profile: event

The sections an AS-IS specification of a handler that reacts to a message or a notification has, in addition to the base sections. They go between **Main flows** and **Dependencies**, in this order.

## Sections

| Section | What it holds | Evidence |
|---|---|---|
| Source | the queue, topic, trigger or endpoint it listens to and the conditions of delivery | listener configuration, trigger definitions, subscriptions |
| Message layout | the fields of the message, by data object id where one exists | message classes, schemas, record layouts |
| Handling and ordering | what it does per message, whether order or uniqueness matters and how duplicates are treated | handler code, keys, locks |
| Retries and poison messages | how failures are retried, parked or dropped, and who is told | retry settings, error queues, dead letters |
| Side effects | the data written, the messages sent and the interfaces called | writes, publishes, outbound calls |

## Instructions

Say what makes the handler run and what it assumes about the sender. An assumption the code cannot confirm is a gap.

A section with nothing to say says "None." with the reason (for example "No authorization check in the code"), marked per the `evidence-marks` skill; it is never left out.
