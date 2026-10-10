/**
 * The host's ports to the Claude Agent SDK.
 *
 * Sessions, the thread service and tests depend on these SDK-free types.
 * `sdkRuntime.ts` (live queries) and `sdkSessionStore.ts` (Claude's own
 * session store) are the only adapters that import
 * `@anthropic-ai/claude-agent-sdk`. Raw SDK messages cross these ports as
 * `unknown` and are classified structurally by `mapping/frames.ts` and
 * `history/entries.ts`.
 */

import type { ClientToolSpec, ToolCallResult } from "../protocol.js";
import type { JsonRecord } from "../mapping/frames.js";
import type { PermissionDecision } from "../permissions/approvals.js";
import type { PermissionMode, ProfileOptions } from "../permissions/profiles.js";

/** Content blocks of a prompt offer (Anthropic Messages API user content). */
export type PromptContent =
  | { readonly text: string; readonly type: "text" }
  | {
      readonly source: {
        readonly data: string;
        readonly media_type: ImageMediaType;
        readonly type: "base64";
      };
      readonly type: "image";
    };

/** Image types the Messages API accepts inline. */
export type ImageMediaType = "image/gif" | "image/jpeg" | "image/png" | "image/webp";

export interface PromptOffer {
  readonly content: readonly PromptContent[];
  readonly priority: "now" | null;
  /**
   * Fresh UUIDv4 per offer, or `null` when the steer fallback omits it. Claude
   * persists the user message under this uuid, which is how history finds it.
   */
  readonly uuid: string | null;
}

/** What `canUseTool` receives from the SDK. */
export interface PermissionRequest {
  readonly decisionReason: string | null;
  readonly input: JsonRecord;
  readonly signal: AbortSignal;
  readonly toolName: string;
  readonly toolUseId: string;
}

export type CanUseToolHandler = (request: PermissionRequest) => Promise<PermissionDecision>;

/** First open of a session uses `sessionId`; later opens use `resume`. */
export type SessionIdentity =
  | { readonly sessionId: string; readonly type: "new" }
  | { readonly sessionId: string; readonly type: "resume" };

/** One call of a client tool, as the in-process MCP server receives it. */
export interface ClientToolInvocation {
  /** Arguments after the SDK checked them against the tool's input schema. */
  readonly arguments: JsonRecord;
  /** Aborted when Claude cancels the call; `null` when the SDK passes no signal. */
  readonly signal: AbortSignal | null;
  /** The bare client tool name (`ClientToolSpec.name`). */
  readonly tool: string;
}

/** The client tools of one query and how their calls are answered. */
export interface ClientToolBinding {
  readonly invoke: (invocation: ClientToolInvocation) => Promise<ToolCallResult>;
  /** Called for each tool whose input schema the adapter cannot use; that tool is left out. */
  readonly rejected: (tool: string, error: Error) => void;
  readonly specs: readonly ClientToolSpec[];
}

/** Everything needed to open one long-lived query. */
export interface QueryOpenOptions {
  readonly canUseTool: CanUseToolHandler;
  /** The companion's client tools, registered as one in-process MCP server; `null` for none. */
  readonly clientTools: ClientToolBinding | null;
  readonly cwd: string;
  readonly effort: string | null;
  readonly identity: SessionIdentity;
  readonly model: string;
  readonly profile: ProfileOptions;
}

export interface ClaudeQuery {
  /** Ends the input stream, then closes the query and its process. */
  readonly close: () => void;
  /** `query.interrupt()`; never `close()`. */
  readonly interrupt: () => Promise<void>;
  /** Next raw SDK message (`query.next()`). Rejects when the process fails. */
  readonly next: () => Promise<IteratorResult<unknown, void>>;
  /** Queues one user message on the query's input stream. */
  readonly offer: (prompt: PromptOffer) => void;
  /**
   * The SDK's experimental usage read (plan rate limits) through this query;
   * the raw answer, validated by `usageReadWindows`. Rejects when unsupported.
   */
  readonly readUsage: () => Promise<unknown>;
  /**
   * `query.setPermissionMode()`: changes the live session's permission mode
   * from the next tool call on. `bypassPermissions` needs a query opened with
   * `allowDangerouslySkipPermissions`.
   */
  readonly setPermissionMode: (mode: PermissionMode) => Promise<void>;
}

