// Shared domain kernel (DDD): the generic repository port. Feature modules extend it
// with their own port class (a distinct DI token); infrastructure adapters implement it.
// See apps/api/README.md → "Module anatomy".

export interface Entity {
  id: string;
}

export abstract class Repository<T extends Entity, C> {
  abstract list(): Promise<T[]>;
  abstract get(id: string): Promise<T | undefined>;
  abstract create(input: C): Promise<T>;
  /** Partial update; returns undefined when the record does not exist. */
  abstract update(id: string, input: Partial<C>): Promise<T | undefined>;
  abstract remove(id: string): Promise<boolean>;
}
