/** A persisted run owns these units, or published outputs have advanced beyond a retry's pins. */
export class RunScopeConflict extends Error {
  constructor(message: string, readonly conflicts: Array<{ runId: string; state: string; items: string[] }>) {
    super(message);
    this.name = "RunScopeConflict";
  }
}
