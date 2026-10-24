# ADR-0073: A job reports its structured result through a kernel tool, not a file it writes by hand

- Status: Accepted
- Date: 2026-10-24
- Decision register: D87
- Amends: [ADR-0023](0023-runtime-as-generic-agent-kernel.md)

## Context

A workflow step or agent step with a result schema (the verdict of a security judge, the finding list of a finder) told the agent to write a JSON file `result.json` that matched the schema, with the schema pasted into the task. The orchestrator read the file after the agent had stopped and, when it did not fit, gave the agent one repair attempt.

A run of `understand` showed what that costs. Models often wrote the schema itself into the file (`type`, `required`, `properties`), and a judge that did so once often did it again after the repair: 8 of 19 `security-auditor` verdicts failed, each wasting several minutes and an agent call of a capped budget, and the workflow spent more calls asking again. The failure is structural, not a wording problem: the contract is a hand-written file checked only after the agent has finished, so the model cannot see the mistake while it can still fix it, and a raw schema in the prompt looks like the thing to produce.

## Decision

1. **A job with a result schema gets one more kernel tool, `submit_result`.** `JobSpec.resultSchema` carries the schema; the kernel adds the tool after the agent's own tools, whatever its allowlist says. The tool's parameters are the schema.
2. **The arguments are the result.** The provider's tool calling shapes them and pi validates them before the tool runs, so a result that does not fit is an error the model reads in the same turn and corrects. Nothing is checked after the agent has stopped that could have been checked while it worked.
3. **The valid result is written as `result.json` in the output directory**, through the same path guard as every other output, and the orchestrator reads it as before (shape check, unwrap, repair attempt, `resultTo`). The repair attempt stays as the net for a job that ends without calling the tool; its note now names the tool.
4. The task tells the agent to call the tool and no longer carries the schema text. A job without a result schema is unchanged.

The tool writes only `result.json` into the job's output directory and reads nothing, so it widens no boundary of the sandbox.

## Consequences

- A malformed result costs one tool round trip instead of an agent call and a repair attempt, and the cases the run showed (the schema written back, wrong types) cannot reach the file.
- Agent files and workflows need no change: the schema is already in the step's inputs.
- The model must support tool calling with a JSON Schema as parameters; every provider the runtime supports does. A schema using keywords pi's validator ignores is checked by the orchestrator's shape check as before.
- Not addressed here: the workflow agent budget (`maxAgents`, shared by parallel workflows) is a separate limit and a separate decision.
