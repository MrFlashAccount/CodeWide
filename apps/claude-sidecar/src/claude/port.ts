/**
 * The sidecar's port to the Claude Agent SDK.
 *
 * Sessions and tests depend on these SDK-free types; `sdkRuntime.ts` is the
 * single adapter that imports `@anthropic-ai/claude-agent-sdk`. Raw SDK
 * messages cross this port as `unknown` and are classified structurally by
 * `mapping/frames.ts`.
 */

import type { JsonRecord } from "../mapping/frames.js";
import type { PermissionDecision } from "../permissions/approvals.js";
import type { ProfileOptions } from "../permissions/profiles.js";

/** Content blocks of a prompt offer (Anthropic Messages API user content). */
export type PromptContent =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "image";
      readonly source: { readonly type: "base64"; readonly media_type: string; readonly data: string };
    };

export interface PromptOffer {
  /** Fresh UUIDv4 per offer, or `null` when the steer fallback omits it. */
  readonly uuid: string | null;
  readonly priority: "now" | null;
  readonly content: readonly PromptContent[];
}

/** What `canUseTool` receives from the SDK. */
export interface PermissionRequest {
  readonly toolName: string;
  readonly input: JsonRecord;
  readonly toolUseId: string;
  readonly suggestions: readonly unknown[];
  readonly decisionReason: string | null;
  readonly signal: AbortSignal;
}

export type CanUseToolHandler = (request: PermissionRequest) => Promise<PermissionDecision>;

/** Everything needed to open one long-lived query. */
export interface QueryOpenOptions {
  /** First open of a session uses `sessionId`; later opens use `resume`. */
  readonly identity: { readonly type: "new"; readonly sessionId: string } | { readonly type: "resume"; readonly sessionId: string };
  readonly cwd: string;
  readonly model: string;
  readonly effort: string | null;
  readonly profile: ProfileOptions;
  readonly canUseTool: CanUseToolHandler;
}

export interface ClaudeQuery {
  /** Queues one user message on the query's input stream. */
  readonly offer: (prompt: PromptOffer) => void;
  /** Next raw SDK message (`query.next()`). Rejects when the process fails. */
  readonly next: () => Promise<IteratorResult<unknown, void>>;
  /** `query.interrupt()`; never `close()`. */
  readonly interrupt: () => Promise<void>;
  /** Ends the input stream, then closes the query and its process. */
  readonly close: () => void;
}

export interface RawModel {
  readonly value: string;
  readonly displayName: string;
  readonly description: string;
  readonly supportedEffortLevels: readonly string[];
}

/** Non-identifying account state derived from `initializationResult().account`. */
export interface RuntimeAccount {
  readonly authenticated: boolean;
  readonly label: string | null;
}

export interface ProbeResult {
  readonly account: RuntimeAccount | null;
  readonly models: readonly RawModel[];
}

export interface ClaudeRuntime {
  readonly open: (options: QueryOpenOptions) => ClaudeQuery;
  /** Starts a short-lived query without a prompt to read account and models; no model call. */
  readonly probe: () => Promise<ProbeResult>;
}
