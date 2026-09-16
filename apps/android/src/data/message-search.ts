import type { Turn } from "@codewide/codex-protocol/v0.147.0/v2";
import { parseHistoryTurns } from "./thread-cursor-sync";

export interface MessageSearchQuery {
  readonly from: string | null;
  readonly offset: number;
  readonly project: string | null;
  readonly query: string;
  readonly threadId: string | null;
  readonly until: string | null;
}

export interface MessageSearchHit {
  readonly excerpt: string;
  readonly kind: "user_message" | "agent_message" | "thread";
  readonly messageId: number;
  readonly project: string;
  readonly sourceOffset: number;
  readonly threadId: string;
  readonly timestamp: string;
  readonly title: string;
  readonly turnId: string;
}

export interface MessageSearchPage {
  readonly data: readonly MessageSearchHit[];
  readonly failedSources: number;
  readonly indexing: boolean;
  readonly nextOffset: number | null;
}

/** Validates the remote search surface before results can reach navigation. */
export function parseMessageSearchPage(value: unknown): MessageSearchPage {
  const page = record(value);
  if (!Array.isArray(page.data) || typeof page.indexing !== "boolean") {
    throw new Error("Invalid search response");
  }
  return {
    data: page.data.map(parseHit),
    failedSources: integer(page.failedSources),
    indexing: page.indexing,
    nextOffset: nullableInteger(page.nextOffset),
  };
}

function parseHit(value: unknown): MessageSearchHit {
  const hit = record(value);
  if (hit.kind !== "user_message" && hit.kind !== "agent_message" && hit.kind !== "thread") {
    throw new Error("Invalid search result kind");
  }
  return {
    excerpt: string(hit.excerpt),
    kind: hit.kind,
    messageId: integer(hit.messageId),
    project: string(hit.project),
    sourceOffset: integer(hit.sourceOffset),
    threadId: string(hit.threadId),
    timestamp: string(hit.timestamp),
    title: string(hit.title),
    turnId: string(hit.turnId),
  };
}

export interface SearchContextQuery {
  readonly direction: "around" | "older" | "newer";
  readonly messageId: number;
  readonly threadId: string;
}

interface SearchContextMessage {
  readonly kind: "user_message" | "agent_message";
  readonly messageId: number;
  readonly sourceOffset: number;
  readonly text: string;
  readonly timestamp: string;
  readonly turnId: string;
}

export interface SearchContextPage {
  readonly messages: readonly SearchContextMessage[];
  readonly newer: number | null;
  readonly older: number | null;
}

export interface SearchConversationPage extends SearchContextPage {
  readonly turns: readonly Turn[];
}

/** Search history uses canonical turn presentation, without replacing live state. */
export function parseSearchConversationPage(value: unknown): SearchConversationPage {
  const page = record(value);
  const turns = parseHistoryTurns(page.turns);
  if (turns === null) {
    throw new Error("Invalid search conversation turns");
  }
  return { ...parseSearchContext(value), turns };
}

export function parseSearchContext(value: unknown): SearchContextPage {
  const page = record(value);
  if (!Array.isArray(page.messages)) {
    throw new Error("Invalid search context");
  }
  return {
    messages: page.messages.map(parseContextMessage),
    newer: nullableInteger(page.newer),
    older: nullableInteger(page.older),
  };
}

function parseContextMessage(value: unknown): SearchContextMessage {
  const message = record(value);
  if (message.kind !== "user_message" && message.kind !== "agent_message") {
    throw new Error("Invalid context message kind");
  }
  return {
    kind: message.kind,
    messageId: integer(message.messageId),
    sourceOffset: integer(message.sourceOffset),
    text: string(message.text),
    timestamp: string(message.timestamp),
    turnId: string(message.turnId),
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Invalid search object");
  }
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function string(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Invalid search text");
  }
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Invalid search position");
  }
  return value;
}
function nullableInteger(value: unknown): number | null {
  return value === null ? null : integer(value);
}

/** Inclusive date-picker days become an exclusive next-day boundary in local time. */
export function searchDateBoundary(value: string, end: boolean): string | null {
  if (value.trim() === "") {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error("Use YYYY-MM-DD for dates");
  }
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime()) || date.getDate() !== Number(value.slice(-2))) {
    throw new Error("Invalid date");
  }
  if (end) {
    date.setDate(date.getDate() + 1);
  }
  return date.toISOString();
}
