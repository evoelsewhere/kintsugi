// Domain of RulebookEntries: entity and commands. Pure types — no framework, no I/O.

export interface RulebookEntry {
  id: string;
  capability: string;
  maturity: string;
  status?: string;
}

export interface CreateRulebookEntry {
  capability: string;
  maturity: string;
  status?: string;
}
