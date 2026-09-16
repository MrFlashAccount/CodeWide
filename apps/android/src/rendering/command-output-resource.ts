import type { CommandOutputReference } from "@codewide/sync-client";

import {
  readPrivateAssetText,
  type GetTransferAccess,
  type PrivateAssetTextResult,
} from "../data/private-transfer";
import { getAsyncResource } from "./async-resource-store";
import { checkAborted } from "../native/check-aborted";

export const COMMAND_OUTPUT_PAGE_BYTES = 64 * 1024;

export interface CommandOutputRequest {
  readonly byteLimit: number;
  readonly getTransferAccess: GetTransferAccess;
  readonly references: readonly CommandOutputReference[];
  readonly scope: string;
}

export interface CommandOutputPage {
  readonly hasMore: boolean;
  readonly text: string;
}

/** Output beyond the requested prefix must not invalidate the visible page. */
export function commandOutputRevision(
  references: readonly CommandOutputReference[],
  byteLimit: number,
): string {
  let bytes = 0;
  let revision = `${byteLimit}`;
  for (const reference of references) {
    if (bytes < byteLimit) {
      revision += `:${reference.id}`;
    }
    bytes += reference.byteLength;
  }
  return `${revision}:${String(bytes > byteLimit)}`;
}

/** Reads a bounded prefix on expansion. Immutable chunks reuse the resource
 * cache across live updates, collapse/reopen, and repeated identical output. */
export async function readCommandOutput(
  request: CommandOutputRequest,
  signal: AbortSignal,
): Promise<CommandOutputPage> {
  let text = "";
  let bytes = 0;
  const total = request.references.reduce((sum, reference) => sum + reference.byteLength, 0);
  for (const reference of request.references) {
    let offset = 0;
    while (offset < reference.byteLength && bytes < request.byteLimit) {
      checkAborted(signal);
      const chunkOffset = offset;
      const limit = Math.min(
        COMMAND_OUTPUT_PAGE_BYTES,
        reference.byteLength - offset,
        request.byteLimit - bytes,
      );
      const chunk = getAsyncResource<PrivateAssetTextResult>(
        `command-content:${request.scope}:${reference.id}:${String(chunkOffset)}:${String(limit)}`,
        0,
        async (_publish, chunkSignal) =>
          readPrivateAssetText({ id: reference.id, kind: "content" }, request.getTransferAccess, {
            accept: reference.contentType,
            limit,
            offset: chunkOffset,
            signal: chunkSignal,
          }),
        (value) => value.text.length * 2,
        false,
      );
      const release = chunk.retain();
      try {
        const loaded = await chunk.read();
        checkAborted(signal);
        if (loaded.nextOffset <= offset) {
          throw new Error("Command output returned an invalid range");
        }
        text += loaded.text;
        bytes += loaded.nextOffset - offset;
        offset = loaded.nextOffset;
      } finally {
        release();
      }
    }
    if (bytes >= request.byteLimit) {
      break;
    }
  }
  return { hasMore: bytes < total, text };
}
