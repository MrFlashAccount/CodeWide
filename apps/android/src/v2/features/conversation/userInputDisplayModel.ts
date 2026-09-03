import type { V2Attachment, V2Item, V2UserMessageBlock } from "@codewide/sync-client/v2";

import type {
  TimelineActivityAttachment,
  TimelineDisplayUserBlock,
} from "../../presentation/conversation/timelineTypes";
import { attachmentForReference } from "../attachments/attachmentReference";
import { normalizeUserMessage } from "./userMessageNormalizer";

/** Projects authoritative user blocks without exposing transport-only text envelopes. */
export function userInputDisplayModel(
  items: V2Item[],
  attachments: readonly V2Attachment[],
): TimelineDisplayUserBlock[] {
  const result: TimelineDisplayUserBlock[] = [];
  const seenReferences = new Set<string>();
  for (const item of items) {
    if (item.kind !== "userMessage") continue;
    for (const block of item.content) {
      if (block.kind === "text") {
        appendNormalizedTextBlock(result, block, attachments, seenReferences);
        continue;
      }
      const display = userBlockDisplayModel(block, attachments);
      const reference = userBlockReference(display);
      if (reference !== null && seenReferences.has(reference)) continue;
      if (reference !== null) seenReferences.add(reference);
      result.push(display);
    }
  }
  return result;
}

function appendNormalizedTextBlock(
  result: TimelineDisplayUserBlock[],
  block: Extract<V2UserMessageBlock, { kind: "text" }>,
  attachments: readonly V2Attachment[],
  seenReferences: Set<string>,
): void {
  const normalized = normalizeUserMessage(block.text);
  if (normalized.text !== "") {
    result.push({
      kind: "text",
      text: normalized.text,
      textElements: normalized.text === block.text ? block.textElements : [],
    });
  }
  for (const file of normalized.files) {
    if (seenReferences.has(file.path)) continue;
    seenReferences.add(file.path);
    result.push({
      attachment: displayAttachment(attachmentForReference(attachments, file.path)),
      kind: "mention",
      name: file.name,
      path: file.path,
      reference: file.path,
    });
  }
}

function userBlockDisplayModel(
  block: Exclude<V2UserMessageBlock, { kind: "text" }>,
  attachments: readonly V2Attachment[],
): TimelineDisplayUserBlock {
  switch (block.kind) {
    case "image":
      return {
        attachment: displayAttachment(attachmentForReference(attachments, block.url)),
        detail: block.detail,
        kind: "image",
        reference: block.url,
      };
    case "localImage":
      return {
        attachment: displayAttachment(attachmentForReference(attachments, block.path)),
        detail: block.detail,
        kind: "localImage",
        reference: block.path,
      };
    case "audio":
      return {
        attachment: displayAttachment(attachmentForReference(attachments, block.url)),
        kind: "audio",
        reference: block.url,
      };
    case "localAudio":
      return {
        attachment: displayAttachment(attachmentForReference(attachments, block.path)),
        kind: "localAudio",
        reference: block.path,
      };
    case "skill":
      return { kind: "skill", name: block.name, path: block.path };
    case "mention":
      return {
        attachment: displayAttachment(
          structuredMention(block.path) ? null : attachmentForReference(attachments, block.path),
        ),
        kind: "mention",
        name: block.name,
        path: block.path,
        reference: block.path,
      };
    default:
      return unreachableUserBlock(block);
  }
}

function userBlockReference(block: TimelineDisplayUserBlock): string | null {
  switch (block.kind) {
    case "text":
    case "skill":
      return null;
    case "image":
    case "localImage":
    case "audio":
    case "localAudio":
    case "mention":
      return block.reference;
    default:
      return unreachableDisplayBlock(block);
  }
}

function structuredMention(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(path);
}

function displayAttachment(attachment: V2Attachment | null): TimelineActivityAttachment | null {
  if (attachment === null) return null;
  return {
    downloadUrl: attachment.downloadUrl,
    id: attachment.id,
    mediaType: attachment.mediaType,
    name: attachment.name,
    sizeBytes: attachment.sizeBytes,
  };
}

function unreachableUserBlock(value: never): never {
  throw new Error(`Unsupported user message block: ${String(value)}`);
}

function unreachableDisplayBlock(value: never): never {
  throw new Error(`Unsupported user display block: ${String(value)}`);
}
