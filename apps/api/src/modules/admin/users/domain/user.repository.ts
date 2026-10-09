// Port of Users — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "../../../../common/domain/repository.js";
import type { CreateUser, User } from "./user.js";

export abstract class UserRepository extends Repository<User, CreateUser> {}
