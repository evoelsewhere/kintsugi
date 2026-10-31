// Which model a runtime agent runs with (Settings → Providers): a binding scoped to the job's
// project wins over the installation default (a binding without a project). The worker applies
// the same rule when it starts a job; the API and the portal use this to say what a job will get.

/** Where an agent's effective binding comes from. */
export type ModelBindingScope = "project" | "installation";

/** The part of a model binding the resolution reads; `projectId` undefined is the installation default. */
export interface ScopedModelBinding {
  agent: string;
  projectId?: string;
}

/** The binding a job of `agent` in `projectId` uses, and its scope; undefined when none applies. */
export function effectiveModelBinding<T extends ScopedModelBinding>(
  bindings: readonly T[],
  agent: string,
  projectId?: string,
): { binding: T; scope: ModelBindingScope } | undefined {
  if (projectId !== undefined) {
    const project = bindings.find((entry) => entry.agent === agent && entry.projectId === projectId);
    if (project !== undefined) return { binding: project, scope: "project" };
  }
  const installation = bindings.find((entry) => entry.agent === agent && entry.projectId === undefined);
  return installation === undefined ? undefined : { binding: installation, scope: "installation" };
}

/**
 * The project-scoped bindings that set one provider and model for every agent of `agents` in
 * `projectId`, merged into `bindings`: an agent's existing binding for that project is replaced,
 * every other binding is kept.
 */
export function withProjectBindings<T extends ScopedModelBinding>(
  bindings: readonly T[],
  projectId: string,
  agents: readonly string[],
  binding: (agent: string) => T,
): T[] {
  const names = new Set(agents);
  return [...bindings.filter((entry) => !(entry.projectId === projectId && names.has(entry.agent))), ...[...names].map(binding)];
}
