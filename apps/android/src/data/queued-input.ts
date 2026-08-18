import type { RemoteFileAttachment } from "@codewide/sync-client";

export type QueuedInput = {
  text: string;
  attachments: RemoteFileAttachment[];
};

export function parseQueuedInput(params: Record<string, unknown>): QueuedInput {
  if (!Array.isArray(params.input)) return { text: "", attachments: [] };
  let text = "";
  const attachments: RemoteFileAttachment[] = [];
  for (const raw of params.input) {
    const item = asRecord(raw);
    if (item?.type === "text" && typeof item.text === "string" && text === "") {
      text = item.text;
      continue;
    }
    if (
      item?.type !== "remoteFile"
      || typeof item.rootId !== "string"
      || typeof item.path !== "string"
      || typeof item.name !== "string"
      || (item.kind !== "image" && item.kind !== "audio" && item.kind !== "file")
    ) continue;
    attachments.push({
      id: `${item.rootId}\u0000${item.path}`,
      rootId: item.rootId,
      path: item.path,
      name: item.name,
      kind: item.kind,
    });
  }
  return { text, attachments };
}

export function queuedInputPayload(text: string, attachments: readonly RemoteFileAttachment[]): unknown[] {
  return [
    ...(text.length === 0 ? [] : [{ type: "text", text, text_elements: [] }]),
    ...attachments.map(({ rootId, path, name, kind }) => ({
      type: "remoteFile",
      rootId,
      path,
      name,
      kind,
    })),
  ];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
