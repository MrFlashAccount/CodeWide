/**
 * Claude's own session store through the Agent SDK session API.
 *
 * Calls the SDK `sdkModule.ts` loaded. The
 * SDK resolves Claude's configuration directory itself; the host never builds
 * a path into it, never reads credentials and only reads conversations,
 * titles and listings. Writes are limited to `renameSession` and
 * `deleteSession`, issued by explicit thread operations.
 */

import type { SDKSessionInfo } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSdk } from "./sdkModule.js";
import type {
  SessionListQuery,
  SessionLocation,
  SubagentLocation,
  SessionRemoval,
  SessionStore,
  StoredSession,
} from "./port.js";

const nonEmpty = (value: string | undefined): string | null =>
  value === undefined || value.length === 0 ? null : value;

function storedSession(info: SDKSessionInfo): StoredSession {
  return {
    createdAtMs: info.createdAt ?? null,
    cwd: nonEmpty(info.cwd),
    fileSize: info.fileSize ?? null,
    firstPrompt: nonEmpty(info.firstPrompt),
    lastModifiedMs: info.lastModified,
    sessionId: info.sessionId,
    summary: info.summary,
    title: nonEmpty(info.customTitle),
  };
}

/** `{ dir }` narrows the search to the session's project; without it every project is searched. */
const directoryOf = (location: SessionLocation): { readonly dir?: string } =>
  location.cwd === null ? {} : { dir: location.cwd };

async function info(sdk: AgentSdk, location: SessionLocation): Promise<StoredSession | null> {
  const found = await sdk.getSessionInfo(location.sessionId, directoryOf(location));
  return found === undefined ? null : storedSession(found);
}

async function list(sdk: AgentSdk, query: SessionListQuery): Promise<readonly StoredSession[]> {
  const sessions = await sdk.listSessions({
    ...(query.dir === null ? {} : { dir: query.dir }),
    includeProgrammatic: query.scope === "all",
    ...(query.limit === null ? {} : { limit: query.limit }),
    offset: query.offset,
  });
  return sessions.map(storedSession);
}

async function subagents(sdk: AgentSdk, location: SessionLocation): Promise<readonly string[]> {
  return sdk.listSubagents(location.sessionId, directoryOf(location));
}

async function subagentMessages(
  sdk: AgentSdk,
  location: SubagentLocation,
): Promise<readonly unknown[]> {
  return sdk.getSubagentMessages(location.sessionId, location.agentId, directoryOf(location));
}

async function messages(sdk: AgentSdk, location: SessionLocation): Promise<readonly unknown[]> {
  return sdk.getSessionMessages(location.sessionId, {
    ...directoryOf(location),
    includeSystemMessages: true,
  });
}

async function remove(sdk: AgentSdk, location: SessionLocation): Promise<SessionRemoval> {
  try {
    await sdk.deleteSession(location.sessionId, directoryOf(location));
    return "removed";
  } catch (error) {
    // `deleteSession` throws for a session that does not exist; a repeated
    // delete must succeed, so a session Claude no longer knows is `missing`.
    if ((await info(sdk, location)) === null) {
      return "missing";
    }
    throw error;
  }
}

async function rename(sdk: AgentSdk, location: SessionLocation, title: string): Promise<void> {
  await sdk.renameSession(location.sessionId, title, directoryOf(location));
}

/** The production session store backed by Claude's local session files. */
export function createSdkSessionStore(sdk: AgentSdk): SessionStore {
  return {
    info: async (location) => info(sdk, location),
    list: async (query) => list(sdk, query),
    messages: async (location) => messages(sdk, location),
    remove: async (location) => remove(sdk, location),
    rename: async (location, title) => rename(sdk, location, title),
    subagentMessages: async (location) => subagentMessages(sdk, location),
    subagents: async (location) => subagents(sdk, location),
  };
}
