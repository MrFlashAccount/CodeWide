import type { TerminalCommandSnapshot } from "../../../data/terminalOutputEvents";
import { checkAborted } from "../../../native/check-aborted";
import type { TerminalOutputRequest } from "../../../services/content/terminalOutputRequest";

const MAX_MISSING_READS = 3;

/** Repairs a missed completion, allowing history to settle after the process leaves the list. */
export function terminalCompletionReader(
  request: TerminalOutputRequest,
  signal: AbortSignal,
): () => Promise<TerminalCommandSnapshot | null> {
  let missingReads = 0;
  return async () => {
    const running = await request.isRunning();
    checkAborted(signal);
    if (running) {
      missingReads = 0;
      return null;
    }
    const completed = await request.read(request.itemId, signal);
    checkAborted(signal);
    if (completed !== null) {
      return completed;
    }
    missingReads += 1;
    if (missingReads >= MAX_MISSING_READS) {
      throw new Error(
        "The process is no longer running, but its output is not available in history. Retry to read it again.",
      );
    }
    return null;
  };
}
