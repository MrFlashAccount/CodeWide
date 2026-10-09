/**
 * Operations the companion invokes on a provider.
 *
 * `OperationMap` is the single source of the method names, their params and
 * their results. Repeat semantics (idempotency) are part of each operation's
 * contract and are documented on its params type.
 */

import type { CapabilitySet } from "./capabilities";
import type { AppThreadId, ClientMessageId, NativeRequestId, ProviderId, TurnId } from "./ids";
import type {
  AgentThread,
  AgentTurn,
  ClientToolSpec,
  ClientToolTextContent,
  JsonValue,
  NativeSession,
  NativeSubagent,
  RuntimeResponse,
  ThreadSettings,
  UserContent,
} from "./model";

export const PROTOCOL_NAME = "codewide-agent" as const;
export const PROTOCOL_VERSION = 1 as const;

export interface InitializeParams {
  readonly client: { readonly name: string; readonly version: string };
  readonly protocol: typeof PROTOCOL_NAME;
  readonly protocolVersion: number;
}

export interface ProviderDescriptor {
  /** Human-readable name, e.g. "Claude". */
  readonly displayName: string;
  readonly id: ProviderId;
  /** `Thread.modelProvider` value on the client wire, e.g. "anthropic". */
  readonly modelProvider: string;
  readonly version: string;
}

/** Signed-in state reported by the provider runtime. Never carries credentials. */
export interface ProviderAccount {
  readonly authenticated: boolean;
  /** Opaque display label such as a plan name; never an email or token. */
  readonly label: string | null;
}

export interface InitializeResult {
  readonly account: ProviderAccount | null;
  readonly capabilities: CapabilitySet;
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly provider: ProviderDescriptor;
}

export interface ModelEffort {
  readonly description: string;
  readonly effort: string;
}

export interface ModelEntry {
  readonly defaultEffort: string | null;
  readonly description: string;
  readonly displayName: string;
  readonly efforts: readonly ModelEffort[];
  readonly hidden: boolean;
  readonly id: string;
  readonly inputModalities: readonly ("text" | "image")[];
  readonly isDefault: boolean;
  readonly model: string;
}

export interface PermissionProfileEntry {
  readonly description: string;
  readonly displayName: string;
  readonly id: string;
}

/** Inclusive/exclusive bounds of a sort-key window, unix seconds. */
export interface SortWindow {
  readonly lower: number | null;
  readonly lowerInclusive: boolean;
  readonly upper: number | null;
  readonly upperInclusive: boolean;
}

export type ThreadSortKey = "createdAt" | "updatedAt" | "recencyAt";
export type SortDirection = "asc" | "desc";
export type ItemsView = "notLoaded" | "summary" | "full";

/**
 * Lists threads. Threads without a user message are excluded unless
 * `archived` is true. `recencyAt` falls back to `updatedAt` when null.
 * Cursor format is provider-internal and opaque to the companion.
 */
export interface ThreadListParams {
  readonly archived: boolean;
  readonly cursor: string | null;
  readonly cwd: string | null;
  readonly limit: number;
  readonly searchTerm: string | null;
  readonly sortDirection: SortDirection;
  readonly sortKey: ThreadSortKey;
  // WHY: `window` is the wire field name shared with the Rust mirror; react-doctor
  // mistakes this type-only property for a read of the browser global.
  // oxlint-disable-next-line react-doctor/no-unguarded-browser-global-at-module-scope
  readonly window: SortWindow | null;
}

export type ThreadChange =
  | { readonly name: string | null; readonly type: "name" }
  | { readonly archived: boolean; readonly type: "archived" }
  | { readonly type: "deleted" }
  | {
      readonly effort: string | null;
      readonly model: string | null;
      readonly permissionProfile: string | null;
      readonly serviceTier: string | null;
      readonly type: "settings";
    };

/**
 * The optional client tools of `thread.create` and `turn.start`. Absent:
 * the thread keeps its current set. Present: replaces the set (an empty
 * array removes every client tool). The set is live state of the provider
 * process, not persisted thread metadata: the companion sends it with every
 * `turn.start` of a thread that should have the tools. A provider without
 * client-tool support ignores the field.
 */
