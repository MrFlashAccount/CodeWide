/**
 * What the "Fork" sheet offers for one thread and the choice the user makes.
 *
 * The user picks who continues (an agent), then that agent's model, thinking
 * level and Fast. The sheet preselects the thread's own agent and settings:
 * forking with them unchanged sends no target. The thread's own provider is
 * offered when its agent declares `threads.fork`, other providers when it
 * declares `threads.crossProviderFork`. Another agent cannot continue the chat
 * itself and starts from a summary of it (the Companion's context handoff). A
 * legacy thread without a descriptor forks with its own agent and is offered
 * the whole catalog.
 */
import type { ThreadForkTarget } from "../../data/thread-fork";
import {
  readThreadAgent,
  threadAgentDeclares,
  type AgentProviderId,
  type ThreadAgent,
} from "../../data/threadAgent";
import type { TurnControlsModel } from "../../data/turn-controls-types";
import { clampModelEffort } from "../../ui/modelEffort";
import {
  fastServiceTier,
  retainedServiceTier,
  serviceTiersMatch,
  STANDARD_SERVICE_TIER,
} from "../../ui/modelServiceTier";

/** A catalog model the fork may continue with: only a provider-annotated row can name a target. */
export type ForkModel = TurnControlsModel & { readonly provider: AgentProviderId };

/** The thread's execution settings as the server reports them. */
export type ForkThreadSettings = {
  readonly effort: string | null;
  readonly model: string | null;
  /** The server's name of `model`, shown when the catalog lists it under another id. */
  readonly modelLabel: string | null;
  readonly serviceTier: string | null;
};

/** The agent, model and settings a fork continues with. */
export type ForkSelection = {
  /** Thinking level; `null` leaves the model's default. */
  readonly effort: string | null;
  /**
   * Whether the fork goes to another agent: that agent cannot continue the
   * chat itself and gets a summary of it.
   */
  readonly handoff: boolean;
  /** Shown name: the catalog label, the bare model id when the catalog lacks it, `null` while unknown. */
  readonly label: string | null;
  /** Model id; `null` while unknown. */
  readonly model: string | null;
  readonly provider: AgentProviderId | null;
  /**
   * The offered catalog row with the model's thinking levels and service
   * tiers; `null` for a thread model the offer lacks, which forks only as is.
   */
  readonly row: ForkModel | null;
  /** Service tier id; `null` leaves the server default. */
  readonly serviceTier: string | null;
};

/** One "Who continues" choice. */
export type ForkAgent = {
  /** `false` for the thread's own agent when it cannot fork into itself. */
  readonly available: boolean;
  readonly handoff: boolean;
  readonly provider: AgentProviderId;
};

