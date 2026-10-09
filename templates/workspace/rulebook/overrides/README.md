# Overrides

Application- and module-level overrides. They use the same folders as a pack (`conventions/`, `mappings/`, `review-rules/`, …):

```
overrides/<application>/...            # applies to one application
overrides/<application>/<module>/...   # applies to one module (highest precedence)
```

**Precedence**, lowest to highest: vendored → packs → application override → module override.
- A rule with the same `id` in a higher layer replaces the lower one.
- A file with the same relative path replaces the lower one.
- Everything else is added.
