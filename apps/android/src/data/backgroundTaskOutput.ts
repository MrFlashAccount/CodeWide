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

/** The output a dialog shows: everything read so far, or its tail when long. */
export type BackgroundTaskOutput = {
  /** Whether the beginning of the output is not shown, because it is long. */
  readonly headOmitted: boolean;
  /** The byte offset the next read starts at. */
  readonly nextOffset: number;
  readonly sizeBytes: number;
  readonly status: BackgroundTaskOutputPage["status"];
  readonly text: string;
  /**
   * Characters read in total, including those no longer kept: what was read
   * since an earlier step is the end of `text` this count grew by.
   */
  readonly totalChars: number;
};

/** How a dialog follows one task's output. */
type FollowOptions = {
  /** How often a running task's new output is read. */
  readonly pollMs: number;
  /** The most output kept; a longer output shows its newest part. */
  readonly residentBytes: number;
};

const FOLLOW_POLL_MS = 2000;
const FOLLOW_RESIDENT_BYTES = 262_144;

const BACKGROUND_TASK_FOLLOW: FollowOptions = {
  pollMs: FOLLOW_POLL_MS,
  residentBytes: FOLLOW_RESIDENT_BYTES,
};

type ReadOutputPage = (taskId: string, offset: number) => Promise<BackgroundTaskOutputPage>;

/** What following one task's output reads from and reports to. */
export type FollowRequest = {
  readonly first: BackgroundTaskOutputPage;
  readonly options?: FollowOptions;
  readonly publish: (output: BackgroundTaskOutput) => void;
  readonly read: ReadOutputPage;
  readonly signal: AbortSignal;
};

/**
 * Reads a task's whole output without being asked page by page, starting
 * from its `first` page: the remaining pages follow at once, a long output
 * starts at its last `residentBytes`, and a running task's new output is read
 * every `pollMs` until it ends or `signal` aborts. Each step is published.
 */
export async function followBackgroundTaskOutput({
  first,
  options = BACKGROUND_TASK_FOLLOW,
  publish,
  read,
  signal,
}: FollowRequest): Promise<BackgroundTaskOutput> {
  const long = first.nextOffset !== null && first.sizeBytes > options.residentBytes;
  let output: BackgroundTaskOutput = long
    ? {
        headOmitted: true,
        nextOffset: first.sizeBytes - options.residentBytes,
        sizeBytes: first.sizeBytes,
        status: first.status,
        text: "",
        totalChars: 0,
      }
    : withPage(emptyOutput(first), first, options.residentBytes);
  let more = long || first.nextOffset !== null;
  publish(output);
  while (more || output.status === "running") {
    if (!more) {
      await pause(options.pollMs, signal);
    }
    throwIfAborted(signal);
    const page = await read(first.taskId, output.nextOffset);
    throwIfAborted(signal);
    output = withPage(output, page, options.residentBytes);
    more = page.nextOffset !== null;
    publish(output);
  }
  return output;
}

function emptyOutput(first: BackgroundTaskOutputPage): BackgroundTaskOutput {
  return {
    headOmitted: false,
    nextOffset: 0,
    sizeBytes: first.sizeBytes,
    status: first.status,
    text: "",
    totalChars: 0,
  };
}

/** The output with `page` appended; the oldest text goes past `residentBytes`. */
function withPage(
  output: BackgroundTaskOutput,
  page: BackgroundTaskOutputPage,
  residentBytes: number,
): BackgroundTaskOutput {
  const text = output.text + page.text;
  // One UTF-16 unit stands for at least one byte, so this bounds the bytes kept.
  const overflow = text.length - residentBytes;
  const firstLine = overflow > 0 ? text.indexOf("\n", overflow) : -1;
  const kept = overflow > 0 ? text.slice(firstLine < 0 ? overflow : firstLine + 1) : text;
  return {
    headOmitted: output.headOmitted || overflow > 0,
    nextOffset: page.nextOffset ?? page.sizeBytes,
    sizeBytes: page.sizeBytes,
    status: page.status,
    text: kept,
    totalChars: output.totalChars + page.text.length,
  };
}

async function pause(ms: number, signal: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** The error an aborted read ends with; resource owners ignore it by name. */
function abortError(): Error {
  const error = new Error("The output reading was cancelled");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw abortError();
  }
}
