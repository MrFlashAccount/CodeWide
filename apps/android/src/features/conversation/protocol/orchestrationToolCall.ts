/**
 * Readable rows for CodeWide's agent orchestration tools.
 *
 * The Companion gives every agent the neutral client tools `codewide_spawn_agent`,
 * `codewide_wait_agent`, `codewide_send_agent`, `codewide_cancel_agent` and
 * `codewide_list_agents`; their calls arrive as `dynamicToolCall` items whose
 * result text is the tool's JSON result. This projection turns one such item into
 * a compact title, an optional detail line and the child agent thread the row
 * opens. Other tools return `null` and keep the generic tool card. Pure.
 */
import { unknownRecord } from "../../../data/unknownRecord";

/** One orchestration tool call, ready for its timeline row. */
export type OrchestrationToolCall = {
  /** Secondary text: the task, the agent's final message, a summary or the error. */
  readonly detail: string | null;
  readonly failed: boolean;
  /** Short trailing label, such as the model. */
  readonly meta: string | null;
  /** Provider id of the agent a spawn started, for its mark; `null` for other calls. */
  readonly provider: string | null;
  readonly running: boolean;
  /** The child agent thread the row opens, when the call names one. */
  readonly targetThreadId: string | null;
  readonly title: string;
};

type OrchestrationTool = "cancel" | "list" | "send" | "spawn" | "wait";

const TOOLS: Readonly<Record<string, OrchestrationTool>> = {
  codewide_cancel_agent: "cancel",
  codewide_list_agents: "list",
  codewide_send_agent: "send",
  codewide_spawn_agent: "spawn",
  codewide_wait_agent: "wait",
};

const DETAIL_CHARACTERS = 280;
const SHORT_ID_CHARACTERS = 8;

type Fields = Readonly<Record<string, unknown>>;

