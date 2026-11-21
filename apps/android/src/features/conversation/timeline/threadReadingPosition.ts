import { createContext, useContext } from "react";
import type { ThreadUiStateDatabase } from "../../../data/thread-ui-state-database-contract";
import type { ThreadUiStateRead } from "../../../data/use-thread-ui-state";
import { useConversationState } from "../../../ui/use-conversation-scope";
import type { TimelineRow } from "./timelineRows";

type Bookmark = { readonly rowKey: string | null; readonly top: number; readonly turnId: string };
type ThreadOpening =
  | { readonly kind: "pending" }
  | { readonly kind: "tail" }
  | { readonly bookmark: Bookmark; readonly kind: "saved" }
  | { readonly kind: "unread"; readonly turnId: string };

/** Selects the SQLite history window before the list is mounted. */
export function openingTurnId(opening: ThreadOpening): string | null {
  if (opening.kind === "saved") {
    return opening.bookmark.turnId;
  }
  return opening.kind === "unread" ? opening.turnId : null;
}

const PENDING = { kind: "pending" } as const;
const TAIL = { kind: "tail" } as const;

/** Selects once per activation. Writes while reading cannot retarget the open list. */
export function useThreadOpening(input: {
  scope: string;
  summaryReady: boolean;
  ui: ThreadUiStateRead;
  unreadId: string | null;
}): ThreadOpening {
  const [opening, setOpening] = useConversationState<ThreadOpening>(input.scope, () =>
    selectOpening(input),
  );
  if (opening.kind !== "pending") {
    return opening;
  }
  const next = selectOpening(input);
  if (next.kind !== "pending") {
    setOpening(next);
  }
  return next;
}

function selectOpening(input: {
  summaryReady: boolean;
  ui: ThreadUiStateRead;
  unreadId: string | null;
}): ThreadOpening {
  if (input.ui.status !== "ready") {
    return PENDING;
  }
  const row = input.ui.value;
  if (typeof row.historyAnchorTurnId === "string" && row.historyAnchorTurnId !== "") {
    return {
      bookmark: {
        rowKey: row.historyAnchorRowKey ?? null,
        top: row.historyAnchorOffsetPx ?? 0,
        turnId: row.historyAnchorTurnId,
      },
      kind: "saved",
    };
  }
  if (!input.summaryReady) {
    return PENDING;
  }
  return input.unreadId === null ? TAIL : { kind: "unread", turnId: input.unreadId };
}

/** Owns the last user-chosen reading point for one mounted main conversation. */
export class ThreadReadingSession {
  private bookmark: Bookmark | null | undefined;
  private gestureStarted = false;

  get hasReturnedToEnd(): boolean {
    return this.bookmark === null;
  }

  beginGesture(): void {
    this.gestureStarted = true;
  }
  get tracking(): boolean {
    return this.gestureStarted;
  }

  readonly connectionId: string;
  readonly threadId: string;
  private readonly database: Pick<ThreadUiStateDatabase, "saveScrollOffset">;

  constructor(
    connectionId: string,
    threadId: string,
    database: Pick<ThreadUiStateDatabase, "saveScrollOffset">,
  ) {
    this.connectionId = connectionId;
    this.threadId = threadId;
    this.database = database;
  }

  capture(row: TimelineRow, top: number): void {
    if (row.item.kind === "turn") {
      this.bookmark = { rowKey: row.key, top, turnId: row.item.id };
    }
  }

  atEnd(): void {
    this.bookmark = null;
  }

  readonly save = async (
    connectionId: string,
    threadId: string,
    distance: number,
  ): Promise<void> => {
    const mark = this.bookmark;
    if (connectionId !== this.connectionId || threadId !== this.threadId || mark === undefined) {
      return;
    }
    await this.database.saveScrollOffset(
      connectionId,
      threadId,
      distance,
      mark === null ? null : mark.turnId,
      mark === null ? null : mark.top,
      mark === null ? null : mark.rowKey,
    );
  };
}

type ReadingPosition = {
  readonly opening: ThreadOpening;
  readonly session: ThreadReadingSession;
};

/** Reading intent and gesture cursor for the active main conversation. */
export const ReadingPositionContext = createContext<ReadingPosition | null>(null);

/** Nested read-only conversations never inherit their parent's reading cursor. */
export function useThreadReadingPosition(
  connectionId: string | null,
  threadId: string | null,
): ReadingPosition | null {
  const position = useContext(ReadingPositionContext);
  return position?.session.connectionId === connectionId && position.session.threadId === threadId
    ? position
    : null;
}

/** Resolves durable row identity against the current, possibly repacked transcript. */
export function savedReadingIndex(
  rows: readonly TimelineRow[],
  mark: Bookmark,
): { index: number; viewOffset: number; viewPosition: 0 } | undefined {
  const exact = rows.findIndex(
    (row) => row.key === mark.rowKey && row.item.kind === "turn" && row.item.id === mark.turnId,
  );
  const index =
    exact >= 0
      ? exact
      : rows.findIndex(
          (row) =>
            row.kind !== "historyBeginning" &&
            row.item.kind === "turn" &&
            row.item.id === mark.turnId,
        );
  return index < 0
    ? undefined
    : { index, viewOffset: exact >= 0 || mark.rowKey === null ? mark.top : 0, viewPosition: 0 };
}
