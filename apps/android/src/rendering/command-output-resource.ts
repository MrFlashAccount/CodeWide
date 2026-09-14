import type { CommandOutputReference } from "@codewide/sync-client";

import { readPrivateAssetText, type GetTransferAccess, type PrivateAssetTextResult } from "../data/private-transfer";
import { getAsyncResource } from "./async-resource-store";
import { checkAborted } from "../native/check-aborted";

export const COMMAND_OUTPUT_PAGE_BYTES = 64 * 1024;

export interface CommandOutputRequest {
  readonly scope: string;
  readonly references: readonly CommandOutputReference[];
  readonly byteLimit: number;
  readonly getTransferAccess: GetTransferAccess;
}

export interface CommandOutputPage {
  readonly text: string;
  readonly hasMore: boolean;
}

/** Output beyond the requested prefix must not invalidate the visible page. */
export function commandOutputRevision(references: readonly CommandOutputReference[], byteLimit: number): string {
  let bytes = 0;
  let revision = `${byteLimit}`;
  for (const reference of references) {
    if (bytes < byteLimit) revision += `:${reference.id}`;
    bytes += reference.byteLength;
  }
  return `${revision}:${bytes > byteLimit}`;
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
      const limit = Math.min(COMMAND_OUTPUT_PAGE_BYTES, reference.byteLength - offset, request.byteLimit - bytes);
      const chunk = getAsyncResource<PrivateAssetTextResult>(
        `command-content:${request.scope}:${reference.id}:${chunkOffset}:${limit}`,
        0,
        async (_publish, chunkSignal) => await readPrivateAssetText(
          { kind: "content", id: reference.id }, request.getTransferAccess,
          { offset: chunkOffset, limit, accept: reference.contentType, signal: chunkSignal },
        ),
        (value) => value.text.length * 2,
        false,
      );
      const release = chunk.retain();
      try {
        const loaded = await chunk.read();
        checkAborted(signal);
        if (loaded.nextOffset <= offset) throw new Error("Command output returned an invalid range");
        text += loaded.text;
        bytes += loaded.nextOffset - offset;
        offset = loaded.nextOffset;
      } finally {
        release();
      }
    }
    if (bytes >= request.byteLimit) break;
  }
  return { text, hasMore: bytes < total };
}