type CallInput = {
  readonly args: Fields;
  readonly error: string | null;
  readonly result: Fields | null;
  readonly running: boolean;
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;

function clipped(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const line = value.replaceAll(/\s+/gu, " ");
  return line.length > DETAIL_CHARACTERS ? `${line.slice(0, DETAIL_CHARACTERS - 1)}…` : line;
}

/** Provider ids are shown as names: `codex` → `Codex`. */
function providerName(value: unknown): string | null {
  const id = text(value);
  return id === null ? null : `${id.slice(0, 1).toUpperCase()}${id.slice(1)}`;
}

/** Text of the result's content items, joined. */
function resultText(raw: Fields): string | null {
  const items: readonly unknown[] = Array.isArray(raw.contentItems) ? raw.contentItems : [];
  const parts = items.flatMap((item) => {
    const value = text(unknownRecord(item)?.text);
    return value === null ? [] : [value];
  });
  return parts.length === 0 ? null : parts.join("\n");
}

function parsedObject(value: string | null): Fields | null {
  if (value === null) {
    return null;
  }
  try {
    return unknownRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

/** The agent a call names: its given name, otherwise a short form of its thread id. */
function agentLabel(name: unknown, threadId: string | null): string {
  const given = text(name);
  if (given !== null) {
    return given;
  }
  return threadId === null ? "agent" : `agent ${threadId.slice(0, SHORT_ID_CHARACTERS)}`;
}

/** The title for the call's phase: failed, still running or done. */
function phaseTitle(
  call: CallInput,
  titles: { readonly done: string; readonly failed: string; readonly running: string },
): string {
  if (call.error !== null) {
    return titles.failed;
  }
  return call.running ? titles.running : titles.done;
}

/** "Codex agent “reviewer”": the spawned agent's provider and given name, when known. */
function spawnedAgent(call: CallInput): string {
  const provider = providerName(call.result?.provider ?? call.args.provider);
  const name = text(call.args.name);
  const named = name === null ? "agent" : `agent “${name}”`;
  return provider === null ? named : `${provider} ${named}`;
}

function spawnCall(call: CallInput): OrchestrationToolCall {
  const agent = spawnedAgent(call);
  return {
    detail: clipped(call.error ?? text(call.args.prompt)),
    failed: call.error !== null,
    meta: text(call.result?.model ?? call.args.model),
    provider: text(call.result?.provider ?? call.args.provider),
    running: call.running,
    targetThreadId: text(call.result?.agentThreadId),
    title: phaseTitle(call, {
      done: `Spawned ${agent}`,
      failed: "Could not start an agent",
      running: `Starting ${agent}`,
    }),
  };
}

/** How a finished wait reads, by the agent's reported status. */
const WAIT_OUTCOMES: Readonly<Record<string, string>> = {
  completed: "finished",
  failed: "failed",
  interrupted: "was interrupted",
};

function waitOutcome(status: string | null): string {
  const outcome =
    status !== null && Object.hasOwn(WAIT_OUTCOMES, status) ? WAIT_OUTCOMES[status] : undefined;
  return outcome ?? "is still running";
}

function waitCall(call: CallInput, threadId: string | null): OrchestrationToolCall {
  const label = agentLabel(null, threadId);
  const status = text(call.result?.status);
  return {
    detail: clipped(call.error ?? text(call.result?.finalMessage)),
    failed: call.error !== null || status === "failed",
    meta: null,
    provider: null,
    running: call.running,
    targetThreadId: threadId,
    title: phaseTitle(call, {
      done: `${label} ${waitOutcome(status)}`,
      failed: `Could not wait for ${label}`,
      running: `Waiting for ${label}`,
    }),
  };
}

function messageCall(call: CallInput, threadId: string | null): OrchestrationToolCall {
  const label = agentLabel(null, threadId);
  return {
    detail: clipped(call.error ?? text(call.args.message)),
    failed: call.error !== null,
    meta: null,
    provider: null,
    running: call.running,
    targetThreadId: threadId,
    title: phaseTitle(call, {
      done: call.args.mode === "steer" ? `Steered ${label}` : `Sent a message to ${label}`,
      failed: `Could not message ${label}`,
      running: `Messaging ${label}`,
    }),
  };
}

function cancelCall(call: CallInput, threadId: string | null): OrchestrationToolCall {
  const label = agentLabel(null, threadId);
  return {
    detail: clipped(call.error),
    failed: call.error !== null,
    meta: null,
    provider: null,
    running: call.running,
    targetThreadId: threadId,
    title: phaseTitle(call, {
      done: `Cancelled ${label}`,
      failed: `Could not cancel ${label}`,
      running: `Cancelling ${label}`,
    }),
  };
}

function listSummary(agents: readonly unknown[]): string | null {
  const lines = agents.flatMap((value) => {
    const agent = unknownRecord(value);
    if (agent === null) {
      return [];
    }
    const label = agentLabel(agent.name, text(agent.agentThreadId));
    const parts = [label, providerName(agent.provider), text(agent.status)].filter(
      (part) => part !== null,
    );
    return [parts.join(" · ")];
  });
  return lines.length === 0 ? null : lines.join(", ");
}

function listCall(call: CallInput): OrchestrationToolCall {
  const listed = call.result?.agents;
  const agents: readonly unknown[] = Array.isArray(listed) ? listed : [];
  const count = agents.length;
  return {
    detail: clipped(call.error ?? listSummary(agents)),
    failed: call.error !== null,
    meta: null,
    provider: null,
    running: call.running,
    targetThreadId: null,
    title: phaseTitle(call, {
      done: `Listed ${String(count)} ${count === 1 ? "agent" : "agents"}`,
      failed: "Could not list agents",
      running: "Listing agents",
    }),
  };
}

type Projection = (call: CallInput, threadId: string | null) => OrchestrationToolCall;

const PROJECTIONS: Readonly<Record<OrchestrationTool, Projection>> = {
  cancel: cancelCall,
  list: listCall,
  send: messageCall,
  spawn: spawnCall,
  wait: waitCall,
};

function toolOf(raw: Fields): OrchestrationTool | null {
  const name = text(raw.tool);
  const tool = name !== null && Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined;
  return tool ?? null;
}

const isRunning = (raw: Fields, status: string | null): boolean =>
  status === "inProgress" || status === "running" || raw.status === "inProgress";

/** Arguments, result or error and phase of one call. */
function callInput(raw: Fields, status: string | null): CallInput {
  const output = resultText(raw);
  const failed = raw.success === false || status === "failed";
  const running = isRunning(raw, status);
  return {
    args: unknownRecord(raw.arguments) ?? {},
    error: failed ? (output ?? "The tool call failed.") : null,
    result: failed ? null : parsedObject(output),
    running: running && !failed,
  };
}

/** The orchestration row of a `dynamicToolCall` payload, or `null` for any other tool. */
export function orchestrationToolCall(
  raw: Fields,
  status: string | null,
): OrchestrationToolCall | null {
  const tool = toolOf(raw);
  if (tool === null) {
    return null;
  }
  const call = callInput(raw, status);
  return PROJECTIONS[tool](call, text(call.args.agentThreadId));
}
