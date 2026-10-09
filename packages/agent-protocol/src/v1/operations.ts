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
  JsonValue,
  RuntimeResponse,
  ThreadSettings,
  UserContent,
} from "./model";

export const PROTOCOL_NAME = "codewide-agent" as const;
export const PROTOCOL_VERSION = 1 as const;

export interface InitializeParams {
  readonly protocol: typeof PROTOCOL_NAME;
  readonly protocolVersion: number;
  readonly client: { readonly name: string; readonly version: string };
}

export interface ProviderDescriptor {
  readonly id: ProviderId;
  /** Human-readable name, e.g. "Claude". */
  readonly displayName: string;
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
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly provider: ProviderDescriptor;
  readonly capabilities: CapabilitySet;
  readonly account: ProviderAccount | null;
}

export interface ModelEffort {
  readonly effort: string;
  readonly description: string;
}

export interface ModelEntry {
  readonly id: string;
  readonly model: string;
  readonly displayName: string;
  readonly description: string;
  readonly isDefault: boolean;
  readonly hidden: boolean;
  readonly efforts: readonly ModelEffort[];
  readonly defaultEffort: string | null;
  readonly inputModalities: readonly ("text" | "image")[];
}

export interface PermissionProfileEntry {
  readonly id: string;
  readonly displayName: string;
  readonly description: string;
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
  readonly cwd: string | null;
  readonly searchTerm: string | null;
  readonly sortKey: ThreadSortKey;
  readonly sortDirection: SortDirection;
  readonly window: SortWindow | null;
  readonly cursor: string | null;
  readonly limit: number;
}

export type ThreadChange =
  | { readonly type: "name"; readonly name: string | null }
  | { readonly type: "archived"; readonly archived: boolean }
  | { readonly type: "deleted" }
  | {
      readonly type: "settings";
      readonly model: string | null;
      readonly effort: string | null;
      readonly permissionProfile: string | null;
      readonly serviceTier: string | null;
    };

export type TurnStartResult =
  | { readonly type: "started"; readonly turnId: TurnId }
  | { readonly type: "busy"; readonly activeTurnId: TurnId };

export interface OperationMap {
  readonly initialize: { readonly params: InitializeParams; readonly result: InitializeResult };
  readonly "catalog.models": {
    readonly params: Record<string, never>;
    readonly result: { readonly models: readonly ModelEntry[] };
  };
  readonly "catalog.permissionProfiles": {
    readonly params: Record<string, never>;
    readonly result: { readonly profiles: readonly PermissionProfileEntry[] };
  };
  /**
   * Creates a thread. `appThreadId` is host-minted for providers that declare
   * `threads.hostMintedIds`, otherwise `null` and the provider mints it.
   * Repeating with the same host-minted id returns the existing thread.
   */
  readonly "thread.create": {
    readonly params: {
      readonly appThreadId: AppThreadId | null;
      readonly cwd: string;
      readonly settings: ThreadSettings;
    };
    readonly result: { readonly thread: AgentThread };
  };
  /** Idempotent. Unknown id: `-32600 "thread not found: <id>"`. */
  readonly "thread.read": {
    readonly params: { readonly appThreadId: AppThreadId };
    readonly result: { readonly thread: AgentThread; readonly activeTurnId: TurnId | null };
  };
  readonly "thread.list": {
    readonly params: ThreadListParams;
    readonly result: { readonly threads: readonly AgentThread[]; readonly nextCursor: string | null };
  };
  /** Idempotent. Cursor is the last returned turn id; pages are strictly after it. */
  readonly "thread.turns": {
    readonly params: {
      readonly appThreadId: AppThreadId;
      readonly cursor: string | null;
      readonly limit: number;
      readonly sortDirection: SortDirection;
      readonly itemsView: ItemsView;
    };
    readonly result: { readonly turns: readonly AgentTurn[]; readonly nextCursor: string | null };
  };
  /**
   * Repeats answer `{thread}` (or `{thread: null}` after delete, by tombstone)
   * without a second `thread.updated` when nothing changed.
   */
  readonly "thread.update": {
    readonly params: { readonly appThreadId: AppThreadId; readonly change: ThreadChange };
    readonly result: { readonly thread: AgentThread | null };
  };
  readonly "thread.owns": {
    readonly params: { readonly appThreadId: AppThreadId };
    readonly result: { readonly owned: boolean };
  };
  readonly "thread.compact": {
    readonly params: { readonly appThreadId: AppThreadId };
    readonly result: Record<string, never>;
  };
  /** Never steers: an active thread answers `busy` (or joins natively for `nativeJoin`). */
  readonly "turn.start": {
    readonly params: {
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
      readonly expectedTurnId: TurnId;
      readonly clientMessageId: ClientMessageId | null;
      readonly input: readonly UserContent[];
    };
    readonly result: { readonly turnId: TurnId };
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
  readonly "request.respond": {
    readonly params: {
      readonly appThreadId: AppThreadId;
      readonly requestId: NativeRequestId;
      readonly response: RuntimeResponse;
    };
    readonly result: Record<string, never>;
  };
  readonly "capability.invoke": {
    readonly params: {
      readonly capability: string;
      readonly method: string;
      readonly params: JsonValue;
    };
    readonly result: { readonly result: JsonValue };
  };
}

export type OperationName = keyof OperationMap;
export type OperationParams<Name extends OperationName> = OperationMap[Name]["params"];
export type OperationResult<Name extends OperationName> = OperationMap[Name]["result"];

export const OPERATION_NAMES = [
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
] as const satisfies readonly OperationName[];
