import type { JobInput } from "@kintsugi/runtime-sdk";

/** Human-readable one-liner per read-only job input (for prompts and simulated logs). */
export function describeInput(input: JobInput): string {
  switch (input.kind) {
    case "repo":
      return `repo ${input.url}@${input.commit}`;
    case "pull-request":
      return `pull-request ${input.url}`;
    case "document":
      return `document ${input.path} (${input.repoUrl}@${input.commit})`;
    case "kb-query":
      return `kb ${input.kb} "${input.query}"`;
  }
}

export function describeInputs(inputs: readonly JobInput[]): string {
  return inputs.map(describeInput).join("; ");
}
