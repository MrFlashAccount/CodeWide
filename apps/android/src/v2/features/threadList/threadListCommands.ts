import type { V2Command } from "@codewide/sync-client/v2";

import type { QualifiedThread } from "../../domain/qualifiedThread";

export function threadArchiveCommand(owner: QualifiedThread, archived: boolean): V2Command {
  return {
    change: { archived, kind: "archive" },
    kind: "thread.update",
    threadId: owner.threadId,
  };
}

export function threadMarkReadCommand(
  owner: QualifiedThread,
  throughActivityMarker: string,
): V2Command {
  return {
    kind: "thread.markRead",
    threadId: owner.threadId,
    throughActivityMarker,
  };
}
