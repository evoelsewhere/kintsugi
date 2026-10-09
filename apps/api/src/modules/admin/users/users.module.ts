// Wiring of the users module: interface + application + the
// infrastructure adapter bound to the domain port.

import { Module } from "@nestjs/common";
import { UsersService } from "./application/users.service.js";
import { UserRepository } from "./domain/user.repository.js";
import { InMemoryUserRepository } from "./infrastructure/in-memory-user.repository.js";
import { UsersController } from "./interface/users.controller.js";

/** admin · identity & access — docs/architecture/05-building-block-view.md. */
@Module({
  controllers: [UsersController],
  providers: [UsersService, { provide: UserRepository, useClass: InMemoryUserRepository }],
  exports: [UsersService, UserRepository],
})
export class UsersModule {}
