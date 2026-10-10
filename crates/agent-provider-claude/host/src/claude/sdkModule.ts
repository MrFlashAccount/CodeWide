/**
 * The Agent SDK, loaded once when the host starts. The packaged host
 * (`bun build --compile` with the SDK left external) loads the SDK the
 * companion downloaded from npm, passed as `--agent-sdk <absolute path of
 * sdk.mjs>`; a source checkout imports its installed package. The only
 * module that loads `@anthropic-ai/claude-agent-sdk` at run time: the SDK
 * adapters receive the loaded module.
 */

import { pathToFileURL } from "node:url";
import type {
  createSdkMcpServer,
  deleteSession,
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSessions,
  listSubagents,
  query,
  renameSession,
  tool,
} from "@anthropic-ai/claude-agent-sdk";

/** The SDK functions the host calls. */
export interface AgentSdk {
  readonly createSdkMcpServer: typeof createSdkMcpServer;
  readonly deleteSession: typeof deleteSession;
  readonly getSessionInfo: typeof getSessionInfo;
  readonly getSessionMessages: typeof getSessionMessages;
  readonly getSubagentMessages: typeof getSubagentMessages;
  readonly listSessions: typeof listSessions;
  readonly listSubagents: typeof listSubagents;
  readonly query: typeof query;
  readonly renameSession: typeof renameSession;
  readonly tool: typeof tool;
}

const FUNCTIONS = [
  "createSdkMcpServer",
  "deleteSession",
  "getSessionInfo",
  "getSessionMessages",
  "getSubagentMessages",
  "listSessions",
  "listSubagents",
  "query",
  "renameSession",
  "tool",
] as const satisfies readonly (keyof AgentSdk)[];

function isAgentSdk(module: unknown): module is AgentSdk {
  return (
    typeof module === "object" &&
    module !== null &&
    FUNCTIONS.every((name) => typeof Reflect.get(module, name) === "function")
  );
}

/** Loads the SDK from `entry`, or the installed package when `null`. */
export async function loadAgentSdk(entry: string | null): Promise<AgentSdk> {
  const module: unknown =
    entry === null
      ? await import("@anthropic-ai/claude-agent-sdk")
      : await import(pathToFileURL(entry).href);
  if (!isAgentSdk(module)) {
    throw new Error("the Agent SDK module lacks the functions the host calls");
  }
  return module;
}
