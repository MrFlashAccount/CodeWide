import {
  type Mutation,
  MutationObserver,
  type QueryClient,
  useMutationState,
} from "@tanstack/react-query";

import {
  parseActionCatalog,
  type ActionDescriptor,
  type DroppedActionReporter,
} from "./forgeActionCatalog";
import { classifyForgeError, ForgeContractViolation } from "./forgeErrors";
import { decodeOrNull, nonEmptyText, optionalText, record } from "./forgeWire";
import type { OverviewParams } from "./forgeOverview";
import type { HeadRevision } from "./forgeContract";
import { createForgeQueryResource, type ForgeQueryResource } from "./forgeQueryResource";

/** One provider-defined action offered by one job on the current PR revision. */
export type CheckTrigger = {
  readonly actionId: string;
  readonly availability: ActionDescriptor["availability"];
  readonly checkId: string;
  readonly label: string;
};

/** Capability scope. Actions read on a previous revision cannot be submitted on the new head. */
export type CheckTriggerTarget = OverviewParams & { readonly headRevision: HeadRevision };

type TriggerCatalog = ReadonlyMap<string, readonly CheckTrigger[]>;
type Call = (connectionId: string, method: string, params: unknown) => Promise<unknown>;

/** Head-bound catalog and one-shot writes. Neither trigger discovery nor manual launches are persisted. */
export type ForgeCheckTriggers = {
  readonly catalog: ForgeQueryResource<CheckTriggerTarget, TriggerCatalog>;
  readonly run: (
    target: CheckTriggerTarget,
    selected: readonly CheckTrigger[],
    newKey: () => string,
  ) => Promise<boolean>;
};

function parseTriggers(
  raw: unknown,
  head: HeadRevision,
  report: DroppedActionReporter,
): TriggerCatalog {
  const parsed = parseActionCatalog(raw, report);
  if (parsed === null || parsed.headRevision !== head) {
    throw new ForgeContractViolation("manual triggers for this revision");
  }
  const groups = new Map<string, CheckTrigger[]>();
  const ids = new Set<string>();
  for (const action of parsed.actions) {
    const trigger = checkTrigger(action);
    if (ids.has(trigger.actionId)) {
      throw new ForgeContractViolation("distinct manual trigger ids");
    }
    ids.add(trigger.actionId);
    const group = groups.get(trigger.checkId);
    if (group === undefined) {
      groups.set(trigger.checkId, [trigger]);
    } else {
      group.push(trigger);
    }
  }
  return groups;
}

function checkTrigger(action: ActionDescriptor): CheckTrigger {
  if (
    action.kind !== "manualTrigger" ||
    action.anchor?.kind !== "checks" ||
    action.anchor.checkId === "" ||
    action.confirm !== "none" ||
    action.input !== null ||
    action.toggle !== null
  ) {
    throw new ForgeContractViolation("manual check trigger");
  }
  return {
    actionId: action.actionId,
    availability: action.availability,
    checkId: action.anchor.checkId,
    label: action.label,
  };
}

function writeKey(target: CheckTriggerTarget): readonly string[] {
  return ["forge", "manualTrigger", target.connectionId, target.pullRequest, target.headRevision];
}

type Boundary = {
  readonly call: Call;
  readonly client: QueryClient;
  readonly report: DroppedActionReporter;
};

/** Builds the live Checks resource on the workspace's shared query and mutation cache. */
export function createForgeCheckTriggers(boundary: Boundary): ForgeCheckTriggers {
  const { call, client, report } = boundary;
  const catalog = createForgeQueryResource<CheckTriggerTarget, TriggerCatalog>({
    client,
    keyOf: (target) => [
      "forge",
      "checkTriggers",
      target.connectionId,
      target.pullRequest,
      target.headRevision,
    ],
    load: async (target) =>
      parseTriggers(
        await call(target.connectionId, "companion/pullRequest/checkTriggers/read", {
          headRevision: target.headRevision,
          pullRequest: target.pullRequest,
        }),
        target.headRevision,
        report,
      ),
  });
  return {
    catalog,
    async run(target, selected, newKey) {
      // The Companion revalidates the exact job at write time. Looking up a known descriptor on the client never rereads all CI launches.
      const attempts = await Promise.allSettled(
        selected.map(async (trigger) => {
          const key = [...writeKey(target), trigger.checkId, trigger.actionId];
          if (alreadySubmitted(client, key)) {
            return false;
          }
          const observer = new MutationObserver(client, {
            meta: { triggerLabel: trigger.label },
            mutationFn: async () => {
              const allowed = authorizedTrigger(catalog.data(target), trigger);
              return launch(boundary.call, target, { idempotencyKey: newKey(), trigger: allowed });
            },
            mutationKey: key,
            networkMode: "always",
            retry: false,
          });
          try {
            await observer.mutate(undefined);
            return true;
          } finally {
            observer.reset();
          }
        }),
      );
      await Promise.allSettled([
        catalog.invalidate(target),
        client.invalidateQueries({
          queryKey: ["forge", "overview", target.connectionId, target.pullRequest],
        }),
      ]);
      return attempts.every((attempt) => attempt.status === "fulfilled" && attempt.value);
    },
  };
}

