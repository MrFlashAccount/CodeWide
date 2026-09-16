import type { RemoteFileAttachment } from "@codewide/sync-client";
import { fileMediaKind } from "@codewide/file-types";
import { unknownRecord } from "../data/unknownRecord";

import {
  privateImageAssetProjection,
  safeImageUri,
  userImageSourceProjection,
  type PrivateImageAssetProjection,
} from "./image-source";
import { normalizeUserMessage } from "./user-message-normalizer";

export type UserMessageAttachmentSource =
  | { path: string; type: "path" }
  | { asset: PrivateImageAssetProjection; type: "content" }
  | { type: "url"; url: string }
  | { path: string; rootId: string; type: "scoped" };

export type UserMessageAttachment = {
  kind: "image" | "audio" | "file";
  name: string;
  source: UserMessageAttachmentSource;
};

/**
 * Reconstructs user attachments from the authoritative Codex userMessage.
 * `codewideAttachments` is a bounded companion projection of that same
 * session content; raw content remains a compatibility fallback for sessions
 * written before the projection existed. Local outbox attachments participate
 * only while the authoritative item has not arrived.
 */
export function projectUserMessageAttachments(
  content: readonly unknown[],
  codewideAttachments?: unknown,
  localAttachments: readonly RemoteFileAttachment[] = [],
): UserMessageAttachment[] {
  const result: UserMessageAttachment[] = [];
  const seen = new Set<string>();
  const push = (attachment: UserMessageAttachment | null): void => {
    if (attachment === null) {
      return;
    }
    const key = attachmentSourceKey(attachment.source);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(attachment);
  };

  for (const attachment of parseProjectedAttachments(codewideAttachments)) {
    push(attachment);
  }
  for (const raw of content) {
    const part = unknownRecord(raw);
    if (part === null) {
      continue;
    }
    const image = userImageSourceProjection(part);
    if (image !== null) {
      const source: UserMessageAttachmentSource =
        image.kind === "content"
          ? { asset: image.asset, type: "content" }
          : image.kind === "path"
            ? { path: image.path, type: "path" }
            : { type: "url", url: image.uri };
      push({
        kind: "image",
        name: image.kind === "path" ? basename(image.path) : `Image ${String(result.length + 1)}`,
        source,
      });
      continue;
    }
    if (part.type === "localAudio" && typeof part.path === "string" && part.path.length > 0) {
      push({ kind: "audio", name: basename(part.path), source: { path: part.path, type: "path" } });
      continue;
    }
    if (part.type === "mention" && typeof part.path === "string" && part.path.length > 0) {
      push({
        kind: fileMediaKind(part.path) ?? "file",
        name:
          typeof part.name === "string" && part.name.length > 0 ? part.name : basename(part.path),
        source: { path: part.path, type: "path" },
      });
      continue;
    }
    if (part.type === "text" && typeof part.text === "string") {
      for (const file of normalizeUserMessage(part.text).files) {
        push({
          kind: fileMediaKind(file.name) ?? "file",
          name: file.name,
          source: { path: file.path, type: "path" },
        });
      }
    }
  }
  for (const attachment of localAttachments) {
    push({
      kind: attachment.kind,
      name: attachment.name,
      source: { path: attachment.path, rootId: attachment.rootId, type: "scoped" },
    });
  }
  return result;
}

function parseProjectedAttachments(value: unknown): UserMessageAttachment[] {
  const projection = unknownRecord(value);
  if (projection === null) {
    return [];
  }
  if (projection.version !== 1 || !Array.isArray(projection.items)) {
    return [];
  }
  return projection.items.flatMap((raw) => {
    const item = unknownRecord(raw);
    if (item === null) {
      return [];
    }
    if (item.kind !== "image" && item.kind !== "audio" && item.kind !== "file") {
      return [];
    }
    if (typeof item.name !== "string" || item.name.length === 0) {
      return [];
    }
    const source = parseProjectedSource(item.source);
    return source === null ? [] : [{ kind: item.kind, name: item.name, source }];
  });
}

function parseProjectedSource(value: unknown): UserMessageAttachmentSource | null {
  const source = unknownRecord(value);
  if (source === null) {
    return null;
  }
  if (
    source.type === "path" &&
    typeof source.path === "string" &&
    source.path.startsWith("/") &&
    !source.path.includes("\0")
  ) {
    return { path: source.path, type: "path" };
  }
  if (source.type === "content") {
    const asset = privateImageAssetProjection(source.asset);
    return asset === null ? null : { asset, type: "content" };
  }
  if (source.type === "url") {
    const url = safeImageUri(source.url);
    return url === null ? null : { type: "url", url };
  }
  return null;
}

export function attachmentSourceKey(source: UserMessageAttachmentSource): string {
  if (source.type === "path") {
    return `path:${source.path}`;
  }
  if (source.type === "content") {
    return `content:${source.asset.id}`;
  }
  if (source.type === "url") {
    return `url:${source.url}`;
  }
  return `scoped:${source.rootId}:${source.path}`;
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? "Attachment";
}
