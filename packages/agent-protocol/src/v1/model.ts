/**
 * Neutral thread, turn, item and runtime-request model of `codewide-agent` v1.
 *
 * Wire rules shared with the Rust mirror (`crates/agent-core/src/model`):
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

import type {
  AppThreadId,
  ClientMessageId,
  ItemId,
  ProviderId,
  ProviderThreadRef,
  TurnId,
} from "./ids";

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
  readonly effort: string | null;
  readonly model: string;
  readonly permissionProfile: string;
  readonly serviceTier: string | null;
}

export interface AgentThread {
  readonly appThreadId: AppThreadId;
  readonly archived: boolean;
  readonly createdAt: number;
  readonly cwd: string;
  readonly name: string | null;
  readonly origin: ThreadOrigin;
  /** Usually the first user message; empty when the thread has none. */
  readonly preview: string;
  readonly provider: ProviderId;
  readonly recencyAt: number | null;
  readonly settings: ThreadSettings;
  readonly status: ThreadStatus;
  readonly updatedAt: number;
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

/**
 * The provider native thread a turn or item came from. With in-thread
 * provider switching an app thread spans several native threads (binding
 * segments); in phase 1 `nativeThreadId` equals the `AppThreadId`.
 * Optional on the wire: absent means "the thread's only native thread".
 */
export interface Provenance {
  readonly nativeThreadId: ProviderThreadRef;
  readonly provider: ProviderId;
}

/** The optional origin carried by every turn and item. */
export interface WithProvenance {
  readonly provenance?: Provenance;
}

export interface AgentTurn extends WithProvenance {
  readonly completedAt: number | null;
  readonly error: TurnError | null;
  readonly items: readonly AgentItem[];
  readonly origin: TurnOrigin;
  readonly startedAt: number;
  readonly status: TurnStatus;
  readonly turnId: TurnId;
  /** Recorded usage of a finished turn on a read (added within v1); absent when unknown. */
  readonly usage?: TurnUsageRecord;
}

/** User input content. */
export type UserContent =
  | { readonly text: string; readonly type: "text" }
  | { readonly type: "image"; readonly url: string }
  | { readonly path: string; readonly type: "localImage" };

/** Status of a tool-like item that executes something on the host. */
export type ExecutionStatus = "inProgress" | "completed" | "failed" | "declined";

/** Status of a call-like item. */
export type CallStatus = "inProgress" | "completed" | "failed";

export type FileChangeKind = "add" | "delete" | "update";

export interface FileChange {
  /** Unified diff (hunks) or raw content for `add`. */
  readonly diff: string;
  readonly kind: FileChangeKind;
  /** Destination path of a rename, otherwise `null`. */
  readonly movePath: string | null;
  readonly path: string;
}

export type WebSearchAction =
  | { readonly query: string; readonly type: "search" }
  | { readonly type: "openPage"; readonly url: string };

export interface McpToolResult {
  readonly content: readonly JsonValue[];
  readonly structuredContent: JsonValue;
}

/** Every item variant, without its optional provenance. */
export type AgentItemBody =
  | {
      readonly clientMessageId: ClientMessageId | null;
      readonly content: readonly UserContent[];
      readonly itemId: ItemId;
      readonly type: "userMessage";
    }
  | {
      readonly itemId: ItemId;
      readonly phase: "commentary" | "final";
      readonly text: string;
      readonly type: "agentMessage";
    }
  | {
      readonly content: readonly string[];
      readonly itemId: ItemId;
      readonly summary: readonly string[];
      readonly type: "reasoning";
    }
  | {
      readonly command: string;
      readonly cwd: string;
      readonly durationMs: number | null;
      readonly exitCode: number | null;
      readonly itemId: ItemId;
      readonly output: string | null;
      readonly status: ExecutionStatus;
      readonly type: "command";
    }
  | {
      readonly changes: readonly FileChange[];
      readonly itemId: ItemId;
      readonly status: ExecutionStatus;
      readonly type: "fileChange";
    }
  | {
      readonly arguments: JsonValue;
      readonly durationMs: number | null;
      readonly error: string | null;
      readonly itemId: ItemId;
      readonly result: McpToolResult | null;
      readonly server: string;
      readonly status: CallStatus;
      readonly tool: string;
      readonly type: "mcpToolCall";
    }
  | {
      readonly arguments: JsonValue;
      readonly durationMs: number | null;
      readonly itemId: ItemId;
      readonly namespace: string | null;
      readonly output: string | null;
      readonly status: CallStatus;
      readonly tool: string;
      readonly type: "toolCall";
    }
  | {
      readonly action: WebSearchAction | null;
      readonly itemId: ItemId;
      readonly query: string;
      readonly type: "webSearch";
    }
  | { readonly itemId: ItemId; readonly path: string; readonly type: "imageView" }
  | { readonly itemId: ItemId; readonly text: string; readonly type: "plan" }
  | { readonly itemId: ItemId; readonly type: "compaction" }
  | {
      readonly capability: string;
      readonly itemId: ItemId;
      readonly kind: string;
      readonly payload: JsonValue;
      readonly type: "capabilityItem";
    };

