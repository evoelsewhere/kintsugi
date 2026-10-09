# Runners

Scripts and tools that run the legacy or target system, export data, or compare outputs. Declare each one under `runners` in `pack.yaml`:

```yaml
runners:
  run-target:
    image: mcr.microsoft.com/dotnet/sdk:8.0   # must match the installation image allowlist
    command: [bash, runners/run_target.sh]
    resources: {cpus: 2, memory: 4g, timeoutSec: 1800}
    network: none                             # none | allowlist (admin-approved hosts)
```

- **Isolation**: runners are project code. Kintsugi runs each one in its own isolated container with the declared image, never in the worker or the app.
- **What the container gets**: only the job directory (`/src` read-only, `/out` writable). It never receives LLM credentials.
- **Script header**: start every script with a comment that declares its inputs (arguments, environment) and its outputs (files under `/out`).
- **Custom comparators**: a custom comparator is a runner that writes the standard compare report (`/out/report.json`: verdict, diffCount, clusters, reportPath).
