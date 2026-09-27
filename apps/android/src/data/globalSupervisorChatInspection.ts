import type { GlobalSupervisorQualifiedChatRef } from "./globalSupervisorBinding";
import { projectGlobalSupervisorSafeText } from "./globalSupervisorSafeText";
import { unknownRecord } from "./unknownRecord";

const MAX_STEP_ENTRIES = 24;
const MAX_UPDATE_ENTRIES = 4;
const MAX_UPDATE_CHARACTERS = 320;
const MAX_TECHNICAL_NAME_CHARACTERS = 80;
const MAX_ID_CHARACTERS = 256;

type GlobalSupervisorTurnStatus = "completed" | "failed" | "inProgress" | "interrupted";
type GlobalSupervisorStepStatus =
  | "completed"
  | "declined"
  | "failed"
  | "inProgress"
  | "interrupted";

/** Bounded read-only projection of one qualified chat's latest turn. */
export type GlobalSupervisorChatInspection = {
  readonly target: GlobalSupervisorQualifiedChatRef;
  readonly turn: {
    readonly id: string;
    readonly status: GlobalSupervisorTurnStatus;
    readonly steps: readonly {
      readonly kind:
        | "collaboration"
        | "command"
        | "fileChange"
        | "function"
        | "imageGeneration"
        | "mcp"
        | "subagent"
        | "tool"
        | "wait"
        | "webSearch";
      readonly name: string;
      readonly outcome: string | null;
      readonly status: GlobalSupervisorStepStatus;
    }[];
    readonly truncated: boolean;
    readonly updates: readonly {
      readonly phase: "commentary" | "final" | "unknown";
      readonly text: string;
    }[];
  } | null;
};

function boundedIdentifier(value: unknown, invalidMessage: string): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID_CHARACTERS) {
    throw new Error(invalidMessage);
  }
  return value;
}

function turnStatus(value: unknown): GlobalSupervisorTurnStatus {
  if (
    value === "completed" ||
    value === "failed" ||
    value === "inProgress" ||
    value === "interrupted"
  ) {
    return value;
  }
  throw new Error("The current chat turn has an invalid status");
}

function stepStatus(value: unknown): GlobalSupervisorStepStatus {
  if (
    value === "completed" ||
    value === "declined" ||
    value === "failed" ||
    value === "inProgress" ||
    value === "interrupted"
  ) {
    return value;
  }
  throw new Error("The current chat step has an invalid status");
}

function safeTechnicalName(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.replaceAll(/\s+/gu, " ").trim();
  if (normalized === "" || !/^[\w./:@-]+$/u.test(normalized)) {
    return fallback;
  }
  return projectGlobalSupervisorSafeText(normalized, MAX_TECHNICAL_NAME_CHARACTERS);
}

function safeUpdateText(value: unknown): string | null {
  if (typeof value !== "string") {
    throw new Error("The current chat update is invalid");
  }
  const projected = projectGlobalSupervisorSafeText(value, MAX_UPDATE_CHARACTERS);
  if (projected === "") {
    return null;
  }
  return projected;
}

function updatePhase(value: unknown): "commentary" | "final" | "unknown" {
  if (value === "commentary") {
    return "commentary";
  }
  if (value === "final_answer") {
    return "final";
  }
  if (value === null || value === undefined) {
    return "unknown";
  }
  throw new Error("The current chat update has an invalid phase");
}

type ProjectedStep = NonNullable<GlobalSupervisorChatInspection["turn"]>["steps"][number];
type ProjectedUpdate = NonNullable<GlobalSupervisorChatInspection["turn"]>["updates"][number];
type CurrentTurnRecord = Readonly<Record<string, unknown>> & {
  readonly items: readonly unknown[];
};

function isCurrentTurnRecord(value: Readonly<Record<string, unknown>>): value is CurrentTurnRecord {
  return Array.isArray(value.items);
}

function numericOutcome(label: string, value: unknown): string | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? `${label}:${String(value)}`
    : null;
}

function booleanOutcome(label: string, value: unknown): string | null {
  return typeof value === "boolean" ? `${label}:${String(value)}` : null;
}

function collectionOutcome(label: string, value: unknown): string | null {
  return Array.isArray(value) ? `${label}:${String(value.length)}` : null;
}

type StepProjector = (item: Readonly<Record<string, unknown>>) => ProjectedStep;

function subagentStatus(value: unknown): GlobalSupervisorStepStatus {
  if (value === "started" || value === "interacted") {
    return "inProgress";
  }
  if (value === "completed") {
    return "completed";
  }
  if (value === "interrupted") {
    return "interrupted";
  }
  throw new Error("The current subagent step has an invalid status");
}

