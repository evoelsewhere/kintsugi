// pnpm docs:links — every relative link and anchor in docs/, templates/ and the READMEs resolves (doc-links.mjs).
// Prints `file:line: <link> -> <reason>` for each one that does not, and exits 1 when there is any.

import { resolve } from "node:path";
import { checkRepository } from "./doc-links.mjs";

const root = resolve(import.meta.dirname, "..");
const problems = checkRepository(root);
for (const problem of problems) console.log(problem);
console.log(problems.length === 0 ? "Every relative link and anchor resolves." : `${problems.length} broken link(s).`);
process.exit(problems.length === 0 ? 0 : 1);
