/**
 * The Agent SDK query adapter. Together with `sdkSessionStore.ts` the only
 * module that imports `@anthropic-ai/claude-agent-sdk`.
 *
 * Every query receives the options a profile fixes plus, always explicitly,
 * `permissionMode`, `settingSources`, `env: process.env`,
 * `pathToClaudeCodeExecutable`, partial messages and summarized adaptive
 * thinking. Messages are read with `query.next()` (an iterator `return()`
 * hangs while the CLI idles). The CLI path is passed by the companion; the
 * SDK's bundled platform binaries are not installed.
 */

import { setTimeout as delay } from "node:timers/promises";
import {
  query,
  type CanUseTool,
  type EffortLevel,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  ClaudeQuery,
  ClaudeRuntime,
  ProbeResult,
  PromptOffer,
  QueryOpenOptions,
  RawModel,
  RuntimeAccount,
} from "./port.js";
import { sessionScoped, type PermissionDecision } from "../permissions/approvals.js";
import type { ProfileOptions } from "../permissions/profiles.js";
import { CLIENT_TOOL_SERVER } from "../mapping/clientTools.js";
import { clientToolServer } from "./sdkClientTools.js";

const PROBE_TIMEOUT_MS = 15_000;

/** A push-based async input stream for one query. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly buffered: SDKUserMessage[] = [];
  private waiting: ((result: IteratorResult<SDKUserMessage, void>) => void) | null = null;
  private ended = false;

  push(message: SDKUserMessage): void {
    if (this.ended) {
      return;
    }
    const waiter = this.waiting;
    if (waiter !== null) {
      this.waiting = null;
      waiter({ done: false, value: message });
      return;
    }
    this.buffered.push(message);
  }

  end(): void {
    this.ended = true;
    const waiter = this.waiting;
    this.waiting = null;
    waiter?.({ done: true, value: undefined });
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage, void> {
    return {
      next: async () => {
        const next = this.buffered.shift();
        if (next !== undefined) {
          return { done: false, value: next };
        }
        if (this.ended) {
          return { done: true, value: undefined };
        }
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

type SdkUuid = NonNullable<SDKUserMessage["uuid"]>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const isUuid = (value: string): value is SdkUuid => UUID.test(value);

function toSdkMessage(offer: PromptOffer): SDKUserMessage {
  return {
    message: { content: [...offer.content], role: "user" },
    parent_tool_use_id: null,
    type: "user",
    ...(offer.uuid !== null && isUuid(offer.uuid) ? { uuid: offer.uuid } : {}),
    ...(offer.priority === null ? {} : { priority: offer.priority }),
  };
}

function toPermissionResult(
  decision: PermissionDecision,
  suggestions: readonly PermissionUpdate[],
): PermissionResult {
  if (decision.behavior === "deny") {
    return {
      behavior: "deny",
      interrupt: decision.interrupt,
      message: decision.message,
      toolUseID: decision.toolUseID,
    };
  }
  return {
    behavior: "allow",
    toolUseID: decision.toolUseID,
    updatedInput: { ...decision.updatedInput },
    ...(decision.scope === "session" ? { updatedPermissions: sessionScoped(suggestions) } : {}),
  };
}

/** Rejects after `ms` unless `work` settles first. */
async function withTimeout<Value>(work: Promise<Value>, ms: number): Promise<Value> {
  const abort = new AbortController();
  const timeout = delay(ms, null, { signal: abort.signal }).then(() => {
    throw new Error("Claude probe timed out");
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    abort.abort();
  }
}

function baseOptions(claudeExecutable: string): Options {
  return {
    env: { ...process.env },
    includePartialMessages: true,
    pathToClaudeCodeExecutable: claudeExecutable,
    systemPrompt: { preset: "claude_code", type: "preset" },
    thinking: { display: "summarized", type: "adaptive" },
  };
}

/**
 * The `mcpServers` option: the profile's own set (`:read-only`: none; other
 * profiles: unset, so settings decide) plus the client tool server.
 */
function mcpServersOption(
  profile: ProfileOptions,
  clientTools: QueryOpenOptions["clientTools"],
): Pick<Options, "mcpServers"> {
  if (clientTools === null) {
    return profile.mcpServers === null ? {} : { mcpServers: {} };
  }
  return { mcpServers: { [CLIENT_TOOL_SERVER]: clientToolServer(clientTools) } };
}

function accountOf(value: unknown): RuntimeAccount | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const read = (key: string): string | null => {
    const field: unknown = Reflect.get(value, key);
    return typeof field === "string" && field.length > 0 ? field : null;
  };
  const provider = read("apiProvider");
  const authenticated =
    read("subscriptionType") !== null ||
    read("tokenSource") !== null ||
    read("apiKeySource") !== null ||
    read("email") !== null ||
    (provider !== null && provider !== "firstParty");
  // Only the plan type is surfaced; email and organization never leave here.
  return { authenticated, label: read("subscriptionType") };
}

