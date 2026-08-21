import type { RemoteFileAttachment } from "@codewide/sync-client";

import { privateImageAssetProjection, safeImageUri, userImageSourceProjection, type PrivateImageAssetProjection } from "./image-source";
import { normalizeUserMessage } from "./user-message-normalizer";

export type UserMessageAttachmentSource =
  | { type: "path"; path: string }
  | { type: "content"; asset: PrivateImageAssetProjection }
  | { type: "url"; url: string }
  | { type: "scoped"; rootId: string; path: string };

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
    if (attachment === null) return;
    const key = attachmentSourceKey(attachment.source);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(attachment);
  };

  for (const attachment of parseProjectedAttachments(codewideAttachments)) push(attachment);
  for (const raw of content) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const part = raw as Record<string, unknown>;
    const image = userImageSourceProjection(part);
    if (image !== null) {
      const source: UserMessageAttachmentSource = image.kind === "content"
        ? { type: "content", asset: image.asset }
        : image.kind === "path"
          ? { type: "path", path: image.path }
          : { type: "url", url: image.uri };
      push({ kind: "image", name: image.kind === "path" ? basename(image.path) : `Image ${result.length + 1}`, source });
      continue;
    }
    if (part.type === "localAudio" && typeof part.path === "string" && part.path.length > 0) {
      push({ kind: "audio", name: basename(part.path), source: { type: "path", path: part.path } });
      continue;
    }
    if (part.type === "mention" && typeof part.path === "string" && part.path.length > 0) {
      push({
        kind: "file",
        name: typeof part.name === "string" && part.name.length > 0 ? part.name : basename(part.path),
        source: { type: "path", path: part.path },
      });
      continue;
    }
    if (part.type === "text" && typeof part.text === "string") {
      for (const file of normalizeUserMessage(part.text).files) {
        push({ kind: "file", name: file.name, source: { type: "path", path: file.path } });
      }
    }
  }
  for (const attachment of localAttachments) {
    push({
      kind: attachment.kind,
      name: attachment.name,
      source: { type: "scoped", rootId: attachment.rootId, path: attachment.path },
    });
  }
  return result;
}

function parseProjectedAttachments(value: unknown): UserMessageAttachment[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const projection = value as Record<string, unknown>;
  if (projection.version !== 1 || !Array.isArray(projection.items)) return [];
  return projection.items.flatMap((raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
    const item = raw as Record<string, unknown>;
    if (item.kind !== "image" && item.kind !== "audio" && item.kind !== "file") return [];
    if (typeof item.name !== "string" || item.name.length === 0) return [];
    const source = parseProjectedSource(item.source);
    return source === null ? [] : [{ kind: item.kind, name: item.name, source }];
  });
}

function parseProjectedSource(value: unknown): UserMessageAttachmentSource | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.type === "path" && typeof source.path === "string" && source.path.startsWith("/") && !source.path.includes("\0")) {
    return { type: "path", path: source.path };
  }
  if (source.type === "content") {
    const asset = privateImageAssetProjection(source.asset);
    return asset === null ? null : { type: "content", asset };
  }
  if (source.type === "url") {
    const url = safeImageUri(source.url);
    return url === null ? null : { type: "url", url };
  }
  return null;
}

function attachmentSourceKey(source: UserMessageAttachmentSource): string {
  if (source.type === "path") return `path:${source.path}`;
  if (source.type === "content") return `content:${source.asset.id}`;
  if (source.type === "url") return `url:${source.url}`;
  return `scoped:${source.rootId}:${source.path}`;
}

function basename(path: string): string {
  const normalized = path.replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).at(-1) ?? "Attachment";
}
