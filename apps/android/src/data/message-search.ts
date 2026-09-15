import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { parseHistoryTurns } from "./thread-cursor-sync";

export interface MessageSearchQuery {
  readonly query: string;
  readonly project: string | null;
  readonly threadId: string | null;
  readonly from: string | null;
  readonly until: string | null;
  readonly offset: number;
}

export interface MessageSearchHit {
  readonly messageId: number;
  readonly threadId: string;
  readonly turnId: string;
  readonly title: string;
  readonly project: string;
  readonly timestamp: string;
  readonly sourceOffset: number;
  readonly kind: "user_message" | "agent_message" | "thread";
  readonly excerpt: string;
}

export interface MessageSearchPage {
  readonly data: readonly MessageSearchHit[];
  readonly nextOffset: number | null;
  readonly indexing: boolean;
  readonly failedSources: number;
}

/** Validates the remote search surface before results can reach navigation. */
export function parseMessageSearchPage(value: unknown): MessageSearchPage {
  const page = record(value);
  if (!Array.isArray(page.data) || typeof page.indexing !== "boolean")
    throw new Error("Invalid search response");
  return {
    data: page.data.map(parseHit),
    nextOffset: nullableInteger(page.nextOffset),
    indexing: page.indexing,
    failedSources: integer(page.failedSources),
  };
}

function parseHit(value: unknown): MessageSearchHit {
  const hit = record(value);
  if (hit.kind !== "user_message" && hit.kind !== "agent_message" && hit.kind !== "thread")
    throw new Error("Invalid search result kind");
  return {
    messageId: integer(hit.messageId),
    threadId: string(hit.threadId),
    turnId: string(hit.turnId),
    title: string(hit.title),
    project: string(hit.project),
    timestamp: string(hit.timestamp),
    sourceOffset: integer(hit.sourceOffset),
    kind: hit.kind,
    excerpt: string(hit.excerpt),
  };
}

export interface SearchContextQuery {
  readonly threadId: string;
  readonly messageId: number;
  readonly direction: "around" | "older" | "newer";
}

interface SearchContextMessage {
  readonly messageId: number;
  readonly turnId: string;
  readonly sourceOffset: number;
  readonly timestamp: string;
  readonly kind: "user_message" | "agent_message";
  readonly text: string;
}

export interface SearchContextPage {
  readonly messages: readonly SearchContextMessage[];
  readonly older: number | null;
  readonly newer: number | null;
}

export interface SearchConversationPage extends SearchContextPage {
  readonly turns: readonly Turn[];
}

/** Search history uses canonical turn presentation, without replacing live state. */
export function parseSearchConversationPage(value: unknown): SearchConversationPage {
  const page = record(value);
  const turns = parseHistoryTurns(page.turns);
  if (turns === null) throw new Error("Invalid search conversation turns");
  return { ...parseSearchContext(value), turns };
}

export function parseSearchContext(value: unknown): SearchContextPage {
  const page = record(value);
  if (!Array.isArray(page.messages)) throw new Error("Invalid search context");
  return {
    messages: page.messages.map(parseContextMessage),
    older: nullableInteger(page.older),
    newer: nullableInteger(page.newer),
  };
}

function parseContextMessage(value: unknown): SearchContextMessage {
  const message = record(value);
  if (message.kind !== "user_message" && message.kind !== "agent_message")
    throw new Error("Invalid context message kind");
  return {
    messageId: integer(message.messageId),
    turnId: string(message.turnId),
    sourceOffset: integer(message.sourceOffset),
    timestamp: string(message.timestamp),
    kind: message.kind,
    text: string(message.text),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid search object");
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid search text");
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid search position");
  return value;
}
function nullableInteger(value: unknown): number | null {
  return value === null ? null : integer(value);
}

/** Inclusive date-picker days become an exclusive next-day boundary in local time. */
export function searchDateBoundary(value: string, end: boolean): string | null {
  if (value.trim() === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) throw new Error("Use YYYY-MM-DD for dates");
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime()) || date.getDate() !== Number(value.slice(-2)))
    throw new Error("Invalid date");
  if (end) date.setDate(date.getDate() + 1);
  return date.toISOString();
}
