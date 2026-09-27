import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";

import type { GlobalSupervisorQualifiedChatRef } from "./globalSupervisorBinding";
import { projectGlobalSupervisorSafeText } from "./globalSupervisorSafeText";
import { unknownRecord } from "./unknownRecord";

const attachmentListMaxEntries = Number("32");
const attachmentNameMaxCharacters = Number("160");
const attachmentSourceMaxCharacters = Number("8192");
const attachmentTextPageMaxBytes = Number("65536");
const attachmentTextTotalMaxBytes = Number("196608");
const attachmentIdHexCharacters = Number("32");
const technicalIdMaxCharacters = Number("256");

export const globalSupervisorAttachmentLimits = {
  listMaxEntries: attachmentListMaxEntries,
  textPageMaxBytes: attachmentTextPageMaxBytes,
  textTotalMaxBytes: attachmentTextTotalMaxBytes,
} as const;

export function isGlobalSupervisorAttachmentId(value: unknown): value is string {
  return typeof value === "string" && /^attachment-v1-[a-f0-9]{32}$/u.test(value);
}

type GlobalSupervisorChatAttachment = {
  readonly attachmentId: string;
  readonly itemId: string;
  readonly kind: "audio" | "file" | "image";
  readonly name: string;
  readonly origin: "agent" | "user";
  readonly textReadable: boolean;
  readonly turnId: string;
};

export type GlobalSupervisorChatAttachmentList = {
  readonly items: readonly GlobalSupervisorChatAttachment[];
  readonly target: GlobalSupervisorQualifiedChatRef;
  readonly truncated: boolean;
};

export type GlobalSupervisorChatAttachmentText = {
  readonly attachmentId: string;
  readonly contentType: string | null;
  readonly limitReached: boolean;
  readonly name: string;
  readonly nextOffset: number | null;
  readonly offset: number;
  readonly target: GlobalSupervisorQualifiedChatRef;
  readonly text: string;
  readonly totalBytes: number | null;
  readonly truncated: boolean;
};

export type GlobalSupervisorAttachmentTextReader = (request: {
  readonly connectionId: string;
  readonly limit: number;
  readonly offset: number;
  readonly path: string;
}) => Promise<{
  readonly contentType: string | null;
  readonly nextOffset: number;
  readonly text: string;
  readonly totalBytes: number | null;
  readonly truncated: boolean;
}>;

type ResolvedChatAttachment = GlobalSupervisorChatAttachment & {
  readonly path: string | null;
};

function boundedTechnicalId(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > technicalIdMaxCharacters) {
    throw new Error(`The chat attachment ${label} is invalid`);
  }
  return value;
}

function attachmentKind(value: unknown): GlobalSupervisorChatAttachment["kind"] {
  if (value === "audio" || value === "file" || value === "image") {
    return value;
  }
  throw new Error("The chat attachment kind is invalid");
}

function attachmentOrigin(value: unknown): GlobalSupervisorChatAttachment["origin"] {
  if (value === "agent" || value === "user") {
    return value;
  }
  throw new Error("The chat attachment origin is invalid");
}

function boundedSource(value: unknown, label: string): string | null {
  if (value === null) {
    return null;
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > attachmentSourceMaxCharacters ||
    value.includes("\0")
  ) {
    throw new Error(`The chat attachment ${label} is invalid`);
  }
  return value;
}

function attachmentName(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("The chat attachment name is invalid");
  }
  const projected = projectGlobalSupervisorSafeText(value, attachmentNameMaxCharacters);
  return projected === "" ? "Attachment" : projected;
}

function opaqueAttachmentId(input: {
  readonly itemId: string;
  readonly key: string;
  readonly target: GlobalSupervisorQualifiedChatRef;
  readonly turnId: string;
}): string {
  const { itemId, key, target, turnId } = input;
  const digest = bytesToHex(
    sha256(
      utf8ToBytes(JSON.stringify([target.connectionId, target.threadId, turnId, itemId, key])),
    ),
  );
  return `attachment-v1-${digest.slice(0, attachmentIdHexCharacters)}`;
}