function alreadySubmitted(client: QueryClient, mutationKey: readonly string[]): boolean {
  const latest = client.getMutationCache().findAll({ exact: true, mutationKey }).at(-1)?.state;
  return (
    latest?.status === "pending" ||
    latest?.status === "success" ||
    latest?.error?.name === UNKNOWN_OUTCOME_NAME
  );
}

function authorizedTrigger(catalog: TriggerCatalog | null, trigger: CheckTrigger): CheckTrigger {
  const current = catalog?.get(trigger.checkId)?.find((item) => item.actionId === trigger.actionId);
  if (current === undefined || current.label !== trigger.label) {
    throw new Error("This action is no longer available");
  }
  if (current.availability.state === "disabled") {
    throw new Error(current.availability.reason);
  }
  return current;
}

async function launch(
  call: Call,
  target: CheckTriggerTarget,
  { idempotencyKey, trigger }: { readonly idempotencyKey: string; readonly trigger: CheckTrigger },
): Promise<string> {
  try {
    const raw = await call(target.connectionId, "companion/pullRequest/action/run", {
      actionId: trigger.actionId,
      confirmation: "none",
      headRevision: target.headRevision,
      idempotencyKey,
      input: null,
      pullRequest: target.pullRequest,
      triggerCheckId: trigger.checkId,
    });
    const result = decodeOrNull(() => {
      const ack = record(raw, "result");
      nonEmptyText(ack.runId, "runId");
      return {
        message: optionalText(ack.message, "message"),
        openUrl: optionalText(ack.openUrl ?? null, "openUrl"),
      };
    });
    if (result === null) {
      throw new ForgeContractViolation("check action result");
    }
    if (result.openUrl !== null) {
      return "Check the job viewer to finish";
    }
    return result.message ?? "Requested";
  } catch (error) {
    const failure = classifyForgeError(error);
    if (
      failure.kind === "outcomeUnknown" ||
      failure.kind === "unreachable" ||
      failure.kind === "contractViolation"
    ) {
      throw new UnknownTriggerOutcome("Outcome unknown", { cause: error });
    }
    throw new Error(failure.message, { cause: error });
  }
}

const UNKNOWN_OUTCOME_NAME = "UnknownTriggerOutcome";
class UnknownTriggerOutcome extends Error {
  override readonly name = UNKNOWN_OUTCOME_NAME;
}

function runError(error: Error | null): Pick<TriggerRun, "message" | "progress"> {
  return error === null || error.name === UNKNOWN_OUTCOME_NAME
    ? { message: "Outcome unknown. Check the job viewer before trying again.", progress: "unknown" }
    : { message: error.message, progress: "error" };
}

/** The last result of each individually submitted action survives dismissing the picker during the run. */
export type TriggerRun = {
  readonly actionId: string;
  readonly checkId: string;
  readonly label: string;
  readonly message: string;
  readonly progress: "pending" | "sent" | "error" | "unknown";
};

/** Observes only launches for this exact job, PR and head, including actions the forge has since removed. */
export function useCheckTriggerRuns(
  client: QueryClient,
  target: CheckTriggerTarget,
): ReadonlyMap<string, ReadonlyMap<string, TriggerRun>> {
  const prefix = writeKey(target);
  const attempts = useMutationState<TriggerRun | null>(
    {
      filters: { mutationKey: prefix },
      select: receiptOf,
    },
    client,
  );
  const byCheck = new Map<string, Map<string, TriggerRun>>();
  for (const attempt of attempts) {
    if (attempt !== null) {
      const group = byCheck.get(attempt.checkId);
      if (group === undefined) {
        byCheck.set(attempt.checkId, new Map([[attempt.actionId, attempt]]));
      } else {
        group.set(attempt.actionId, attempt);
      }
    }
  }
  return byCheck;
}

const CHECK_KEY_FROM_END = -2;

function receiptOf(mutation: Mutation): TriggerRun | null {
  const actionId = mutation.options.mutationKey?.at(-1);
  const checkId = mutation.options.mutationKey?.at(CHECK_KEY_FROM_END);
  const label = mutation.meta?.triggerLabel;
  if (typeof actionId !== "string" || typeof label !== "string" || typeof checkId !== "string") {
    return null;
  }
  return { actionId, checkId, label, ...outcome(mutation.state) };
}

function outcome(state: Mutation["state"]): Pick<TriggerRun, "message" | "progress"> {
  if (state.status === "error") {
    return runError(state.error);
  }
  if (state.status === "success") {
    return { message: typeof state.data === "string" ? state.data : "Requested", progress: "sent" };
  }
  return { message: "", progress: "pending" };
}
