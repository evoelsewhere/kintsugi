// Temporary in-memory adapter (development skeleton). Replace it with the Postgres
// adapter when this module's data lands — one schema per domain; see
// admin/llm-providers/infrastructure/pg-llm-provider.repository.ts for the pattern.

import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InMemoryRepository } from "../../../../common/infrastructure/in-memory.repository.js";
import type { CreateUser, User } from "../domain/user.js";
import { UserRepository } from "../domain/user.repository.js";

@Injectable()
export class InMemoryUserRepository extends InMemoryRepository<User, CreateUser> {
  constructor() {
    super((input) => ({ id: randomUUID(), ...input }));
  }
}
