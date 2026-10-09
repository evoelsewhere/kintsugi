// Application layer: use cases of Users. Extends the shared CRUD kernel
// (common/application/crud.service.ts) — add module-specific use cases here.

import { Injectable } from "@nestjs/common";
import { CrudService } from "../../../../common/application/crud.service.js";
import type { CreateUser, User } from "../domain/user.js";
import { UserRepository } from "../domain/user.repository.js";

export type UpdateUser = Partial<CreateUser>;

@Injectable()
export class UsersService extends CrudService<User, CreateUser> {
  constructor(items: UserRepository) {
    super(items, "User");
  }
}
