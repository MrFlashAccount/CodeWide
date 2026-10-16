import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { unknownRecord } from "./unknownRecord";
import type { ThreadWriteOwnership } from "./thread-cursor-sync";

/** Reads Companion's project-private writer ownership from a materialized thread. */
export function threadWriteOwnership(thread: Thread | null | undefined): ThreadWriteOwnership {
  if (thread === null || thread === undefined) {
    return "owned";
  }
  return unknownRecord(thread)?.codewideWriteOwnership === "external" ? "external" : "owned";
}
