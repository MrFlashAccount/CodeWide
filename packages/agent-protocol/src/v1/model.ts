/**
 * Neutral thread, turn, item and runtime-request model of `codewide-agent` v1.
 *
 * Wire rules shared with the Rust mirror (`crates/companion-core/src/agent/model`):
 * - every field is always present; "absent" is encoded as `null`;
 * - unions carry a literal `type` discriminator;
 * - timestamps are unix seconds unless the field name says otherwise.
 *
 * Ordering rules every provider keeps for one turn:
 * 1. `turn.started` precedes any item of that turn;
 * 2. a `userMessage` is the first item of a `user`-origin turn;
 * 3. every started item is completed before `turn.completed`;
 * 4. at most one `agentMessage` with phase `final` per turn;
 * 5. `item.completed` carries the full item content.
 */

import type { AppThreadId, ClientMessageId, ItemId, ProviderId, TurnId } from "./ids";

/** JSON value carried opaquely by the protocol. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type ThreadStatus = "idle" | "active" | "notLoaded" | "failed";

/** How the thread came to exist: from a CodeWide client, another client, or the global supervisor. */
export type ThreadOrigin = "interactive" | "external" | "supervisor";

/** Settings applied to the next turns of a thread. */
export interface ThreadSettings {
  readonly model: string;
  readonly effort: string | null;
  readonly permissionProfile: string;
  readonly serviceTier: string | null;
}

export interface AgentThread {
  readonly appThreadId: AppThreadId;
  readonly provider: ProviderId;
  readonly cwd: string;
  readonly name: string | null;
  /** Usually the first user message; empty when the thread has none. */
  readonly preview: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly recencyAt: number | null;
  readonly archived: boolean;
  readonly origin: ThreadOrigin;
  readonly status: ThreadStatus;
  readonly settings: ThreadSettings;
}

export type TurnStatus = "inProgress" | "completed" | "interrupted" | "failed";

/** `provider`: a turn the provider started by itself (a wake turn); it has no `userMessage`. */
export type TurnOrigin = "user" | "provider";

export type TurnErrorKind =
  | "provider"
  | "authentication"
  | "processExited"
  | "sessionLost"
  | "usageLimit"
  | "unknown";

export interface TurnError {
  readonly kind: TurnErrorKind;
  /** User-facing text. */
  readonly message: string;
}

export interface AgentTurn {
  readonly turnId: TurnId;
  readonly status: TurnStatus;
  readonly origin: TurnOrigin;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly error: TurnError | null;
  readonly items: readonly AgentItem[];
}

/** User input content. */
export type UserContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly url: string }
  | { readonly type: "localImage"; readonly path: string };

/** Status of a tool-like item that executes something on the host. */
export type ExecutionStatus = "inProgress" | "completed" | "failed" | "declined";

/** Status of a call-like item. */
export type CallStatus = "inProgress" | "completed" | "failed";

export type FileChangeKind = "add" | "delete" | "update";

export interface FileChange {
  readonly path: string;
  readonly kind: FileChangeKind;
  /** Destination path of a rename, otherwise `null`. */
  readonly movePath: string | null;
  /** Unified diff (hunks) or raw content for `add`. */
  readonly diff: string;
}

export type WebSearchAction =
  | { readonly type: "search"; readonly query: string }
  | { readonly type: "openPage"; readonly url: string };

export interface McpToolResult {
  readonly content: readonly JsonValue[];
  readonly structuredContent: JsonValue;
}

export type AgentItem =
  | {
      readonly type: "userMessage";
      readonly itemId: ItemId;
      readonly clientMessageId: ClientMessageId | null;
      readonly content: readonly UserContent[];
    }
  | {
      readonly type: "agentMessage";
      readonly itemId: ItemId;
      readonly text: string;
      readonly phase: "commentary" | "final";
    }
  | {
      readonly type: "reasoning";
      readonly itemId: ItemId;
      readonly summary: readonly string[];
      readonly content: readonly string[];
    }
  | {
      readonly type: "command";
      readonly itemId: ItemId;
      readonly command: string;
      readonly cwd: string;
      readonly status: ExecutionStatus;
      readonly output: string | null;
      readonly exitCode: number | null;
      readonly durationMs: number | null;
    }
  | {
      readonly type: "fileChange";
      readonly itemId: ItemId;
      readonly changes: readonly FileChange[];
      readonly status: ExecutionStatus;
    }
  | {
      readonly type: "mcpToolCall";
      readonly itemId: ItemId;
      readonly server: string;
      readonly tool: string;
      readonly arguments: JsonValue;
      readonly status: CallStatus;
      readonly result: McpToolResult | null;
      readonly error: string | null;
      readonly durationMs: number | null;
    }
  | {
      readonly type: "toolCall";
      readonly itemId: ItemId;
      readonly namespace: string | null;
      readonly tool: string;
      readonly arguments: JsonValue;
      readonly output: string | null;
      readonly status: CallStatus;
      readonly durationMs: number | null;
    }
  | {
      readonly type: "webSearch";
      readonly itemId: ItemId;
      readonly query: string;
      readonly action: WebSearchAction | null;
    }
  | { readonly type: "imageView"; readonly itemId: ItemId; readonly path: string }
  | { readonly type: "plan"; readonly itemId: ItemId; readonly text: string }
  | { readonly type: "compaction"; readonly itemId: ItemId }
  | {
      readonly type: "capabilityItem";
      readonly itemId: ItemId;
      readonly capability: string;
      readonly kind: string;
      readonly payload: JsonValue;
    };

export type AgentItemType = AgentItem["type"];

/** Decisions a user can take on an approval. */
export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface QuestionOption {
  readonly label: string;
  readonly description: string;
}

export interface UserInputQuestion {
  readonly id: string;
  readonly header: string;
  readonly question: string;
  readonly options: readonly QuestionOption[];
  readonly multiSelect: boolean;
  readonly secret: boolean;
  readonly allowOther: boolean;
}

export type ApprovalKind = "command" | "fileChange" | "tool";

/** A question the provider asks while a turn runs. */
export type RuntimeRequest =
  | {
      readonly type: "approval";
      readonly kind: ApprovalKind;
      readonly itemId: ItemId;
      /** Honest one-line description of what is being approved. */
      readonly title: string;
      readonly detail: string | null;
      readonly command: string | null;
      readonly cwd: string | null;
      readonly decisions: readonly ApprovalDecision[];
    }
  | {
      readonly type: "userInput";
      readonly itemId: ItemId;
      readonly questions: readonly UserInputQuestion[];
    }
  | {
      readonly type: "capabilityRequest";
      readonly capability: string;
      readonly payload: JsonValue;
    };

/** One answer per question id. */
export interface UserInputAnswer {
  readonly answers: readonly string[];
}

/** The user's response to a runtime request. */
export type RuntimeResponse =
  | { readonly type: "approval"; readonly decision: ApprovalDecision }
  | { readonly type: "userInput"; readonly answers: { readonly [questionId: string]: UserInputAnswer } }
  | { readonly type: "capability"; readonly payload: JsonValue }
  /** The client failed to answer; providers treat it as a decline, never as an allow. */
  | { readonly type: "error"; readonly message: string };

export type RequestResolution = "responded" | "cancelled" | "turnEnded" | "providerRestarted";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

export type PlanStepStatus = "pending" | "inProgress" | "completed";

export interface PlanStep {
  readonly step: string;
  readonly status: PlanStepStatus;
}
