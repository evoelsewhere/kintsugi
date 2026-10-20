# The item graph (`graph.json`)

Written by `scripts/plan_graph.py` from `catalog.json` and `topology.json`; no code is read.

```json
{
  "app": "billing",
  "source": { "repo": "legacy", "commit": "3fc7e70..." },
  "stats": { "items": 27, "open": 24, "edges": 61, "topology": true },
  "cycles": [["batch/a", "batch/b"]],
  "items": [
    {
      "id": "core/base", "name": "BaseService", "module": "core", "kind": "module", "summary": "",
      "loc": 1654, "files": 62, "complexity": "high", "assetClass": "code", "understood": false,
      "entryPoint": false,
      "dependsOn": [{ "item": "core/util", "kinds": ["call"], "edges": 3 }],
      "usedBy": ["web/entry", "core/service"],
      "dataStores": [{ "id": "ds:ORDERS", "access": ["read", "write"] }],
      "fanIn": 2, "fanOut": 1, "depth": 1, "cycle": null
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `loc`, `files`, `complexity` | Size and the band from the assessment inventory (`low`, `medium`, `high`). |
| `assetClass` | `code`, `test` or `generated`. Only `code` is planned. |
| `understood` | A specification of the item is on the default branch already. |
| `entryPoint` | One of the item's leaves is an entry point of the application. |
| `dependsOn` | Items this item calls, reads or dispatches to; `kinds` are the edge kinds, `edges` how many. |
| `usedBy` | Items that depend on this one. |
| `dataStores` | Data stores it touches, with `read` and `write` access. |
| `fanIn` / `fanOut` | Number of items using it / used by it. |
| `depth` | 0 = depends on no other item; otherwise 1 + the deepest item it depends on. A cycle counts as one step. |
| `cycle` | The ids of the items that depend on each other, or `null`. |

`stats.topology` is false when no topology was available: every item then has no dependencies and depth 0.
