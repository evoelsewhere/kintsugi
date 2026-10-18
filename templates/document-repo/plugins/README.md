# `plugins/`

- Written by: people (the project team), through review pull requests
- Serves: P3; the plugins members' harnesses run
- Auto-commit: no — changes arrive as pull requests

Agent plugins for members' harnesses, in the **Claude Code plugin format** (one directory per plugin):

```
<plugin>/
  .claude-plugin/plugin.json   # name (kebab-case, prefixed with the project id), version, description
  skills/<name>/SKILL.md       # stack-specific methods: convert a unit kind, write a test, ...
  agents/*.md                  # optional specialist subagents (e.g. a reviewer for this stack)
  commands/*.md                # optional
  hooks/hooks.json             # optional, e.g. run the target formatter after edits
  .mcp.json                    # optional extra MCP servers
```

**Publishing:**
- Kintsugi validates every plugin in this folder and publishes it to the project marketplace, whose files it generates in this repo.
- The built-in `kintsugi` plugin (task workflow, MCP server, guardrail hooks) is always published alongside.

**Samples:** `_example.example/` teaches the plugin format: it is not loaded and not seeded. Copy it to a real name and adapt it.
