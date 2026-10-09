// Domain of Users: entity and commands. Pure types — no framework, no I/O.

export interface User {
  id: string;
  username: string;
  role: string;
  status?: string;
}

export interface CreateUser {
  username: string;
  role: string;
  status?: string;
}
