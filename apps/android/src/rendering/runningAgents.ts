import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { readThreadAgent } from "../data/threadAgent";
import { turnLaunchedAgents } from "./launchedAgents";
import { turnTaskNotifications, type TaskNotificationReport } from "./taskNotifications";

/** A subagent the thread started that has not reported a final result yet. */
export type RunningAgent = {
  readonly agentThreadId: string;
  readonly kind: "agent";
  readonly name: string;
};

const ACTIVE_STATES: ReadonlySet<string> = new Set(["pendingInit", "running"]);
const NONE: readonly RunningAgent[] = [];
const cache = new WeakMap<Thread["turns"], readonly RunningAgent[]>();

/**
 * The subagents still working, in launch order, from the resident turns.
 * Only providers whose children have no live thread of their own (Claude)
 * report child state through the parent: the launch item's state and the
 * later task reports. A primary provider's launch items keep the state they
 * had at launch, so they cannot tell who is still working.
 */
export function selectRunningAgents(thread: Thread | null | undefined): readonly RunningAgent[] {
  if (thread === null || thread === undefined || readThreadAgent(thread)?.primary !== false) {
    return NONE;
  }
  const cached = cache.get(thread.turns);
  if (cached !== undefined) {
    return cached;
  }
  const value = collectRunningAgents(thread.turns);
  cache.set(thread.turns, value);
  return value;
}

function collectRunningAgents(turns: Thread["turns"]): readonly RunningAgent[] {
  const agents = new Map<string, AgentState>();
  for (const turn of turns) {
    recordTurn(agents, turn);
  }
  const running: RunningAgent[] = [];
  for (const [agentThreadId, agent] of agents) {
    if (agent.active) {
      running.push({ agentThreadId, kind: "agent", name: agent.name });
    }
  }
  return running.length === 0 ? NONE : running;
}

type AgentState = { readonly active: boolean; readonly name: string };

/** Applies one turn's launches, then its reports, to the known agents. */
function recordTurn(agents: Map<string, AgentState>, turn: Thread["turns"][number]): void {
  for (const launch of turnLaunchedAgents(turn)) {
    if (launch.agentThreadId !== null) {
      agents.set(launch.agentThreadId, {
        active: launch.launchStatus !== null && ACTIVE_STATES.has(launch.launchStatus),
        name: launch.name,
      });
    }
  }
  const { midTurn, wake } = turnTaskNotifications(turn);
  for (const report of wake) {
    applyReport(agents, report);
  }
  for (const report of midTurn) {
    applyReport(agents, report);
  }
}

function applyReport(agents: Map<string, AgentState>, report: TaskNotificationReport): void {
  const known = report.agentThreadId === null ? undefined : agents.get(report.agentThreadId);
  if (report.agentThreadId !== null && known !== undefined) {
    // An interim report means the agent stopped with work of its own still running.
    agents.set(report.agentThreadId, { active: report.status === "interim", name: known.name });
  }
}
