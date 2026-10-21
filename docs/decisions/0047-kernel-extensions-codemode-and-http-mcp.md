# ADR-0047: The kernel gets codemode and HTTP MCP servers, read-only by default

- Status: Accepted (amends [ADR-0023](0023-runtime-as-generic-agent-kernel.md) decision 5; supersedes the no-MCP/no-codemode lines of [security](../architecture/concepts/security.md) and [runtime agents](../reference/runtime-agents.md))
- Date: 2026-10-21
- Decision register: D63

## Context

[ADR-0023](0023-runtime-as-generic-agent-kernel.md) locked pi down: nothing is discovered from the checkout or the host, and MCP, codemode and tool search stay off. That was right while the kernel had five tools, and it left three problems:

- **Context.** `understand` reads dozens of files per item. Every `read`, `grep` and `ls` result enters the model's context, so a long job spends most of its window on text the model only needed to filter. pi's `codemode` tool lets the model write a short script that calls tools and prints only what it needs; the calls inside the script never enter the context.
- **Reach.** An agent could not see the trackers and wikis the project keeps its knowledge in. pi speaks MCP, which is how those systems are exposed today.
- **A defect hid behind the lockdown.** The job child runs under Node's permission model (`--permission`) without `--allow-child-process` or `--allow-worker`. The kernel's `shell` and `git` tools ([ADR-0040](0040-kernel-shell-and-git-tools.md)) start processes, so they could not run in a real job, and a worker thread (what codemode needs) could not start either. No test ran them in the real child.

## Decision

1. **The child may start processes and workers.** The job child gets `--allow-child-process` and `--allow-worker`. The isolation boundary is the OS account and the job workspace ([ADR-0029](0029-job-workspaces-instead-of-os-sandboxes.md)), as it always was; the permission model only keeps the Node process itself from reading outside the job. An end-to-end test runs the real child and shows that spawn and worker threads work and that a path outside the job stays unreadable.
2. **`codemode` is a kernel tool, on for every agent without a tool list.** The model writes JavaScript that runs in pi's QuickJS sandbox (WebAssembly, in a worker thread, no file system, network or timers). The kernel narrows it:
   - a script may call only the **read tools** (`read`, `ls`, `grep`, `find`) and read-only MCP tools. The other kernel tools are marked `model-only` (not callable from a script) and a `tool_call` handler refuses any other nested call, so a job's write boundary is the same with or without a script;
   - the `models` global (classifier and image models, billed to the job) is off;
   - a script gets a deadline (120 s) and an output cap (8,000 tokens) even when the model asks for none or for more.
   An agent that lists its tools gets codemode only by listing `codemode`.
3. **MCP servers are administrator data, HTTP only.** An administrator registers a server (an id, an HTTP URL, headers, a request timeout, tool-name patterns) in Settings → MCP servers; header values are credentials, encrypted like LLM keys ([ADR-0009](0009-llm-provider-config.md)), never returned, never audited. Nothing is read from an `mcp.json`, no stdio server is started, and a project cannot add a server.
4. **MCP is opt-in per agent.** An agent names a server in its `tools` (`mcp__<server>__*`, or one tool). MCP is never part of the implicit "every kernel tool" default. The worker resolves the named servers, decrypts their headers and hands them to the job's child on stdin (never in its environment or an event); the job fails to start if a named server is missing or disabled.
5. **Only read-only MCP tools run.** A tool runs when its server marks it `readOnlyHint`, or the administrator allowed it by name (`allowedTools`, `*` patterns). Any other call is refused as a blocked call, whether the model or a script makes it. A header value pi would interpret (`!command`, `${VAR}`) is refused at registration and again before a job starts.
6. **Where the tools appear.** With codemode, an MCP server's tools are callable from scripts only (they stay out of the prompt); without it they are declared to the model directly.
7. **`pi-codemode`, `pi-mcp` and `pi-telemetry` are direct, exactly pinned dependencies** of `services/runtime` ([ADR-0018](0018-pin-pi-exact-version.md)). The API's connection test uses the runtime's MCP client through `@kintsugi/runtime/mcp-probe`, so pi-specific code stays in `services/runtime`.

Tool search stays off.

## Consequences

- Long reading jobs cost fewer tokens and overflow less. The price is a worker thread per script and a 256 MB cap per script VM (pi's limit); at most two scripts run at once per job process.
- The kernel's write boundary did not change: nothing a script or an MCP tool does can write to the job's output through the kernel, and the kernel still refuses writes outside `outDir`. A *remote* MCP tool that writes is exactly what `readOnlyHint` and `allowedTools` guard; an administrator who allows one accepts that the remote system changes.
- The network is not restricted by the permission model. A registered server is reachable from the worker's host; the administrator decides what to register.
- `shell` and `git` work in real jobs for the first time; their output is bounded ([ADR-0048](0048-runtime-telemetry-compaction-and-prompt-cache.md)).
- Member harnesses are untouched: their MCP and tools remain theirs.

## Alternatives considered

- **Keep MCP off and add knowledge-base tools by code.** Rejected: each integration would be kernel code with its own review; MCP gives the same reach as data.
- **Allow stdio MCP servers.** Rejected: an administrator-typed command would run inside every job that names it. HTTP needs no process and no new fs access.
- **Make MCP available to every agent.** Rejected: an agent that does not need a tracker should not be able to read one; opt-in keeps the default surface as small as before.
- **Allow write tools in scripts.** Rejected for now: a script runs many calls without the model seeing each one, which is the wrong place for a mutation. A write is a tool call the model makes and a person can see in the job's record.
