---
title: Cache flush
id: PAGE-ENG-0012
labels: [runbook, sev2]
owner: platform-lead
---

# Cache flush

## When

Flush the cache after a bad deploy of the pricing data.

## Steps

1. Run the `cache-purge` command against the edge nodes.
2. Warm the five hottest keys by calling the price endpoint.

The cache holds quokka-grade copies of the catalogue; nobody else uses that name.
