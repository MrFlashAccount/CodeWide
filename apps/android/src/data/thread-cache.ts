import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";

import { normalizeUserMessage } from "../rendering/user-message-normalizer";

export const MAX_CACHED_THREAD_TURNS = 6;
// This payload is parsed on the React Native JS thread when a conversation is
// opened. Multi-megabyte rows make a tap look frozen on real Android devices.
// Keep the recent window small enough for an interactive cold-cache read.
export const MAX_CACHED_THREAD_JSON_CHARS = 750_000;

export function latestThreadMessagePreview(thread: Thread): string | null {
  for (let turnIndex = thread.turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = thread.turns[turnIndex];
    if (turn === undefined) continue;
    // Recovery/history can expose a metadata-only turn even though the
    // generated protocol type requires `items`. Summary projection is a
    // Conversation-derived view, so an incomplete envelope contributes no
    // preview text and must not broaden the runtime protocol contract.
    const items = Array.isArray((turn as unknown as { items?: unknown }).items) ? turn.items : [];
    if (turn.status !== "inProgress") {
      for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const item = items[itemIndex];
        if (item?.type !== "agentMessage" || item.phase !== "final_answer") continue;
        const text = compactPreview(item.text);
        if (text !== "") return text;
      }
    }
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex];
      if (item?.type === "agentMessage") {
        if (turn.status === "inProgress" && item.phase === "final_answer") continue;
        const text = compactPreview(item.text);
        if (text !== "") return text;
      }
      if (item?.type === "userMessage") {
        const authored = item.content
          .filter((part) => part.type === "text")
          .map((part) => normalizeUserMessage(part.text).text)
          .join(" ");
        const text = compactPreview(authored);
        if (text !== "") return text;
        if (item.content.some((part) => part.type === "image" || part.type === "localImage")) return "Photo";
        if (item.content.some((part) => part.type === "audio" || part.type === "localAudio")) return "Audio";
        if (item.content.some((part) => part.type === "skill")) return "Skill";
      }
    }
  }
  return null;
}

export function plainThreadPreview(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, (_match, alt: string) => alt.trim() === "" ? "Photo" : alt)
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s*|[-+*]\s+|\d+[.)]\s+)/gmu, "")
    .replace(/```[^\n]*\n?|```/gu, " ")
    .replace(/[*_~`]+/gu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}

const compactPreview = plainThreadPreview;

export function serializeThreadForCache(thread: Thread): string {
  const emptyRaw = JSON.stringify({ ...thread, turns: [] });
  if (emptyRaw.length > MAX_CACHED_THREAD_JSON_CHARS) return emptyRaw;

  const selected: Thread["turns"] = [];
  let selectedChars = 0;
  const recent = thread.turns.slice(-MAX_CACHED_THREAD_TURNS);
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const turn = recent[index];
    if (turn === undefined) continue;
    const turnChars = JSON.stringify(turn).length;
    const commaChars = selected.length === 0 ? 0 : 1;
    if (emptyRaw.length + selectedChars + commaChars + turnChars > MAX_CACHED_THREAD_JSON_CHARS) break;
    selected.unshift(turn);
    selectedChars += commaChars + turnChars;
  }
  return selected.length === 0 ? emptyRaw : JSON.stringify({ ...thread, turns: selected });
}
