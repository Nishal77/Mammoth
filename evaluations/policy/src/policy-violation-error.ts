import { AppError } from "@mammoth/shared/errors";

/**
 * Thrown when an agent output violates a hard architectural policy rule.
 * Always indicates a programming error in the agent, not a user error.
 * Workers catching this must dead-letter the job — never retry.
 */
export class PolicyViolationError extends AppError {
  readonly policyCode: string;

  constructor(message: string, policyCode: string) {
    super(message, "POLICY_VIOLATION", 403);
    this.policyCode = policyCode;
  }
}
