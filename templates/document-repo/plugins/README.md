# `plugins/`

- Written by: people (the project team), through review pull requests
- Serves: P3; the plugins members' harnesses run
- Auto-commit: no — changes arrive as pull requests

Project plugins for members' AI clients, in the **Claude Code plugin format** (one directory per plugin):

```
<plugin>/
  .claude-plugin/plugin.json   # name (kebab-case, prefixed with the project id), version, description
  skills/<name>/SKILL.md       # stack-specific methods: convert a unit kind, write a test, ...
  agents/*.md                  # optional specialist subagents (e.g. a reviewer for this stack)
  commands/*.md                # optional
```

**Distribution:** not yet. Kintsugi distributes only its built-in member plugins today (`kintsugi install plugin`); the plugins written here are not published to members. When they are, only skills, agents and commands reach members, and a command may carry at most the one activity hook of its front matter: hook files, scripts and MCP server files are not distributed, so write plugins that need none of them.

**Samples:** `_example.example/` teaches the plugin format: it is not loaded and not seeded. Copy it to a real name and adapt it.
