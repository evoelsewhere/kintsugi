// What an administrator should know before giving a runtime agent a tool that runs commands (ADR-0092, ADR-0093):
// built-in agents read with the confined tools only; `shell`, `git` and `codemode` run with the job's account (the worker's own account unless job isolation is turned on, ADR-0093).

/** The tools that run commands or scripts with the job's account, each with what it lets a prompt injection do. */
const SHELL_LIKE: Readonly<Record<string, string>> = {
  shell:
    "shell runs commands with the job's account (the worker's own account unless job isolation is turned on, ADR-0093). A prompt injection in the code the agent reads could use it to reach files outside the job (ADR-0093). On a worker without bash the shell tool is not offered to the agent. Built-in agents do not get it.",
  git: "git reads repository history with the job's account (the worker's own account unless job isolation is turned on, ADR-0093). A prompt injection in the code the agent reads could use it to reach files outside the job (ADR-0093). Built-in agents do not get it.",
  codemode:
    "codemode runs a script the model writes with the job's account (the worker's own account unless job isolation is turned on, ADR-0093). A prompt injection in the code the agent reads could use it to reach files outside the job (ADR-0093). Built-in agents do not get it.",
};

/** The warnings to show for an agent's tools, in the order of the tools; none for read-only tools. */
export function toolWarnings(tools: readonly string[]): Array<{ tool: string; text: string }> {
  return tools.flatMap((tool) => (SHELL_LIKE[tool] === undefined ? [] : [{ tool, text: SHELL_LIKE[tool] }]));
}
