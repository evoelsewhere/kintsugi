// Domain of PortfolioItems: entity and commands. Pure types — no framework, no I/O.

export interface PortfolioItem {
  id: string;
  unit: string;
  disposition: string;
  status?: string;
}

export interface CreatePortfolioItem {
  unit: string;
  disposition: string;
  status?: string;
}
