import { readThreadAgent, whenThreadAgentSupports as gate } from "../../data/threadAgent";
import type { createConversationScopeBindings } from "./conversationScopeBindings";
import type { RenderConversationWorkspaceContentProps } from "./ConversationWorkspaceContent.types";

type ScopeActions = ReturnType<typeof createConversationScopeBindings>;

/** Thread actions whose availability depends on the bound agent's declared capabilities. */
export type ThreadAgentActions = Pick<
  ScopeActions,
  | "captureGoalLifecycle"
  | "onClearGoal"
  | "onCompact"
  | "onGetGoal"
  | "onListTerminals"
  | "onLoadThreadChangeDiff"
  | "onLoadThreadResources"
  | "onSetGoal"
  | "onSetGoalStatus"
  | "onStartReview"
  | "onTerminateTerminal"
> & {
  readonly onFork: RenderConversationWorkspaceContentProps["forkCurrentThread"] | undefined;
};

/**
 * Removes every thread action whose capability the thread's agent does not declare.
 * Features already render an `undefined` action as a hidden or disabled control, so
 * an unsupported feature never reaches the Companion. A thread without a descriptor
 * (legacy Companion, or a detail snapshot that is not loaded yet) keeps every action.
 */
export function threadAgentActions(
  thread: unknown,
  actions: ScopeActions,
  onFork: RenderConversationWorkspaceContentProps["forkCurrentThread"],
): ThreadAgentActions {
  const agent = readThreadAgent(thread);
  return {
    captureGoalLifecycle: gate(agent, "goals", actions.captureGoalLifecycle),
    onClearGoal: gate(agent, "goals", actions.onClearGoal),
    onCompact: gate(agent, "threads.compact", actions.onCompact),
    onFork: gate(agent, "threads.fork", onFork),
    onGetGoal: gate(agent, "goals", actions.onGetGoal),
    onListTerminals: gate(agent, "backgroundTerminals", actions.onListTerminals),
    onLoadThreadChangeDiff: gate(agent, "history.threadResources", actions.onLoadThreadChangeDiff),
    onLoadThreadResources: gate(agent, "history.threadResources", actions.onLoadThreadResources),
    onSetGoal: gate(agent, "goals", actions.onSetGoal),
    onSetGoalStatus: gate(agent, "goals", actions.onSetGoalStatus),
    onStartReview: gate(agent, "review", actions.onStartReview),
    onTerminateTerminal: gate(agent, "backgroundTerminals", actions.onTerminateTerminal),
  };
}
