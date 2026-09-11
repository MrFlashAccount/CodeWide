import { fileMediaKind } from "@codewide/file-types";
import { parseRichMarkdown } from "@codewide/rendering-core";
import type { Nodes } from "mdast";
import { compactTurnArtifactReferences } from "../data/turn-artifacts";

import { privateImageAssetProjection, safeImageUri } from "./image-source";
import { attachmentSourceKey, type UserMessageAttachment } from "./user-message-attachments";

interface MessageArtifacts { readonly text: string; readonly attachments: readonly UserMessageAttachment[] }
const messageArtifacts = new WeakMap<object, MessageArtifacts>();

/** Only explicit outputs and authored links qualify, never paths in tool stdout. */
export function projectAgentArtifacts(turn: unknown): UserMessageAttachment[] {
  const result: UserMessageAttachment[] = [];
  const seen = new Set<string>();
  const push = (attachment: UserMessageAttachment | null): void => {
    if (attachment === null) return;
    const key = attachmentSourceKey(attachment.source);
    if (seen.has(key)) return;
    seen.add(key); result.push(attachment);
  };
  if (!isRecord(turn)) return result;
  for (const reference of compactTurnArtifactReferences(turn)) {
    push("uri" in reference ? linkArtifact(reference.uri, false) : generatedImage(reference));
  }
  const items: unknown[] = Array.isArray(turn.items) ? turn.items : [];
  let text = "";
  let message: Record<string, unknown> | null = null;
  for (const item of items) {
    if (!isRecord(item)) continue;
    if (item.type === "imageGeneration") push(generatedImage(item));
    if (item.type === "agentMessage" && typeof item.text === "string") { text = item.text; message = item; }
  }
  if (message === null || !text.includes("]")) return result;
  const cached = messageArtifacts.get(message);
  if (cached?.text === text) {
    for (const attachment of cached.attachments) push(attachment);
    return result;
  }
  const links: UserMessageAttachment[] = [];
  const appendLink = (attachment: UserMessageAttachment | null): void => {
    if (attachment !== null) { links.push(attachment); push(attachment); }
  };
  const root = parseRichMarkdown(text, turn.status !== "inProgress").root;
  const definitions = new Map<string, string>();
  const collect = (node: Nodes): void => {
    if (node.type === "definition") definitions.set(node.identifier, node.url);
    if ("children" in node) for (const child of node.children) collect(child);
  };
  collect(root);
  const visit = (node: Nodes): void => {
    if (node.type === "link" || node.type === "image") appendLink(linkArtifact(node.url, node.type === "image"));
    if (node.type === "linkReference" || node.type === "imageReference") {
      const url = definitions.get(node.identifier);
      if (url !== undefined) appendLink(linkArtifact(url, node.type === "imageReference"));
    }
    if ("children" in node) for (const child of node.children) visit(child);
  };
  visit(root);
  messageArtifacts.set(message, { text, attachments: links });
  return result;
}

function generatedImage(value: unknown): UserMessageAttachment | null {
  if (!isRecord(value)) return null;
  const path = typeof value.savedPath === "string" && value.savedPath.startsWith("/") && value.savedPath.length <= 4096 && !value.savedPath.includes("\u0000") ? value.savedPath : null;
  // Prefer the stable saved path: content-store ids can rotate after collection.
  if (path !== null) return { kind: "image", name: basename(path), source: { type: "path", path } };
  const asset = privateImageAssetProjection(value.codewideAsset);
  if (asset !== null) return { kind: "image", name: "Generated image", source: { type: "content", asset } };
  const url = safeImageUri(value.result);
  return url === null ? null : { kind: "image", name: "Generated image", source: { type: "url", url } };
}

function linkArtifact(url: string, image: boolean): UserMessageAttachment | null {
  const path = url.startsWith("sandbox:/") ? url.slice("sandbox:".length) : url;
  if (path.startsWith("/") && path.length <= 4096 && !path.includes("\u0000") && !path.includes("#") && !/:\d+(?::\d+)?$/u.test(path)) {
    return { kind: fileMediaKind(path) ?? "file", name: basename(path), source: { type: "path", path } };
  }
  const safe = image ? safeImageUri(url) : null;
  return safe === null ? null : { kind: "image", name: "Image", source: { type: "url", url: safe } };
}

function basename(path: string): string { return path.split("/").at(-1) || "Attachment"; }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
