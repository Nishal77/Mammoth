import { AsyncLocalStorage } from "node:async_hooks";
import { ForbiddenError } from "../errors/app-error.js";

export type DispatchContext = {
  approvalId: string;
  companyId: string;
  actionType: string;
};

/**
 * Async-local storage keyed per execution chain.
 * Concurrent workers are fully isolated — no shared mutable state.
 */
const dispatchStorage = new AsyncLocalStorage<DispatchContext>();

/**
 * Asserts a write tool is being called from inside an approved dispatch context.
 * Throws ForbiddenError if called outside — meaning an agent called the tool
 * directly inside execute() without going through createApproval().
 *
 * Called at the entry point of every write-capable tool function.
 */
export function requireDispatchContext(): DispatchContext {
  const ctx = dispatchStorage.getStore();
  if (!ctx) {
    throw new ForbiddenError(
      "Write tool called outside dispatch context. " +
        "External actions must go through BaseAgent.createApproval() and the action-execution-worker. " +
        "Direct tool calls inside execute() are not permitted."
    );
  }
  return ctx;
}

/**
 * Runs fn inside an approved dispatch context.
 * Only the action-execution-worker calls this — after an approval is resolved.
 *
 * @param ctx - The approved action context (approvalId, companyId, actionType)
 * @param fn  - The tool dispatch function to execute
 */
export function runWithDispatchContext<T>(
  ctx: DispatchContext,
  fn: () => Promise<T>
): Promise<T> {
  return dispatchStorage.run(ctx, fn);
}
