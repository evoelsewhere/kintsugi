// Shared application kernel: pagination payload. Pure types + helper — usable from
// any layer (the zod query schema lives in common/interface/pagination.ts).

export interface PageQuery {
  limit: number;
  offset: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function toPage<T>(items: T[], total: number, query: PageQuery): Page<T> {
  return { items, total, limit: query.limit, offset: query.offset };
}