export type AgentItem = AgentItemBody & WithProvenance;

export type AgentItemType = AgentItem["type"];

/** Decisions a user can take on an approval. */
export type ApprovalDecision = "accept" | "acceptForSession" | "decline" | "cancel";

export interface QuestionOption {
  readonly description: string;
  readonly label: string;
}

export interface UserInputQuestion {
  readonly allowOther: boolean;
  readonly header: string;
  readonly id: string;
  readonly multiSelect: boolean;
  readonly options: readonly QuestionOption[];
  readonly question: string;
  readonly secret: boolean;
}

export type ApprovalKind = "command" | "fileChange" | "tool";

/** A question the provider asks while a turn runs. */
export type RuntimeRequest =
  | {
      readonly command: string | null;
      readonly cwd: string | null;
      readonly decisions: readonly ApprovalDecision[];
      readonly detail: string | null;
      readonly itemId: ItemId;
      readonly kind: ApprovalKind;
      /** Honest one-line description of what is being approved. */
      readonly title: string;
      readonly type: "approval";
    }
  | {
      readonly itemId: ItemId;
      readonly questions: readonly UserInputQuestion[];
      readonly type: "userInput";
    }
  | {
      readonly capability: string;
      readonly payload: JsonValue;
      readonly type: "capabilityRequest";
    };

/** One answer per question id. */
export interface UserInputAnswer {
  readonly answers: readonly string[];
}

/** The user's response to a runtime request. */
export type RuntimeResponse =
  | { readonly decision: ApprovalDecision; readonly type: "approval" }
  | { readonly answers: Readonly<Record<string, UserInputAnswer>>; readonly type: "userInput" }
  | { readonly payload: JsonValue; readonly type: "capability" }
  /** The client failed to answer; providers treat it as a decline, never as an allow. */
  | { readonly message: string; readonly type: "error" };

export type RequestResolution = "responded" | "cancelled" | "turnEnded" | "providerRestarted";

/**
 * Token counters. `inputTokens` counts every prompt token, including the
 * cache reads (`cachedInputTokens`) and cache writes (`cacheWriteInputTokens`)
 * it contains; `outputTokens` includes `reasoningOutputTokens`;
 * `totalTokens = inputTokens + outputTokens`.
 */
export interface TokenUsage {
  readonly cachedInputTokens: number;
  /** Prompt tokens written to the provider's prompt cache. Added within v1; absent means 0. */
  readonly cacheWriteInputTokens?: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
  readonly totalTokens: number;
}

/**
 * Which price table a provider-reported cost used: the provider's built-in
 * list prices or rates managed by the user's organization.
 */
export type ProviderCostBasis = "list" | "managed";

/**
 * A cost the provider itself computed for its own usage (added within v1).
 * It is an estimate, not a bill. A provider sends it only when it knows the
 * price table it used.
 */
export interface ProviderCost {
  readonly basis: ProviderCostBasis;
  /** The priced model, or `"mixed"` when the turn used several priced models. */
  readonly model: string;
  /** The whole thread's cost in USD after this turn; `null` when an earlier turn's cost is unknown. */
  readonly threadUsd: number | null;
  /** This turn's cost in USD. */
  readonly turnUsd: number;
}