export interface ClientToolsParam {
  readonly clientTools?: readonly ClientToolSpec[];
}

export type TurnStartResult =
  | { readonly turnId: TurnId; readonly type: "started" }
  | { readonly activeTurnId: TurnId; readonly type: "busy" };

export interface OperationMap {
  readonly "capability.invoke": {
    readonly params: {
      readonly capability: string;
      readonly method: string;
      readonly params: JsonValue;
    };
    readonly result: { readonly result: JsonValue };
  };
  readonly "catalog.models": {
    readonly params: Record<string, never>;
    readonly result: { readonly models: readonly ModelEntry[] };
  };
  readonly "catalog.permissionProfiles": {
    readonly params: Record<string, never>;
    readonly result: { readonly profiles: readonly PermissionProfileEntry[] };
  };
  readonly initialize: { readonly params: InitializeParams; readonly result: InitializeResult };
  /**
   * Optional. Pages the provider's own session store, newest first, for the
   * companion's native index: every session, programmatic and interactive.
   * `dir` narrows to one project directory; the cursor is opaque. A provider
   * without a native store answers `-32601`.
   */
  readonly "nativeSession.list": {
    readonly params: {
      readonly cursor: string | null;
      readonly dir: string | null;
      readonly limit: number;
    };
    readonly result: {
      readonly nextCursor: string | null;
      readonly sessions: readonly NativeSession[];
    };
  };
  /**
   * Optional. Reads one native session as neutral turns and the turns of its
   * sub-agents. Turn and item ids are derived only from the stored messages
   * and the provider's own metadata, so the same stored input reads as the
   * same ids (re-indexing is idempotent). A turn still running in a live
   * session is returned as its live snapshot (`inProgress`). Unknown session:
   * `-32600 "native session not found: <id>"`.
   */
  readonly "nativeSession.read": {
    readonly params: { readonly sessionId: string };
    readonly result: {
      readonly session: NativeSession;
      readonly subagents: readonly NativeSubagent[];
      readonly turns: readonly AgentTurn[];
    };
  };
  readonly "request.respond": {
    readonly params: {
      readonly appThreadId: AppThreadId;
      readonly requestId: NativeRequestId;
      readonly response: RuntimeResponse;
    };
    readonly result: Record<string, never>;
  };
  readonly "thread.compact": {
    readonly params: { readonly appThreadId: AppThreadId };
    readonly result: Record<string, never>;
  };
  /**
   * Creates a thread. `appThreadId` is host-minted for providers that declare
   * `threads.hostMintedIds`, otherwise `null` and the provider mints it.
   * Repeating with the same host-minted id returns the existing thread.
   * `clientTools` (optional, see `ClientToolsParam`) sets the thread's client
   * tools.
   */
  readonly "thread.create": {
    readonly params: ClientToolsParam & {
      readonly appThreadId: AppThreadId | null;
      readonly cwd: string;
      readonly settings: ThreadSettings;
    };
    readonly result: { readonly thread: AgentThread };
  };
  readonly "thread.list": {
    readonly params: ThreadListParams;
    readonly result: {
      readonly nextCursor: string | null;
      readonly threads: readonly AgentThread[];
    };
  };
  readonly "thread.owns": {
    readonly params: { readonly appThreadId: AppThreadId };
    readonly result: { readonly owned: boolean };
  };
  /** Idempotent. Unknown id: `-32600 "thread not found: <id>"`. */
  readonly "thread.read": {
    readonly params: { readonly appThreadId: AppThreadId };
    readonly result: { readonly activeTurnId: TurnId | null; readonly thread: AgentThread };
  };
  /** Idempotent. Cursor is the last returned turn id; pages are strictly after it. */
  readonly "thread.turns": {
    readonly params: {
      readonly appThreadId: AppThreadId;
      readonly cursor: string | null;
      readonly itemsView: ItemsView;
      readonly limit: number;
      readonly sortDirection: SortDirection;
    };
    readonly result: { readonly nextCursor: string | null; readonly turns: readonly AgentTurn[] };
  };
  /**
   * Repeats answer `{thread}` (or `{thread: null}` after delete, by tombstone)
   * without a second `thread.updated` when nothing changed.
   */
  readonly "thread.update": {
    readonly params: { readonly appThreadId: AppThreadId; readonly change: ThreadChange };
    readonly result: { readonly thread: AgentThread | null };
  };
  /**
   * Answers `{}` at once when the turn is active, already interrupted,
   * completed, or the thread is idle. Errors only for a foreign `turnId`
   * during an active turn or an unknown thread.
   */
  readonly "turn.interrupt": {
    readonly params: { readonly appThreadId: AppThreadId; readonly turnId: TurnId | null };
    readonly result: Record<string, never>;
  };
  /**
   * Never steers: an active thread answers `busy` (or joins natively for
   * `nativeJoin`). `clientTools` (optional, see `ClientToolsParam`) replaces
   * the thread's client tools from this turn on.
   */
  readonly "turn.start": {
    readonly params: ClientToolsParam & {
      readonly appThreadId: AppThreadId;
      readonly clientMessageId: ClientMessageId | null;
      readonly input: readonly UserContent[];
    };
    readonly result: TurnStartResult;
  };
  /** Mismatch: `-32600 "expected turn is not active"`. */
  readonly "turn.steer": {
    readonly params: {
      readonly appThreadId: AppThreadId;
      readonly clientMessageId: ClientMessageId | null;
      readonly expectedTurnId: TurnId;
      readonly input: readonly UserContent[];
    };
    readonly result: { readonly turnId: TurnId };
  };
}

