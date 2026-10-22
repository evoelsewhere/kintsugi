---
id: zeta
title: Bad application set
version: 1
scope: application
appliesTo: ["screen"]
needs: ["unitset"]
reads: ["../secrets", "10-applications/{app}/{unit}/", "/abs", "ok/"]
---
# Bad application set

| Path | Template | Required | When |
| --- | --- | --- | --- |
| a.md | a.md | yes | screen |
