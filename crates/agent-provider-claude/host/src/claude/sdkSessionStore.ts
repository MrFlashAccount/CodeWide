/**
 * Claude's own session store through the Agent SDK session API.
 *
 * Calls the SDK `sdkModule.ts` loaded. The
 * SDK resolves Claude's configuration directory itself; the host never builds
 * a path into it, never reads credentials and only reads conversations,
 * titles and listings. Writes are limited to `renameSession` and
 * `deleteSession`, issued by explicit thread operations.
 *
 * A session's messages are its whole history: the SDK's own read stops at
 * the last compaction, so the rows are read through `importSessionToStore`,
 * linked across compactions (`compactionLinks.ts`) and read back through the
 * SDK's `sessionStore` option, which applies the same branch rules.
 */

import type { SDKSessionInfo, SessionKey, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { linkAcrossCompactions } from "./compactionLinks.js";
import type { AgentSdk } from "./sdkModule.js";
import type {
  SessionListQuery,
  SessionLocation,
  SubagentLocation,
  SessionRemoval,
  SessionStore,
  StoredSession,
} from "./port.js";

/**
 * The SDK's session store contract is asynchronous; the stores this module
 * hands it keep rows in memory and complete at once.
 */
const IN_MEMORY: Promise<void> = Promise.resolve();

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

/** The main transcript's rows as Claude stored them, or `null` for a session Claude does not have. */
async function storedRows(
  sdk: AgentSdk,
  location: SessionLocation,
): Promise<SessionStoreEntry[] | null> {
  const rows: SessionStoreEntry[] = [];
  const capture = {
    append: async (key: SessionKey, entries: SessionStoreEntry[]): Promise<void> => {
      if (key.subpath === undefined) {
        rows.push(...entries);
      }
      await IN_MEMORY;
    },
    load: async (): Promise<null> => {
      await IN_MEMORY;
      return null;
    },
  };
  try {
    await sdk.importSessionToStore(location.sessionId, capture, {
      ...directoryOf(location),
      includeSubagents: false,
    });
  } catch (error) {
    // The import throws for a session Claude does not have; the session
    // read answers it with no messages.
    if ((await info(sdk, location)) === null) {
      return null;
    }
    throw error;
  }
  return rows;
}

async function messages(sdk: AgentSdk, location: SessionLocation): Promise<readonly unknown[]> {
  const rows = await storedRows(sdk, location);
  if (rows === null) {
    return [];
  }
  const linked = linkAcrossCompactions(rows);
  return sdk.getSessionMessages(location.sessionId, {
    ...directoryOf(location),
    includeSystemMessages: true,
    sessionStore: {
      // Reading never writes: nothing to mirror.
      append: async (): Promise<void> => IN_MEMORY,
      load: async (): Promise<SessionStoreEntry[]> => {
        await IN_MEMORY;
        return linked;
      },
    },
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

async function fork(
  sdk: AgentSdk,
  location: SessionLocation,
  upToMessageId: string | null,
): Promise<string> {
  const forked = await sdk.forkSession(location.sessionId, {
    ...directoryOf(location),
    ...(upToMessageId === null ? {} : { upToMessageId }),
  });
  return forked.sessionId;
}

async function rename(sdk: AgentSdk, location: SessionLocation, title: string): Promise<void> {
  await sdk.renameSession(location.sessionId, title, directoryOf(location));
}

/** The production session store backed by Claude's local session files. */
export function createSdkSessionStore(sdk: AgentSdk): SessionStore {
  return {
    fork: async (location, upToMessageId) => fork(sdk, location, upToMessageId),
    info: async (location) => info(sdk, location),
    list: async (query) => list(sdk, query),
    messages: async (location) => messages(sdk, location),
    remove: async (location) => remove(sdk, location),
    rename: async (location, title) => rename(sdk, location, title),
    subagentMessages: async (location) => subagentMessages(sdk, location),
    subagents: async (location) => subagents(sdk, location),
  };
}
