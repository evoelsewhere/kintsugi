---
id: zeta
title: Bad application set
version: 1
scope: application
needs: ["unitset"]
reads: ["../secrets", "10-applications/{app}/{unit}/", "/abs", "ok/"]
---
# Bad application set

| Path | Template | Required |
| --- | --- | --- |
| a.md | a.md | yes |
