/**
 * An in-memory stand-in for Claude's session store. Fake runtimes persist
 * what a real `claude` process would persist (prompt offers under their
 * uuid, assistant messages and tool results, thinking without its text), so
 * history read back through the host matches what Claude would return.
 */

import type {
  PromptOffer,
  SessionListQuery,
  SessionLocation,
  SessionRemoval,
  SessionStore,
  StoredSession,
  SubagentLocation,
} from "../../src/claude/port.js";

interface MemorySession {
  readonly interactive: boolean;
  readonly messages: unknown[];
  meta: StoredSession;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** What the store keeps of an assistant message: thinking blocks lose their text. */
function storedAssistant(
  frame: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const message = frame["message"];
  if (!isRecord(message) || !Array.isArray(message["content"])) {
    return frame;
  }
  const content = message["content"].map((block: unknown) =>
    isRecord(block) && block["type"] === "thinking" ? { ...block, thinking: "" } : block,
  );
  return { ...frame, message: { ...message, content } };
}

function firstPromptOf(content: unknown): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content.find((block: unknown) => isRecord(block) && block["type"] === "text");
  return isRecord(text) && typeof text["text"] === "string" ? text["text"] : null;
}

export class MemorySessionStore implements SessionStore {
  public readonly sessions = new Map<string, MemorySession>();
  public readonly renamed: (readonly [string, string])[] = [];
  public readonly removed: string[] = [];
  private readonly denied = new Map<string, string>();
  private clockMs = 1_760_000_000_000;
  private counter = 0;

  private tick(): number {
    this.clockMs += 1000;
    return this.clockMs;
  }