function parseAttachment(
  value: unknown,
  target: GlobalSupervisorQualifiedChatRef,
): ResolvedChatAttachment {
  const item = unknownRecord(value);
  if (item === null) {
    throw new Error("The chat attachment is invalid");
  }
  const key = boundedSource(item.key, "identity");
  if (key === null) {
    throw new Error("The chat attachment identity is invalid");
  }
  const kind = attachmentKind(item.kind);
  const path = boundedSource(item.path, "path");
  boundedSource(item.url, "URL");
  const turnId = boundedTechnicalId(item.turnId, "turn identity");
  const itemId = boundedTechnicalId(item.itemId, "item identity");
  return {
    attachmentId: opaqueAttachmentId({ itemId, key, target, turnId }),
    itemId,
    kind,
    name: attachmentName(item.name),
    origin: attachmentOrigin(item.origin),
    path,
    textReadable: kind === "file" && path !== null && path.startsWith("/"),
    turnId,
  };
}

function latestAttachments(
  value: unknown,
  target: GlobalSupervisorQualifiedChatRef,
): { readonly attachments: readonly ResolvedChatAttachment[]; readonly truncated: boolean } {
  const response = unknownRecord(value);
  if (
    response === null ||
    response.threadId !== target.threadId ||
    typeof response.revision !== "string" ||
    !Array.isArray(response.attachments)
  ) {
    throw new Error("The chat attachment response is invalid");
  }
  const start = Math.max(0, response.attachments.length - attachmentListMaxEntries);
  const attachments: ResolvedChatAttachment[] = [];
  for (let index = start; index < response.attachments.length; index += 1) {
    attachments.push(parseAttachment(response.attachments[index], target));
  }
  return {
    attachments,
    truncated: start > 0,
  };
}

function publicAttachment(attachment: ResolvedChatAttachment): GlobalSupervisorChatAttachment {
  return {
    attachmentId: attachment.attachmentId,
    itemId: attachment.itemId,
    kind: attachment.kind,
    name: attachment.name,
    origin: attachment.origin,
    textReadable: attachment.textReadable,
    turnId: attachment.turnId,
  };
}

/** Projects the latest bounded attachment index without host paths or remote URLs. */
export function projectGlobalSupervisorChatAttachments(
  value: unknown,
  target: GlobalSupervisorQualifiedChatRef,
): GlobalSupervisorChatAttachmentList {
  const projected = latestAttachments(value, target);
  return {
    items: projected.attachments.map(publicAttachment),
    target,
    truncated: projected.truncated,
  };
}

/** Resolves only an opaque id from the same authoritative qualified-thread attachment index. */
export function resolveGlobalSupervisorChatAttachment(
  value: unknown,
  target: GlobalSupervisorQualifiedChatRef,
  attachmentId: string,
): ResolvedChatAttachment | null {
  if (!isGlobalSupervisorAttachmentId(attachmentId)) {
    return null;
  }
  for (const attachment of latestAttachments(value, target).attachments) {
    if (attachment.attachmentId === attachmentId) {
      return attachment;
    }
  }
  return null;
}

function readableAttachmentPath(attachment: ResolvedChatAttachment): string {
  if (!attachment.textReadable || attachment.path === null) {
    throw new Error("The selected chat attachment is not readable text");
  }
  return attachment.path;
}

function attachmentReadLimit(offset: number): number {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= attachmentTextTotalMaxBytes) {
    throw new Error("The chat attachment offset is invalid");
  }
  return Math.min(attachmentTextTotalMaxBytes - offset, attachmentTextPageMaxBytes);
}

function attachmentNextOffset(page: {
  readonly nextOffset: number;
  readonly truncated: boolean;
}): number | null {
  return page.truncated && page.nextOffset < attachmentTextTotalMaxBytes ? page.nextOffset : null;
}

/** Reads one bounded text page and prevents cumulative reads beyond the control-plane ceiling. */
export async function readGlobalSupervisorChatAttachmentText(options: {
  readonly attachment: ResolvedChatAttachment;
  readonly offset: number;
  readonly readText: GlobalSupervisorAttachmentTextReader;
  readonly target: GlobalSupervisorQualifiedChatRef;
}): Promise<GlobalSupervisorChatAttachmentText> {
  const { attachment, offset, readText, target } = options;
  const path = readableAttachmentPath(attachment);
  const page = await readText({
    connectionId: target.connectionId,
    limit: attachmentReadLimit(offset),
    offset,
    path,
  });
  const nextOffset = attachmentNextOffset(page);
  return {
    attachmentId: attachment.attachmentId,
    contentType: page.contentType,
    limitReached: page.truncated && nextOffset === null,
    name: attachment.name,
    nextOffset,
    offset,
    target,
    text: page.text,
    totalBytes: page.totalBytes,
    truncated: page.truncated,
  };
}