export interface RawModel {
  readonly description: string;
  readonly displayName: string;
  /** The canonical API model id an alias row resolves to, when the SDK reports it. */
  readonly resolvedModel?: string;
  readonly supportedEffortLevels: readonly string[];
  readonly value: string;
}

/** Account state derived from `initializationResult().account`; never a credential. */
export interface RuntimeAccount {
  /** Signed-in email, else organization, of an Anthropic login; shown to the user, never logged. */
  readonly accountLabel?: string;
  readonly authenticated: boolean;
  /** Plan type such as `max`. */
  readonly label: string | null;
}

export interface ProbeResult {
  readonly account: RuntimeAccount | null;
  readonly models: readonly RawModel[];
  /** Raw answer of the usage read, or `null` when it failed or is unsupported. */
  readonly usage: unknown;
}

export interface ClaudeRuntime {
  readonly open: (options: QueryOpenOptions) => ClaudeQuery;
  /** Starts a short-lived query without a prompt to read account, models and usage; no model call. */
  readonly probe: () => Promise<ProbeResult>;
}

/**
 * Metadata of one session in Claude's own session store
 * (`listSessions` / `getSessionInfo`), validated at the adapter boundary.
 */
export interface StoredSession {
  /** Creation time (ms since epoch) from the first entry, when known. */
  readonly createdAtMs: number | null;
  /** Working directory the session ran in, when Claude recorded it. */
  readonly cwd: string | null;
  /** Size of the session file, when Claude's store reports it. */
  readonly fileSize: number | null;
  /** First meaningful user prompt; `null` while the session has none. */
  readonly firstPrompt: string | null;
  /** Last modification time of the session (ms since epoch). */
  readonly lastModifiedMs: number;
  readonly sessionId: string;
  /** Claude's display summary: the title, a generated summary or the first prompt. */
  readonly summary: string;
  /** Title set by `/rename`, `renameSession` or Claude's generated title. */
  readonly title: string | null;
}

/** One page of a session listing, newest first. */
export interface SessionListQuery {
  /** One project directory (with its git worktrees), or `null` for every project. */
  readonly dir: string | null;
  /** `null` returns every remaining session. */
  readonly limit: number | null;
  readonly offset: number;
  readonly scope: SessionListScope;
}

/** A sub-agent transcript of a session. */
export interface SubagentLocation extends SessionLocation {
  readonly agentId: string;
}

/** Which sessions a listing returns. */
export type SessionListScope =
  /** Every session, including SDK-started (programmatic) ones. */
  | "all"
  /** Only sessions a person started interactively (terminal, IDE), as `/resume` shows them. */
  | "interactive";

/** Where a session lives: its id plus the working directory, when known, to narrow the search. */
export interface SessionLocation {
  readonly cwd: string | null;
  readonly sessionId: string;
}

export type SessionRemoval = "removed" | "missing";

/**
 * Claude's own session store. The host reads conversations, titles and
 * listings from it and writes only titles and deletions through it; it never
 * opens Claude's files itself.
 */
export interface SessionStore {
  /** Metadata of one session, or `null` when Claude has no such session. */
  readonly info: (location: SessionLocation) => Promise<StoredSession | null>;
  readonly list: (query: SessionListQuery) => Promise<readonly StoredSession[]>;
  /** The session's conversation messages in order (raw SDK `SessionMessage` values); empty when missing. */
  readonly messages: (location: SessionLocation) => Promise<readonly unknown[]>;
  /** Deletes the session; a session that does not exist is reported as `missing`. */
  readonly remove: (location: SessionLocation) => Promise<SessionRemoval>;
  /** Sets the session title (`title` is non-empty). */
  readonly rename: (location: SessionLocation, title: string) => Promise<void>;
  /** One sub-agent's messages in order (raw SDK `SessionMessage` values). */
  readonly subagentMessages: (location: SubagentLocation) => Promise<readonly unknown[]>;
  /** Ids of the session's sub-agents; empty when it has none. */
  readonly subagents: (location: SessionLocation) => Promise<readonly string[]>;
}
