import type { RpcClient } from "@codewide/sync-client";
import { unknownRecord } from "./unknownRecord";

const STATUSES = [
  "running",
  "completed",
  "failed",
  "killed",
  "stopped",
  "lost",
  "unknown",
] as const;

/** One page of a background task's output, as the Companion read it now. */
export type BackgroundTaskOutputPage = {
  /** The byte offset of the next page, or `null` at the end of the output so far. */
  readonly nextOffset: number | null;
  readonly sizeBytes: number;
  readonly status: (typeof STATUSES)[number];
  readonly taskId: string;
  readonly text: string;
};

/** Reads one page of a background task's output, starting at byte `offset`. */
export async function readBackgroundTaskOutput(
  session: RpcClient,
  request: { readonly offset: number; readonly taskId: string; readonly threadId: string },
): Promise<BackgroundTaskOutputPage> {
  const response = await session.rpc<unknown>("companion/thread/backgroundTask/read", {
    offset: request.offset,
    taskId: request.taskId,
    threadId: request.threadId,
  });
  const page = parsePage(unknownRecord(response));
  if (page === null) {
    throw new Error("The Companion sent an unreadable background task output");
  }
  return page;
}

function parsePage(raw: Record<string, unknown> | null): BackgroundTaskOutputPage | null {
  const status = STATUSES.find((candidate) => candidate === raw?.status);
  if (
    raw === null ||
    typeof raw.taskId !== "string" ||
    typeof raw.text !== "string" ||
    !isByteCount(raw.sizeBytes) ||
    !(raw.nextOffset === null || isByteCount(raw.nextOffset)) ||
    status === undefined
  ) {
    return null;
  }
  return {
    nextOffset: raw.nextOffset,
    sizeBytes: raw.sizeBytes,
    status,
    taskId: raw.taskId,
    text: raw.text,
  };
}

function isByteCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
