// Wiring of the members module (Admin · Identity & Access, A2).

import { Module } from "@nestjs/common";
import { RolesModule } from "../roles/roles.module.js";
import { UsersService } from "./application/users.service.js";
import { UserRepository } from "./domain/user.repository.js";
import { PgUserRepository } from "./infrastructure/pg-user.repository.js";
import { UsersController } from "./interface/users.controller.js";

@Module({
  imports: [RolesModule],
  controllers: [UsersController],
  providers: [UsersService, { provide: UserRepository, useClass: PgUserRepository }],
  exports: [UsersService],
})
export class UsersModule {}