  private session(sessionId: string, cwd: string, interactive = false): MemorySession {
    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      return existing;
    }
    const created: MemorySession = {
      interactive,
      messages: [],
      meta: {
        createdAtMs: this.clockMs,
        cwd,
        fileSize: 0,
        firstPrompt: null,
        lastModifiedMs: this.clockMs,
        sessionId,
        summary: "",
        title: null,
      },
    };
    this.sessions.set(sessionId, created);
    return created;
  }

  /** Appends one stored message (already in `SessionMessage` shape). */
  public append(
    location: { readonly cwd: string; readonly sessionId: string },
    message: Readonly<Record<string, unknown>>,
  ): void {
    const session = this.session(location.sessionId, location.cwd);
    const timestampMs = this.tick();
    session.messages.push({
      timestamp: new Date(timestampMs).toISOString(),
      ...message,
      session_id: location.sessionId,
    });
    const body = message["message"];
    const prompt =
      message["type"] === "user" && isRecord(body) ? firstPromptOf(body["content"]) : null;
    session.meta = {
      ...session.meta,
      firstPrompt:
        session.meta.firstPrompt ?? (prompt !== null && !prompt.startsWith("<") ? prompt : null),
      lastModifiedMs: timestampMs,
    };
  }

  /** Persists a prompt offer the way the CLI stores the user message. */
  public persistOffer(
    location: { readonly cwd: string; readonly sessionId: string },
    offer: PromptOffer,
  ): void {
    if (
      offer.content.length === 1 &&
      offer.content[0]?.type === "text" &&
      offer.content[0].text === "/compact"
    ) {
      return;
    }
    this.counter += 1;
    this.append(location, {
      message: { content: offer.content, role: "user" },
      parent_agent_id: null,
      parent_tool_use_id: null,
      type: "user",
      uuid: offer.uuid ?? `offer-${String(this.counter)}`,
    });
  }

  /**
   * Records that the host denied a tool call: the CLI then stores the deny
   * message as an error tool result, whatever a recorded transcript says.
   */
  public markDenied(toolUseId: string, message: string): void {
    this.denied.set(toolUseId, message);
  }

  private withDenials(message: unknown): unknown {
    if (!isRecord(message) || !Array.isArray(message["content"])) {
      return message;
    }
    const content = message["content"].map((block: unknown) => {
      const id = isRecord(block) && block["type"] === "tool_result" ? block["tool_use_id"] : null;
      const denial = typeof id === "string" ? this.denied.get(id) : undefined;
      return denial === undefined || !isRecord(block)
        ? block
        : { ...block, content: denial, is_error: true };
    });
    return { ...message, content };
  }

  /** Persists one live SDK frame when the CLI would store it. */
  public persistFrame(
    location: { readonly cwd: string; readonly sessionId: string },
    frame: unknown,
  ): void {
    if (!isRecord(frame)) {
      return;
    }
    const type = frame["type"];
    this.counter += 1;
    const uuid =
      typeof frame["uuid"] === "string" ? frame["uuid"] : `stored-${String(this.counter)}`;
    if (type === "assistant") {
      this.append(location, {
        ...storedAssistant(frame),
        parent_agent_id: null,
        parent_tool_use_id: frame["parent_tool_use_id"] ?? null,
        uuid,
      });
    } else if (type === "user" && frame["isSynthetic"] !== true) {
      this.append(location, {
        message: this.withDenials(frame["message"]),
        parent_agent_id: null,
        parent_tool_use_id: frame["parent_tool_use_id"] ?? null,
        type: "user",
        uuid,
      });
    } else if (
      type === "system" &&
      frame["subtype"] === "task_notification" &&
      typeof frame["task_id"] === "string"
    ) {
      // Claude persists a finished task's notification as a queued
      // `<task-notification>` user message with a task-notification origin.
      const toolUseId =
        typeof frame["tool_use_id"] === "string"
          ? `<tool-use-id>${frame["tool_use_id"]}</tool-use-id>`
          : "";
      const status = typeof frame["status"] === "string" ? frame["status"] : "completed";
      this.append(location, {
        isQueuedCommand: true,
        message: {
          content: `<task-notification>\n<task-id>${frame["task_id"]}</task-id>\n${toolUseId}\n<status>${status}</status>\n</task-notification>`,
          role: "user",
        },
        origin: { kind: "task-notification" },
        parent_agent_id: null,
        parent_tool_use_id: null,
        type: "user",
        uuid,
      });
    } else if (type === "system" && frame["subtype"] === "compact_boundary") {
      this.append(location, {
        message: undefined,
        parent_agent_id: null,
        parent_tool_use_id: null,
        type: "system",
        uuid,
      });
      this.append(location, {
        isCompactSummary: true,
        message: {
          content: "This session is being continued from a previous conversation.",
          role: "user",
        },
        parent_agent_id: null,
        parent_tool_use_id: null,
        type: "user",
        uuid: `${uuid}:summary`,
      });
    }
  }

  /** Adds a session as if a person had started it with `claude` in a terminal. */
  public addInteractive(meta: StoredSession, messages: readonly unknown[]): void {
    this.sessions.set(meta.sessionId, { interactive: true, messages: [...messages], meta });
  }

  public info = async (location: SessionLocation): Promise<StoredSession | null> =>
    Promise.resolve(this.sessions.get(location.sessionId)?.meta ?? null);

  /** Sub-agent transcripts by session id and agent id. */
  public readonly subagentTranscripts = new Map<string, Map<string, readonly unknown[]>>();

  public list = async (query: SessionListQuery): Promise<readonly StoredSession[]> => {
    const matching = [...this.sessions.values()]
      .filter(
        (session) =>
          (query.scope === "all" || session.interactive) &&
          (query.dir === null || session.meta.cwd === query.dir),
      )
      .map((session) => session.meta)
      .toSorted(
        (left, right) =>
          right.lastModifiedMs - left.lastModifiedMs || (left.sessionId < right.sessionId ? -1 : 1),
      );
    return Promise.resolve(
      matching.slice(query.offset, query.limit === null ? undefined : query.offset + query.limit),
    );
  };

  public subagents = async (location: SessionLocation): Promise<readonly string[]> =>
    Promise.resolve([...(this.subagentTranscripts.get(location.sessionId)?.keys() ?? [])]);

  public subagentMessages = async (location: SubagentLocation): Promise<readonly unknown[]> =>
    Promise.resolve(this.subagentTranscripts.get(location.sessionId)?.get(location.agentId) ?? []);

  public messages = async (location: SessionLocation): Promise<readonly unknown[]> =>
    Promise.resolve(this.sessions.get(location.sessionId)?.messages ?? []);

  public remove = async (location: SessionLocation): Promise<SessionRemoval> => {
    this.removed.push(location.sessionId);
    return Promise.resolve(this.sessions.delete(location.sessionId) ? "removed" : "missing");
  };

  public rename = async (location: SessionLocation, title: string): Promise<void> => {
    const session = this.sessions.get(location.sessionId);
    if (session === undefined) {
      return Promise.reject(new Error(`Session ${location.sessionId} not found`));
    }
    this.renamed.push([location.sessionId, title]);
    session.meta = { ...session.meta, title };
    return Promise.resolve();
  };
}
