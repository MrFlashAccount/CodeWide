import {
  readThreadAgent,
  threadAgentSupports,
  whenThreadAgentSupports as gate,
} from "../../data/threadAgent";
import type {
  ConversationAccountCapabilities,
  ProviderLimitsScope,
} from "../accounts/conversationAccountCapabilities";
import { threadOffersFork } from "../turnActions/forkTargets";
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
 * an unsupported feature never reaches the Companion. Fork stays available when the
 * agent can fork into another agent (`threads.crossProviderFork`) even without its own
 * `threads.fork`; the picker then offers only other agents. A thread without a descriptor
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
    onFork: threadOffersFork(agent) ? onFork : undefined,
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

/**
 * Account rate limits belong to the provider that declares `accounts.rateLimits`.
 * A thread of another provider keeps its context usage but gets no account rows
 * and never reads the account pool; its usage menu shows its own provider's
 * subscription limits from the server's provider list instead (`scope`). A
 * legacy thread keeps the account pool.
 */
export function threadAgentAccounts(
  thread: unknown,
  accounts: Omit<ConversationAccountCapabilities, "providerLimits">,
  scope: ProviderLimitsScope | null,
): ConversationAccountCapabilities {
  const agent = readThreadAgent(thread);
  if (threadAgentSupports(agent, "accounts.rateLimits")) {
    return {
      accountRateLimitsDatabase: accounts.accountRateLimitsDatabase,
      onRefreshAccountRateLimits: accounts.onRefreshAccountRateLimits,
      providerLimits: null,
    };
  }
  const provider = agent?.provider ?? null;
  return {
    accountRateLimitsDatabase: null,
    onRefreshAccountRateLimits: undefined,
    providerLimits:
      scope === null || provider === null
        ? null
        : { agentProviders: scope.agentProviders, connectionId: scope.connectionId, provider },
  };
}
