import { unknownRecord } from "./unknownRecord";
import type { RemoteFileAttachment } from "@codewide/sync-client";

export type QueuedInput = {
  attachments: RemoteFileAttachment[];
  text: string;
};

export function parseQueuedInput(params: Record<string, unknown>): QueuedInput {
  if (!Array.isArray(params.input)) {
    return { attachments: [], text: "" };
  }
  let text = "";
  const attachments: RemoteFileAttachment[] = [];
  for (const raw of params.input) {
    const item = asRecord(raw);
    if (item?.type === "text" && typeof item.text === "string" && text === "") {
      text = item.text;
      continue;
    }
    if (
      item?.type !== "remoteFile" ||
      typeof item.rootId !== "string" ||
      typeof item.path !== "string" ||
      typeof item.name !== "string" ||
      (item.kind !== "image" && item.kind !== "audio" && item.kind !== "file")
    ) {
      continue;
    }
    attachments.push({
      id: `${item.rootId}\u0000${item.path}`,
      kind: item.kind,
      name: item.name,
      path: item.path,
      rootId: item.rootId,
    });
  }
  return { attachments, text };
}

export function queuedInputPayload(
  text: string,
  attachments: readonly RemoteFileAttachment[],
): unknown[] {
  return [
    ...(text.length === 0 ? [] : [{ text, text_elements: [], type: "text" }]),
    ...attachments.map(({ kind, name, path, rootId }) => ({
      kind,
      name,
      path,
      rootId,
      type: "remoteFile",
    })),
  ];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return unknownRecord(value);
}