/** The fork choices of one thread, read when the user asks to fork. */
export type ForkOffer = {
  /** The thread's current settings; `null` when its agent cannot fork into itself. */
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
 * The fork offer of `thread` whose server reports `settings`, from the
 * provider-aware `catalog`.
 */
export function forkOffer(
  thread: unknown,
  settings: ForkThreadSettings,
  catalog: readonly TurnControlsModel[],
): ForkOffer {
  const agent = readThreadAgent(thread);
  const ownFork = agent === null || threadAgentDeclares(agent, "threads.fork");
  const models = offeredForkModels(agent, ownFork, catalog);
  const current = ownFork ? currentForkSelection(agent, settings, catalog) : null;
  return {
    current,
    models,
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
      isForkModel(model) &&
      (agent === null || (model.provider === agent.provider ? ownFork : crossFork)),
  );
}

function isForkModel(model: TurnControlsModel): model is ForkModel {
  return model.provider !== null;
}

/** The thread's settings with its model's catalog row. */
function currentForkSelection(
  agent: ThreadAgent | null,
  settings: ForkThreadSettings,
  catalog: readonly TurnControlsModel[],
): ForkSelection {
  const model = threadCatalogModel(agent?.provider ?? null, settings, catalog);
  return {
    effort: settings.effort,
    handoff: false,
    label: model.label,
    model: settings.model,
    provider: model.provider,
    row: model.row,
    serviceTier: settings.serviceTier,
  };
}

/**
 * The thread's model as the composer resolves it: the thread provider's or an
 * unannotated catalog row, else the server's name of it on the thread's provider.
 */
function threadCatalogModel(
  ownProvider: AgentProviderId | null,
  settings: ForkThreadSettings,
  catalog: readonly TurnControlsModel[],
): Pick<ForkSelection, "label" | "provider" | "row"> {
  const model = settings.model;
  const entry = catalog.find(
    (candidate) =>
      candidate.id === model &&
      (ownProvider === null || candidate.provider === null || candidate.provider === ownProvider),
  );
  if (entry === undefined) {
    return { label: settings.modelLabel ?? model, provider: ownProvider, row: null };
  }
  // With the thread's own fork every annotated row of its provider is offered.
  return isForkModel(entry)
    ? { label: entry.label, provider: entry.provider, row: entry }
    : { label: entry.label, provider: ownProvider, row: null };
}

/** The "Who continues" choices: the thread's own agent first, then the other offered providers. */
export function forkAgents(offer: ForkOffer): readonly ForkAgent[] {
  const agents: ForkAgent[] = [];
  if (offer.provider !== null) {
    agents.push({ available: offer.current !== null, handoff: false, provider: offer.provider });
  }
  for (const model of offer.models) {
    if (!agents.some((agent) => agent.provider === model.provider)) {
      agents.push({
        available: true,
        handoff: forkHandoff(offer, model.provider),
        provider: model.provider,
      });
    }
  }
  return agents;
}

/** The models offered for `provider`; every offered model while the provider is unknown. */
export function forkAgentModels(
  offer: ForkOffer,
  provider: AgentProviderId | null,
): readonly ForkModel[] {
  return provider === null
    ? offer.models
    : offer.models.filter((model) => model.provider === provider);
}

/**
 * The sheet's first choice: the thread's own settings, else the first other
 * agent's default model; `null` when nothing can be forked.
 */
export function initialForkSelection(offer: ForkOffer): ForkSelection | null {
  if (offer.current !== null) {
    return offer.current;
  }
  const agent = forkAgents(offer).find((candidate) => candidate.available);
  return agent === undefined ? null : forkAgentSelection(offer, agent.provider);
}

/** The choice after the user picks the `provider` agent: its own settings or that agent's default model. */
export function forkAgentSelection(
  offer: ForkOffer,
  provider: AgentProviderId,
): ForkSelection | null {
  if (offer.current !== null && offer.current.provider === provider) {
    return offer.current;
  }
  const models = forkAgentModels(offer, provider);
  const model = models.find((candidate) => candidate.isDefault) ?? models[0];
  return model === undefined
    ? null
    : modelSelection(offer, model, { effort: model.defaultEffort, serviceTier: null });
}

/**
 * The choice after the user picks `model`: the current model again restores
 * the thread's settings; another keeps the chosen thinking level and Fast
 * when the model offers them.
 */
export function forkModelSelection(
  offer: ForkOffer,
  selection: ForkSelection,
  model: ForkModel,
): ForkSelection {
  const current = offer.current;
  if (current !== null && current.model === model.id && current.provider === model.provider) {
    return current;
  }
  return modelSelection(offer, model, {
    effort: clampModelEffort(model, selection.effort),
    serviceTier: retainedServiceTier(selection.serviceTier, model.serviceTiers) ?? null,
  });
}

function modelSelection(
  offer: ForkOffer,
  model: ForkModel,
  settings: Pick<ForkSelection, "effort" | "serviceTier">,
): ForkSelection {
  return {
    effort: settings.effort,
    handoff: forkHandoff(offer, model.provider),
    label: model.label,
    model: model.id,
    provider: model.provider,
    row: model,
    serviceTier: settings.serviceTier,
  };
}

/** Whether Fast is on for the selection's model; `false` when the model has no Fast tier. */
export function forkFastEnabled(selection: ForkSelection): boolean {
  const fast = fastServiceTier(selection.row?.serviceTiers);
  return (
    fast !== undefined &&
    selection.serviceTier !== null &&
    serviceTiersMatch(selection.serviceTier, fast.id)
  );
}

/** The choice with Fast switched on or to explicit standard routing. */
export function forkFastSelection(selection: ForkSelection, enabled: boolean): ForkSelection {
  const fast = fastServiceTier(selection.row?.serviceTiers);
  if (fast === undefined) {
    return selection;
  }
  return { ...selection, serviceTier: enabled ? fast.id : STANDARD_SERVICE_TIER };
}

/**
 * What `thread/fork` names for `selection`: `null` while it is the thread's
 * own agent and settings, so an unchanged fork is the plain request.
 */
export function forkTarget(offer: ForkOffer, selection: ForkSelection): ThreadForkTarget | null {
  const row = selection.row;
  if (sameSettings(offer.current, selection) || row === null) {
    return null;
  }
  return {
    effort: selection.effort,
    model: row.id,
    provider: row.provider,
    serviceTier: selection.serviceTier,
  };
}

function sameSettings(current: ForkSelection | null, selection: ForkSelection): boolean {
  return (
    current !== null &&
    current.provider === selection.provider &&
    current.model === selection.model &&
    current.effort === selection.effort &&
    serviceTiersMatch(current.serviceTier, selection.serviceTier)
  );
}

function forkHandoff(offer: ForkOffer, provider: AgentProviderId): boolean {
  return offer.provider !== null && provider !== offer.provider;
}