/**
 * The usage a provider recorded for one finished turn (added within v1), so
 * a history read shows the same figures `usage.updated` reported live.
 */
export interface TurnUsageRecord {
  readonly contextWindow: number | null;
  /** Absent when the provider does not know the turn's cost. */
  readonly cost?: ProviderCost;
  /** The turn's last model request: the context size the turn ended with. */
  readonly last: TokenUsage;
  /** The thread's cumulative usage after this turn. */
  readonly total: TokenUsage;
  /** This turn's own usage. */
  readonly turn: TokenUsage;
}

/**
 * One session in a provider's own session store (for example, a Claude
 * session file), as the companion's native index sees it. Timestamps are
 * milliseconds, as the field names say.
 */
export interface NativeSession {
  /** The thread the session belongs to: its own id, or the thread a replacement session continues. */
  readonly appThreadId: AppThreadId;
  /** CodeWide metadata of that thread; absent for a session CodeWide never touched. */
  readonly codewide?: NativeSessionCodewide;
  readonly createdAtMs: number | null;
  readonly cwd: string | null;
  /** Byte size of the stored session file, when the store knows it; with `lastModifiedMs` a cheap change detector. */
  readonly fileSize: number | null;
  readonly firstPrompt: string | null;
  /** Started by a person (terminal, IDE) rather than programmatically. */
  readonly interactive: boolean;
  /** Modification time of the stored session file (ms, floor of its mtime). */
  readonly lastModifiedMs: number;
  readonly sessionId: string;
  /** The store's display summary (title, generated summary or first prompt). */
  readonly summary: string;
  readonly title: string | null;
}

/** How the host shows a title Claude's store cannot hold. */
export type NativeTitleOverride =
  /** Claude's own session title is the thread name. */
  | { readonly type: "none" }
  /** Named before the session existed; the provider applies it to its store once it can. */
  | { readonly name: string; readonly type: "pending" }
  /** The name was cleared; a store title equal to `hiddenTitle` is not shown. */
  | { readonly hiddenTitle: string; readonly type: "cleared" };

/** Whether the thread is listed (and archived) or deleted (tombstone). */
export type NativeThreadPresence =
  | { readonly archived: boolean; readonly type: "listed" }
  | { readonly deletedAt: number; readonly type: "deleted" };

/**
 * The CodeWide metadata of the thread a native session belongs to: every
 * `thread.list` row field the provider's store cannot hold. Timestamps are
 * unix seconds.
 */
export interface NativeSessionCodewide {
  /** Creation time of the thread as CodeWide knows it. */
  readonly createdAt: number;
  /** The CodeWide thread's working directory (where its turns run). */
  readonly cwd: string;
  /** `interactive` for a thread CodeWide created, `external` for a session it found. */
  readonly origin: "external" | "interactive";
  readonly presence: NativeThreadPresence;
  readonly recencyAt: number | null;
  /** Effective settings of the next turn (pending settings when set). */
  readonly settings: ThreadSettings;
  readonly title: NativeTitleOverride;
  /** Last activity CodeWide itself caused. */
  readonly updatedAt: number;
}

/** The turns of one sub-agent of a native session. */
export interface NativeSubagent {
  readonly agentId: string;
  /** The parent sub-agent, or `null` for a sub-agent the main conversation spawned. */
  readonly parentAgentId: string | null;
  /** The tool call that spawned the sub-agent, when the store records it. */
  readonly parentToolUseId: string | null;
  readonly turns: readonly AgentTurn[];
}

/**
 * A tool the companion declares for a thread's model to call (client-side
 * tool). The provider registers it natively and, whenever the model calls it,
 * sends the `tool.call` provider request to the companion and returns the
 * result to the model. `inputSchema` is a JSON Schema object for the
 * arguments (`{"type": "object", ...}`).
 */
export interface ClientToolSpec {
  readonly description: string;
  readonly inputSchema: JsonValue;
  readonly name: string;
}

/** One content block of a client tool result. */
export interface ClientToolTextContent {
  readonly text: string;
  readonly type: "text";
}

export type PlanStepStatus = "pending" | "inProgress" | "completed";

export interface PlanStep {
  readonly status: PlanStepStatus;
  readonly step: string;
}
