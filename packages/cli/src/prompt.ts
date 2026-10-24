// A numbered choice in the terminal: the options are listed, the member types the numbers (or presses Enter for the
// suggested ones). It reads whole lines, so it works in any terminal and over a pipe, and never needs raw mode.

import { createInterface } from "node:readline";
import type { ChoiceOption } from "./cli.js";
import { CliError } from "./profile.js";

/** The values a line of input picks: numbers separated by commas or spaces, `a`/`all` for every option, empty for the defaults. */
export function parseChoice(line: string, options: readonly ChoiceOption[], multiple: boolean, defaults: readonly string[]): string[] {
  const text = line.trim().toLowerCase();
  if (text === "") return [...defaults];
  if (multiple && (text === "a" || text === "all")) return options.map((option) => option.value);
  const picked = text.split(/[\s,]+/).filter((part) => part !== "").map((part) => {
    const index = Number(part);
    const option = Number.isInteger(index) ? options[index - 1] : options.find((candidate) => candidate.value === part);
    if (option === undefined) throw new CliError("CHOICE_INVALID", `"${part}" is not one of the options`);
    return option.value;
  });
  if (picked.length === 0 || (!multiple && picked.length > 1)) throw new CliError("CHOICE_INVALID", multiple ? "Choose at least one option" : "Choose one option");
  return [...new Set(picked)];
}

export async function chooseInTerminal(input: { message: string; options: ChoiceOption[]; multiple: boolean; defaults: string[] }): Promise<string[]> {
  if (!process.stdin.isTTY) throw new CliError("INPUT_REQUIRED", "This choice needs an interactive terminal; pass the options on the command line");
  const lines = [input.message];
  input.options.forEach((option, index) => {
    const marked = input.defaults.includes(option.value) ? "*" : " ";
    lines.push(`  ${marked} ${index + 1}) ${option.label}${option.hint === undefined ? "" : ` — ${option.hint}`}`);
  });
  const suggested = input.defaults.map((value) => input.options.findIndex((option) => option.value === value) + 1).filter((index) => index > 0).join(",");
  lines.push(input.multiple ? `Numbers separated by commas, "all", or Enter for the marked (${suggested || "none"}): ` : `Number, or Enter for ${suggested || "the first"}: `);
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    for (;;) {
      const answer = await new Promise<string>((resolve, reject) => {
        rl.question(`${lines.join("\n")}`, resolve);
        rl.once("close", () => reject(new CliError("CANCELLED", "Choice cancelled")));
      });
      try { return parseChoice(answer, input.options, input.multiple, input.defaults); } catch (error) {
        if (!(error instanceof CliError) || error.code !== "CHOICE_INVALID") throw error;
        process.stderr.write(`${error.message}\n`);
      }
    }
  } finally {
    rl.close();
  }
}
