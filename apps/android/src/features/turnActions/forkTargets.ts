/**
 * What the "Fork" sheet offers for one thread.
 *
 * The sheet preselects the thread's current model: forking with it keeps the
 * thread's agent and settings and sends no target. Choosing another model is
 * optional and names a target. The thread's own provider's models are offered
 * when its agent declares `threads.fork`, other providers' models when it
 * declares `threads.crossProviderFork`. A legacy thread without a descriptor
 * forks with its own agent and is offered the whole catalog.
 */
import type { ThreadForkTarget } from "../../data/thread-fork";
import {
  readThreadAgent,
  threadAgentDeclares,
  type AgentProviderId,
  type ThreadAgent,
} from "../../data/threadAgent";
import type { TurnControlsModel } from "../../data/turn-controls-types";

/** A catalog model the fork may continue with: only a provider-annotated row can name a target. */
export type ForkModel = TurnControlsModel & { readonly provider: AgentProviderId };

/** The model a fork continues with. */
export type ForkSelection = {
  /**
   * Whether the fork goes to another agent: that agent cannot continue the
   * chat itself and gets a summary of it (the Companion's context handoff).
   */
  readonly handoff: boolean;
  /** Shown name: the catalog label, the bare model id when the catalog lacks it, `null` while unknown. */
  readonly label: string | null;
  /** Model id that marks its catalog row; `null` while unknown. */
  readonly model: string | null;
  readonly provider: AgentProviderId | null;
  /** `null` forks with the thread's own agent and settings. */
  readonly target: ThreadForkTarget | null;
};

/** The fork choices of one thread, read when the user asks to fork. */
export type ForkOffer = {
  /** The thread's current model; `null` when its agent cannot fork into itself. */
  readonly current: ForkSelection | null;
  /** Models the user may switch the fork to, in catalog order. */
  readonly models: readonly ForkModel[];
  /** The thread's own provider; `null` when neither its agent nor the catalog names it. */
  readonly provider: AgentProviderId | null;
};

/** Reads the thread's fork offer at the moment the user asks to fork, never during render. */
export type ReadForkOffer = () => ForkOffer;

/** Whether the thread offers a fork at all: its own fork or a fork into another agent. */
export function threadOffersFork(agent: ThreadAgent | null): boolean {
  return (
    agent === null ||
    threadAgentDeclares(agent, "threads.fork") ||
    threadAgentDeclares(agent, "threads.crossProviderFork")
  );
}

/**
 * The fork offer of `thread` whose server reports `currentModel`, from the
 * provider-aware `catalog`.
 */
export function forkOffer(
  thread: unknown,
  currentModel: string | null,
  catalog: readonly TurnControlsModel[],
): ForkOffer {
  const agent = readThreadAgent(thread);
  const ownFork = agent === null || threadAgentDeclares(agent, "threads.fork");
  const current = ownFork ? currentForkSelection(agent, currentModel, catalog) : null;
  return {
    current,
    models: offeredForkModels(agent, ownFork, catalog),
    provider: agent?.provider ?? current?.provider ?? null,
  };
}

/** The thread provider's models with its own fork, other providers' with a cross-provider fork. */
function offeredForkModels(
  agent: ThreadAgent | null,
  ownFork: boolean,
  catalog: readonly TurnControlsModel[],
): readonly ForkModel[] {
  const crossFork = threadAgentDeclares(agent, "threads.crossProviderFork");
  return catalog.filter(
    (model): model is ForkModel =>
      model.provider !== null &&
      (agent === null || (model.provider === agent.provider ? ownFork : crossFork)),
  );
}

/** The thread's model as the composer resolves it: the thread provider's or an unannotated catalog row. */
function currentForkSelection(
  agent: ThreadAgent | null,
  currentModel: string | null,
  catalog: readonly TurnControlsModel[],
): ForkSelection {
  const ownProvider = agent?.provider ?? null;
  const entry = catalog.find(
    (model) =>
      model.id === currentModel &&
      (ownProvider === null || model.provider === null || model.provider === ownProvider),
  );
  return {
    handoff: false,
    label: entry?.label ?? currentModel,
    model: currentModel,
    provider: entry?.provider ?? ownProvider,
    target: null,
  };
}

/** The selection after the user picks `model`: the current model again forks without a target. */
export function forkSelection(offer: ForkOffer, model: ForkModel): ForkSelection {
  const current = offer.current;
  if (current !== null && current.model === model.id && current.provider === model.provider) {
    return current;
  }
  return {
    handoff: offer.provider !== null && model.provider !== offer.provider,
    label: model.label,
    model: model.id,
    provider: model.provider,
    target: { model: model.id, provider: model.provider },
  };
}

/** Whether the offered models span several providers and are grouped under their headers. */
export function forkModelsSpanProviders(offer: ForkOffer): boolean {
  const first = offer.models[0]?.provider;
  return offer.models.some((model) => model.provider !== first);
}
