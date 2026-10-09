# harness/

Canonical, harness-neutral assets for **members' AI harnesses** (Claude Code, GitHub Copilot, Codex, ChatGPT). `services/harness-hub` renders them into each harness's native layout (ADR-0005); members fetch them with `kintsugi assets pull` or through the Kintsugi MCP server.

- `skills/<name>/SKILL.md` — Agent Skills for implementation work (reverse design, version-up, UT generation, test-case generation, …).
- `task-packs/` — templates the `task-planner` runtime agent fills per work item.

Seed assets to import from existing projects: .NET / ReactJS version-up prompt libraries, UT generation, test-case generation, DD generation (API/UI), Excel→Markdown converter.