const STEP_PROJECTORS: Readonly<Record<string, StepProjector>> = {
  collabAgentToolCall: (item) => ({
    kind: "collaboration",
    name: safeTechnicalName(item.tool, "collaboration"),
    outcome: collectionOutcome("agents", item.receiverThreadIds),
    status: stepStatus(item.status),
  }),
  commandExecution: (item) => ({
    kind: "command",
    name: "shell",
    outcome: numericOutcome("exitCode", item.exitCode),
    status: stepStatus(item.status),
  }),
  dynamicToolCall: (item) => ({
    kind: "tool",
    name: safeTechnicalName(item.tool, "dynamic tool"),
    outcome: booleanOutcome("success", item.success),
    status: stepStatus(item.status),
  }),
  fileChange: (item) => ({
    kind: "fileChange",
    name: "file changes",
    outcome: collectionOutcome("changes", item.changes),
    status: stepStatus(item.status),
  }),
  functionCallOutput: (item) => ({
    kind: "function",
    name: safeTechnicalName(item.name, "function"),
    outcome: "output received",
    status: "completed",
  }),
  imageGeneration: (item) => ({
    kind: "imageGeneration",
    name: "image generation",
    outcome: item.failure === null || item.failure === undefined ? null : "failed",
    status: stepStatus(item.status),
  }),
  mcpToolCall: (item) => ({
    kind: "mcp",
    name: safeTechnicalName(item.tool, "MCP tool"),
    outcome: null,
    status: stepStatus(item.status),
  }),
  sleep: (item) => ({
    kind: "wait",
    name: "wait",
    outcome: numericOutcome("durationMs", item.durationMs),
    status: "completed",
  }),
  subAgentActivity: (item) => ({
    kind: "subagent",
    name: "subagent",
    outcome: null,
    status: subagentStatus(item.kind),
  }),
  webSearch: () => ({
    kind: "webSearch",
    name: "web search",
    outcome: null,
    status: "completed",
  }),
};

function projectStep(item: Readonly<Record<string, unknown>>): ProjectedStep | null {
  const projector = typeof item.type === "string" ? STEP_PROJECTORS[item.type] : undefined;
  return projector?.(item) ?? null;
}

function projectUpdate(item: Readonly<Record<string, unknown>>): ProjectedUpdate | null {
  if (item.type !== "agentMessage") {
    return null;
  }
  const text = safeUpdateText(item.text);
  return text === null ? null : { phase: updatePhase(item.phase), text };
}

function parseCurrentTurn(value: unknown): CurrentTurnRecord | null {
  const response = unknownRecord(value);
  if (response === null || !Array.isArray(response.data) || response.data.length > 1) {
    throw new Error("The current chat response is invalid");
  }
  const candidate: unknown = response.data[0];
  if (candidate === undefined) {
    return null;
  }
  const turn = unknownRecord(candidate);
  if (turn === null || !isCurrentTurnRecord(turn)) {
    throw new Error("The current chat turn is invalid");
  }
  return turn;
}

function parseCurrentItem(value: unknown): Readonly<Record<string, unknown>> {
  const item = unknownRecord(value);
  if (item === null || typeof item.type !== "string") {
    throw new Error("The current chat item is invalid");
  }
  return item;
}

function collectSteps(items: readonly unknown[]): {
  readonly steps: readonly ProjectedStep[];
  readonly truncated: boolean;
} {
  const steps: ProjectedStep[] = [];
  let projectedCount = 0;
  for (const value of items) {
    const step = projectStep(parseCurrentItem(value));
    if (step === null) {
      continue;
    }
    projectedCount += 1;
    if (steps.length === MAX_STEP_ENTRIES) {
      steps.shift();
    }
    steps.push(step);
  }
  return { steps, truncated: projectedCount > MAX_STEP_ENTRIES };
}

function collectUpdates(items: readonly unknown[]): readonly ProjectedUpdate[] {
  const updates: ProjectedUpdate[] = [];
  for (const value of items) {
    const update = projectUpdate(parseCurrentItem(value));
    if (update === null) {
      continue;
    }
    if (updates.length === MAX_UPDATE_ENTRIES) {
      updates.shift();
    }
    updates.push(update);
  }
  return updates;
}

/** Projects one authoritative current-turn page without tool arguments, paths or raw output. */
export function projectGlobalSupervisorChatInspection(
  value: unknown,
  target: GlobalSupervisorQualifiedChatRef,
): GlobalSupervisorChatInspection {
  const turn = parseCurrentTurn(value);
  if (turn === null) {
    return { target, turn: null };
  }
  const projectedSteps = collectSteps(turn.items);
  return {
    target,
    turn: {
      id: boundedIdentifier(turn.id, "The current chat turn has an invalid identity"),
      status: turnStatus(turn.status),
      steps: projectedSteps.steps,
      truncated: projectedSteps.truncated,
      updates: collectUpdates(turn.items),
    },
  };
}
