/**
 * The Agent SDK adapter: the only module that imports
 * `@anthropic-ai/claude-agent-sdk`.
 *
 * Every query receives the options a profile fixes plus, always explicitly,
 * `permissionMode`, `settingSources`, `env: process.env`,
 * `pathToClaudeCodeExecutable`, partial messages and summarized adaptive
 * thinking. Messages are read with `query.next()` (an iterator `return()`
 * hangs while the CLI idles). The CLI path is passed by the companion; the
 * SDK's bundled platform binaries are not installed.
 */

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
import type { PermissionDecision } from "../permissions/approvals.js";

const PROBE_TIMEOUT_MS = 15_000;

/** A push-based async input stream for one query. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private readonly buffered: SDKUserMessage[] = [];
  private waiting: ((result: IteratorResult<SDKUserMessage, void>) => void) | null = null;
  private ended = false;

  push(message: SDKUserMessage): void {
    if (this.ended) return;
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
      next: () => {
        const next = this.buffered.shift();
        if (next !== undefined) return Promise.resolve({ done: false, value: next });
        if (this.ended) return Promise.resolve({ done: true, value: undefined });
        return new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

function toSdkMessage(offer: PromptOffer): SDKUserMessage {
  return {
    type: "user",
    // WHY: PromptContent is the Messages API text/base64-image block shape;
    // the SDK types the field as the Anthropic `MessageParam`.
    message: { role: "user", content: offer.content as SDKUserMessage["message"]["content"] },
    parent_tool_use_id: null,
    ...(offer.uuid === null ? {} : { uuid: offer.uuid as `${string}-${string}-${string}-${string}-${string}` }), // WHY: a UUIDv4 minted by the sidecar.
    ...(offer.priority === null ? {} : { priority: offer.priority }),
  };
}

function toPermissionResult(decision: PermissionDecision): PermissionResult {
  if (decision.behavior === "deny") {
    return { behavior: "deny", message: decision.message, interrupt: decision.interrupt, toolUseID: decision.toolUseID };
  }
  return {
    behavior: "allow",
    updatedInput: { ...decision.updatedInput },
    // WHY: updates are SDK suggestions echoed back with only `destination`
    // rewritten to "session"; their shape is the SDK's own.
    ...(decision.updatedPermissions === null ? {} : { updatedPermissions: decision.updatedPermissions as PermissionUpdate[] }),
    toolUseID: decision.toolUseID,
  };
}

function baseOptions(claudeExecutable: string): Options {
  return {
    pathToClaudeCodeExecutable: claudeExecutable,
    env: { ...process.env },
    includePartialMessages: true,
    thinking: { type: "adaptive", display: "summarized" },
    systemPrompt: { type: "preset", preset: "claude_code" },
  };
}

function accountOf(value: unknown): RuntimeAccount | null {
  if (typeof value !== "object" || value === null) return null;
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
    if (typeof model !== "object" || model === null) return [];
    const value: unknown = Reflect.get(model, "value");
    const displayName: unknown = Reflect.get(model, "displayName");
    const description: unknown = Reflect.get(model, "description");
    const efforts: unknown = Reflect.get(model, "supportedEffortLevels");
    if (typeof value !== "string" || typeof displayName !== "string") return [];
    return [
      {
        value,
        displayName,
        description: typeof description === "string" ? description : "",
        supportedEffortLevels: Array.isArray(efforts) ? efforts.filter((effort): effort is string => typeof effort === "string") : [],
      },
    ];
  });
}

const EFFORTS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

/** Creates the production runtime bound to the user's `claude` executable. */
export function createSdkRuntime(claudeExecutable: string): ClaudeRuntime {
  return {
    open(options: QueryOpenOptions): ClaudeQuery {
      const input = new InputQueue();
      const canUseTool: CanUseTool = async (toolName, toolInput, context) =>
        toPermissionResult(
          await options.canUseTool({
            toolName,
            input: toolInput,
            toolUseId: context.toolUseID,
            suggestions: context.suggestions ?? [],
            decisionReason: context.decisionReason ?? null,
            signal: context.signal,
          }),
        );
      const profile = options.profile;
      const sdkOptions: Options = {
        ...baseOptions(claudeExecutable),
        cwd: options.cwd,
        additionalDirectories: [options.cwd],
        model: options.model,
        ...(options.effort !== null && EFFORTS.includes(options.effort)
          ? { effort: options.effort as EffortLevel } // WHY: membership in the SDK's effort list was checked.
          : {}),
        permissionMode: profile.permissionMode,
        settingSources: [...profile.settingSources],
        canUseTool,
        ...(profile.allowDangerouslySkipPermissions ? { allowDangerouslySkipPermissions: true } : {}),
        ...(profile.strictMcpConfig ? { strictMcpConfig: true } : {}),
        ...(profile.mcpServers === null ? {} : { mcpServers: {} }),
        tools: profile.tools === null ? { type: "preset", preset: "claude_code" } : [...profile.tools],
        ...(options.identity.type === "new" ? { sessionId: options.identity.sessionId } : { resume: options.identity.sessionId }),
      };
      const handle: Query = query({ prompt: input, options: sdkOptions });
      return {
        offer: (prompt) => input.push(toSdkMessage(prompt)),
        next: () => handle.next(),
        interrupt: async () => {
          await handle.interrupt();
        },
        close: () => {
          input.end();
          handle.close();
        },
      };
    },

    async probe(): Promise<ProbeResult> {
      const input = new InputQueue();
      const handle = query({
        prompt: input,
        options: { ...baseOptions(claudeExecutable), permissionMode: "default", settingSources: [], strictMcpConfig: true, mcpServers: {} },
      });
      let timer: NodeJS.Timeout | null = null;
      try {
        const timeout = new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("Claude probe timed out")), PROBE_TIMEOUT_MS);
        });
        const [initialization, models] = await Promise.race([
          Promise.all([handle.initializationResult(), handle.supportedModels()]),
          timeout,
        ]);
        return { account: accountOf(initialization.account), models: rawModels(models) };
      } finally {
        if (timer !== null) clearTimeout(timer);
        input.end();
        handle.close();
      }
    },
  };
}
