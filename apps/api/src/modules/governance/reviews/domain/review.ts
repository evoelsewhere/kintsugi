// Domain of Reviews: entity and commands. Pure types — no framework, no I/O.

export interface Review {
  id: string;
  subject: string;
  decision: string;
  status?: string;
}

export interface CreateReview {
  subject: string;
  decision: string;
  status?: string;
}
