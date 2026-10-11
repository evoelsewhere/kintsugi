// Port of Policys — the DI token of this module (shared kernel: common/domain/repository.ts).

import { Repository } from "#common/domain/repository.js";
import type { CreatePolicy, Policy } from "./policy.js";

export abstract class PolicyRepository extends Repository<Policy, CreatePolicy> {}
