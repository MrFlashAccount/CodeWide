import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { unknownRecord } from "../data/unknownRecord";

type Turn = Thread["turns"][number];

const PROMPT_NAME_CHARACTERS = 60;
const NONE: readonly LaunchedAgent[] = [];
const cache = new WeakMap<Turn["items"], readonly LaunchedAgent[]>();

/** A subagent a turn started; its thread is `null` while the launch is unresolved. */
export type LaunchedAgent = {
  readonly agentThreadId: string | null;
  readonly key: string;
  readonly kind: "agent";
  readonly name: string;
};

/** Whether a turn item launches subagents (a `spawnAgent` call). */
export function isAgentLaunchItem(item: Turn["items"][number]): boolean {
  return item.type === "collabAgentToolCall" && item.tool === "spawnAgent";
}

/** The subagents a turn started, in launch order, from its `spawnAgent` calls. */
export function turnLaunchedAgents(turn: Turn): readonly LaunchedAgent[] {
  const cached = cache.get(turn.items);
  if (cached !== undefined) {
    return cached;
  }
  const agents: LaunchedAgent[] = [];
  for (const item of turn.items) {
    agents.push(...launches(unknownRecord(item)));
  }
  const value = agents.length === 0 ? NONE : agents;
  cache.set(turn.items, value);
  return value;
}

function launches(raw: Record<string, unknown> | null): LaunchedAgent[] {
  if (raw?.type !== "collabAgentToolCall" || raw.tool !== "spawnAgent") {
    return [];
  }
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = launchName(raw);
  const receivers = Array.isArray(raw.receiverThreadIds)
    ? raw.receiverThreadIds.filter(
        (receiver): receiver is string => typeof receiver === "string" && receiver !== "",
      )
    : [];
  if (receivers.length === 0) {
    return [{ agentThreadId: null, key: id, kind: "agent", name }];
  }
  return receivers.map((receiver) => ({
    agentThreadId: receiver,
    key: `${id}:${receiver}`,
    kind: "agent",
    name,
  }));
}

/** The launch's short description, else its agent path, else its prompt's first line. */
function launchName(raw: Record<string, unknown>): string {
  return (
    descriptionName(raw.codewideDescription) ?? pathName(raw.agentPath) ?? promptName(raw.prompt)
  );
}

function descriptionName(value: unknown): string | null {
  const description = typeof value === "string" ? value.trim() : "";
  return description === "" ? null : description;
}

function pathName(value: unknown): string | null {
  const path = typeof value === "string" ? value : "";
  return (
    path
      .split("/")
      .findLast((part) => part !== "")
      ?.replaceAll("_", " ") ?? null
  );
}

function promptName(value: unknown): string {
  const prompt = typeof value === "string" ? (value.trim().split("\n")[0] ?? "") : "";
  if (prompt === "") {
    return "Subagent";
  }
  return prompt.length > PROMPT_NAME_CHARACTERS
    ? `${prompt.slice(0, PROMPT_NAME_CHARACTERS - 1)}…`
    : prompt;
}
