import type { Turn, ThreadItem } from "@codewide/codex-protocol/v0.155.1/v2";
import { checkAborted } from "../native/check-aborted";
import { parseTerminalCommand, type TerminalCommandSnapshot } from "./terminalOutputEvents";
import { parseThreadTurnsListPage } from "./thread-turns-list-page";

const MAX_HISTORY_PAGES = 128;
const HISTORY_PAGE_TURNS = 2;

/** Reads a finished command from canonical history, without changing the chat's resident window. */
export async function readTerminalCommand(
  call: (method: string, params: unknown) => Promise<unknown>,
  request: { readonly itemId: string; readonly signal: AbortSignal; readonly threadId: string },
): Promise<TerminalCommandSnapshot | null> {
  let cursor: string | null = null;
  const seen = new Set<string>();
  for (let pageIndex = 0; pageIndex < MAX_HISTORY_PAGES; pageIndex += 1) {
    checkAborted(request.signal);
    const page = parseThreadTurnsListPage(
      await call("thread/turns/list", {
        cursor,
        itemsView: "full",
        limit: HISTORY_PAGE_TURNS,
        sortDirection: "desc",
        threadId: request.threadId,
      }),
      cursor,
    );
    checkAborted(request.signal);
    const item = findItem(page.turns, request.itemId);
    if (item !== undefined) {
      return parseTerminalCommand(item);
    }
    if (page.nextCursor === null) {
      return null;
    }
    if (seen.has(page.nextCursor)) {
      throw new Error("Server returned a repeated history cursor");
    }
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error("Command output was not found in recent history");
}

function findItem(turns: readonly Turn[], itemId: string): ThreadItem | undefined {
  for (const turn of turns) {
    const item = turn.items.find((candidate) => candidate.id === itemId);
    if (item !== undefined) {
      return item;
    }
  }
  return undefined;
}
