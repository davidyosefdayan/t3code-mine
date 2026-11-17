import type { OrchestrationV2ThreadProjection } from "@t3tools/contracts";
import { idleCompactionStatus } from "@t3tools/shared/idleCompactionStatus";

export type IdleCompactionRecords = Pick<
  OrchestrationV2ThreadProjection,
  | "thread"
  | "runs"
  | "messages"
  | "providerThreads"
  | "providerTurns"
  | "runtimeRequests"
  | "turnItems"
  | "contextTransfers"
>;

/**
 * When an idle Claude thread should compact, or null. Compacting after its prompt cache
 * expires pays a full uncached read. Personal build: the rule is shared `idleCompactionStatus`,
 * which the thread details card also reads.
 */
export function idleCompactionWindow(
  records: IdleCompactionRecords,
  nowMs: number,
): {
  readonly runId: IdleCompactionRecords["runs"][number]["id"];
  readonly startMs: number;
  readonly endMs: number;
} | null {
  const status = idleCompactionStatus(records, nowMs);
  return status.type === "scheduled"
    ? { runId: status.runId, startMs: status.startMs, endMs: status.cacheEndMs }
    : null;
}