function rawModels(models: readonly unknown[]): readonly RawModel[] {
  return models.flatMap((model) => {
    if (typeof model !== "object" || model === null) {
      return [];
    }
    const value: unknown = Reflect.get(model, "value");
    const displayName: unknown = Reflect.get(model, "displayName");
    const description: unknown = Reflect.get(model, "description");
    const efforts: unknown = Reflect.get(model, "supportedEffortLevels");
    if (typeof value !== "string" || typeof displayName !== "string") {
      return [];
    }
    return [
      {
        description: typeof description === "string" ? description : "",
        displayName,
        supportedEffortLevels: Array.isArray(efforts)
          ? efforts.filter((effort): effort is string => typeof effort === "string")
          : [],
        value,
      },
    ];
  });
}

const EFFORTS: ReadonlySet<unknown> = new Set<EffortLevel>([
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]);
const isEffort = (value: string): value is EffortLevel => EFFORTS.has(value);

/** Creates the production runtime bound to the user's `claude` executable. */
export function createSdkRuntime(claudeExecutable: string): ClaudeRuntime {
  return {
    open(options: QueryOpenOptions): ClaudeQuery {
      const input = new InputQueue();
      const canUseTool: CanUseTool = async (toolName, toolInput, context) =>
        toPermissionResult(
          await options.canUseTool({
            decisionReason: context.decisionReason ?? null,
            input: toolInput,
            signal: context.signal,
            toolName,
            toolUseId: context.toolUseID,
          }),
          context.suggestions ?? [],
        );
      const profile = options.profile;
      const sdkOptions: Options = {
        ...baseOptions(claudeExecutable),
        additionalDirectories: [options.cwd],
        cwd: options.cwd,
        model: options.model,
        ...(options.effort !== null && isEffort(options.effort) ? { effort: options.effort } : {}),
        canUseTool,
        permissionMode: profile.permissionMode,
        settingSources: [...profile.settingSources],
        ...(profile.allowDangerouslySkipPermissions
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        ...(profile.strictMcpConfig ? { strictMcpConfig: true } : {}),
        ...mcpServersOption(profile, options.clientTools),
        tools:
          profile.tools === null ? { preset: "claude_code", type: "preset" } : [...profile.tools],
        ...(options.identity.type === "new"
          ? { sessionId: options.identity.sessionId }
          : { resume: options.identity.sessionId }),
      };
      const handle: Query = query({ options: sdkOptions, prompt: input });
      return {
        close: () => {
          input.end();
          handle.close();
        },
        interrupt: async () => {
          await handle.interrupt();
        },
        next: async () => handle.next(),
        offer: (prompt) => {
          input.push(toSdkMessage(prompt));
        },
      };
    },

    async probe(): Promise<ProbeResult> {
      const input = new InputQueue();
      const handle = query({
        options: {
          ...baseOptions(claudeExecutable),
          mcpServers: {},
          permissionMode: "default",
          settingSources: [],
          strictMcpConfig: true,
        },
        prompt: input,
      });
      try {
        const [initialization, models] = await withTimeout(
          Promise.all([handle.initializationResult(), handle.supportedModels()]),
          PROBE_TIMEOUT_MS,
        );
        return { account: accountOf(initialization.account), models: rawModels(models) };
      } finally {
        input.end();
        handle.close();
      }
    },
  };
}
