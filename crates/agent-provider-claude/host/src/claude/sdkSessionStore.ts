/**
 * Claude's own session store through the Agent SDK session API.
 *
 * One of the two modules that import `@anthropic-ai/claude-agent-sdk`. The
 * SDK resolves Claude's configuration directory itself; the host never builds
 * a path into it, never reads credentials and only reads conversations,
 * titles and listings. Writes are limited to `renameSession` and
 * `deleteSession`, issued by explicit thread operations.
 */

import {
  deleteSession,
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSessions,
  listSubagents,
  renameSession,
  type SDKSessionInfo,
} from "@anthropic-ai/claude-agent-sdk";
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

async function info(location: SessionLocation): Promise<StoredSession | null> {
  const found = await getSessionInfo(location.sessionId, directoryOf(location));
  return found === undefined ? null : storedSession(found);
}

async function list(query: SessionListQuery): Promise<readonly StoredSession[]> {
  const sessions = await listSessions({
    ...(query.dir === null ? {} : { dir: query.dir }),
    includeProgrammatic: query.scope === "all",
    ...(query.limit === null ? {} : { limit: query.limit }),
    offset: query.offset,
  });
  return sessions.map(storedSession);
}

async function subagents(location: SessionLocation): Promise<readonly string[]> {
  return listSubagents(location.sessionId, directoryOf(location));
}

async function subagentMessages(location: SubagentLocation): Promise<readonly unknown[]> {
  return getSubagentMessages(location.sessionId, location.agentId, directoryOf(location));
}

async function messages(location: SessionLocation): Promise<readonly unknown[]> {
  return getSessionMessages(location.sessionId, {
    ...directoryOf(location),
    includeSystemMessages: true,
  });
}

async function remove(location: SessionLocation): Promise<SessionRemoval> {
  try {
    await deleteSession(location.sessionId, directoryOf(location));
    return "removed";
  } catch (error) {
    // `deleteSession` throws for a session that does not exist; a repeated
    // delete must succeed, so a session Claude no longer knows is `missing`.
    if ((await info(location)) === null) {
      return "missing";
    }
    throw error;
  }
}

async function rename(location: SessionLocation, title: string): Promise<void> {
  await renameSession(location.sessionId, title, directoryOf(location));
}

/** The production session store backed by Claude's local session files. */
export function createSdkSessionStore(): SessionStore {
  return { info, list, messages, remove, rename, subagentMessages, subagents };
}
