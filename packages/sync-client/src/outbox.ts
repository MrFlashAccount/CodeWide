import type { Personality } from "@codewide/codex-protocol/v0.155.1";

export const MAX_TURN_TEXT_CHARS = 900_000;
export const MAX_TURN_ATTACHMENTS = 128;
export const MAX_TURN_SKILLS = 128;

export type OutboxState = "queued" | "pending" | "uncertain" | "failed";

export type OutboxCommand = {
  connectionId: string;
  commandId: string;
  remoteThreadId: string;
  method: "turn/start" | "turn/steer";
  params: Record<string, unknown>;
  state: OutboxState;
  attempts: number;
  createdAt: number;
  updatedAt: number;
  lastError: string | null;
};

export interface RpcClient {
  readonly connectionId?: string;
  rpc<T>(method: string, params: unknown): Promise<T>;
  waitUntilLive?(timeoutMs?: number): Promise<void>;
}

export type OutboxTurnOptions = {
  model?: string | null;
  effort?: string | null;
  serviceTier?: string | null;
  personality?: Personality | null;
  permissions?: string | null;
  skills?: Array<{ name: string; path: string }>;
  attachments?: RemoteFileAttachment[];
};

export type RemoteFileAttachment = {
  id: string;
  rootId: string;
  path: string;
  name: string;
  kind: "image" | "audio" | "file";
};

export function createTextOutboxCommand(
  connectionId: string,
  remoteThreadId: string,
  text: string,
  mode: { type: "start" } | { type: "queue" } | { type: "steer"; expectedTurnId: string } = { type: "start" },
  options: OutboxTurnOptions = {},
  commandId: string = defaultCommandId(),
  now: number = Date.now(),
): OutboxCommand {
  if (text.length > MAX_TURN_TEXT_CHARS) throw new Error(`Turn text exceeds ${MAX_TURN_TEXT_CHARS} characters`);
  if ((options.attachments?.length ?? 0) > MAX_TURN_ATTACHMENTS) throw new Error(`Turn has more than ${MAX_TURN_ATTACHMENTS} attachments`);
  if ((options.skills?.length ?? 0) > MAX_TURN_SKILLS) throw new Error(`Turn has more than ${MAX_TURN_SKILLS} skills`);
  if (text.length === 0 && (options.attachments?.length ?? 0) === 0) throw new Error("Turn input is empty");
  return {
    connectionId,
    commandId,
    remoteThreadId,
    method: mode.type === "steer" ? "turn/steer" : "turn/start",
    params: {
      threadId: remoteThreadId,
      clientUserMessageId: commandId,
      input: [
        ...(text.length === 0 ? [] : [{ type: "text", text, text_elements: [] }]),
        ...(options.attachments ?? []).map((attachment) => ({
          type: "remoteFile",
          rootId: attachment.rootId,
          path: attachment.path,
          name: attachment.name,
          kind: attachment.kind,
        })),
        ...(options.skills ?? []).map((skill) => ({ type: "skill", name: skill.name, path: skill.path })),
      ],
      ...(mode.type === "steer" || options.model === undefined ? {} : { model: options.model }),
      ...(mode.type === "steer" || options.effort === undefined ? {} : { effort: options.effort }),
      ...(mode.type === "steer" || options.serviceTier === undefined ? {} : { serviceTier: options.serviceTier }),
      ...(mode.type === "steer" || options.personality === undefined ? {} : { personality: options.personality }),
      ...(mode.type === "steer" || options.permissions === undefined ? {} : { permissions: options.permissions }),
      ...(mode.type === "steer" ? { expectedTurnId: mode.expectedTurnId } : {}),
    },
    state: mode.type === "queue" ? "queued" : "pending",
    attempts: 0,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };
}

function defaultCommandId(): string {
  const random = Math.random().toString(36).slice(2);
  return `remote-${Date.now().toString(36)}-${random}`;
}
