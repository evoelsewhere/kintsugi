// Vitest global setup of the API tests: drops the throwaway databases that earlier runs left behind once they are old
// enough (a run killed before its teardown). Never the configured database; a sweep that fails only warns.

import { hasDatabase, sweepStaleTestDatabases } from "./database.js";

export default async function setup(): Promise<void> {
  if (!hasDatabase) return;
  try {
    const dropped = await sweepStaleTestDatabases();
    if (dropped.length > 0) console.warn(`Dropped ${dropped.length} test database(s) left by earlier runs: ${dropped.join(", ")}`);
  } catch (error) {
    console.warn(`Could not sweep old test databases: ${error instanceof Error ? error.message : String(error)}`);
  }
}