export type OperationName = keyof OperationMap;
export type OperationParams<Name extends OperationName> = OperationMap[Name]["params"];
export type OperationResult<Name extends OperationName> = OperationMap[Name]["result"];

export const OPERATION_NAMES: readonly OperationName[] = [
  "initialize",
  "catalog.models",
  "catalog.permissionProfiles",
  "thread.create",
  "thread.read",
  "thread.list",
  "thread.turns",
  "thread.update",
  "thread.owns",
  "thread.compact",
  "turn.start",
  "turn.steer",
  "turn.interrupt",
  "request.respond",
  "capability.invoke",
  "nativeSession.list",
  "nativeSession.read",
];

/** Params of `tool.call`: one call of a client tool by the thread's model. */
export interface ToolCallParams {
  readonly appThreadId: AppThreadId;
  /** The tool's arguments as the model sent them. */
  readonly arguments: JsonValue;
  /**
   * Provider-unique id of this call. When the provider can correlate the
   * call with its timeline item, it is that item's `itemId`.
   */
  readonly callId: string;
  /** The `ClientToolSpec.name` the model called. */
  readonly tool: string;
  /** The turn the call belongs to. */
  readonly turnId: TurnId;
}

/**
 * Result of `tool.call`, returned to the model. A tool-level failure is
 * `success: false` with an explanatory text; a JSON-RPC error answer is
 * treated by the provider as `success: false` too.
 */
export interface ToolCallResult {
  readonly content: readonly ClientToolTextContent[];
  readonly success: boolean;
}

/**
 * Requests a provider sends to the companion (provider → companion). The
 * companion answers each with a JSON-RPC response on the same channel. When
 * the turn ends (completed, interrupted or failed) before the answer, the
 * provider stops waiting; a late answer is ignored.
 */
export interface ProviderRequestMap {
  readonly "tool.call": { readonly params: ToolCallParams; readonly result: ToolCallResult };
}

export type ProviderRequestName = keyof ProviderRequestMap;
export type ProviderRequestParams<Name extends ProviderRequestName> =
  ProviderRequestMap[Name]["params"];
export type ProviderRequestResult<Name extends ProviderRequestName> =
  ProviderRequestMap[Name]["result"];

export const PROVIDER_REQUEST_NAMES: readonly ProviderRequestName[] = ["tool.call"];
