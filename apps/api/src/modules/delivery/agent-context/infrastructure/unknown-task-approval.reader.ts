// Human approval remains unknown until the evidence-bound Git bridge is implemented.

import { Injectable } from "@nestjs/common";
import { TaskApprovalEvidenceReader } from "../domain/task.js";

@Injectable()
export class UnknownTaskApprovalEvidenceReader extends TaskApprovalEvidenceReader {
  async sourceApproval(): Promise<"unknown"> {
    return "unknown";
  }

  async predecessorStatus(): Promise<"unknown"> {
    return "unknown";
  }
}
