import { useQuery } from "@tanstack/react-query";
import { useContext, useState, type ReactElement } from "react";

import { classifyForgeError } from "../../../data/forgeErrors";
import {
  useCheckTriggerRuns,
  type CheckTrigger,
  type CheckTriggerTarget,
  type TriggerRun,
} from "../../../data/forgeCheckTriggers";
import type { CheckItem } from "../../../data/forgePullRequestContract";
import { useEvent } from "../../../react/useEvent";
import {
  ManualTriggerAccessContext,
  ManualTriggersContext,
  type ManualTriggerAccess,
} from "./ManualTriggersContext";
import { ManualTriggerPicker } from "./ManualTriggerPicker";

const EMPTY_RUNS = new Map<string, TriggerRun>();
const EMPTY_GROUPS = new Map<string, readonly CheckTrigger[]>();

/** Mounts discovery only for the visible native Checks window of a capable forge. */
export function ManualTriggersHost({
  children,
}: {
  readonly children: ReactElement;
}): React.JSX.Element {
  const access = useContext(ManualTriggerAccessContext);
  return access === null ? children : <ActiveTriggers access={access}>{children}</ActiveTriggers>;
}

function ActiveTriggers({
  access,
  children,
}: {
  readonly access: ManualTriggerAccess;
  readonly children: ReactElement;
}): React.JSX.Element {
  const { resource, target } = access;
  const [picked, setPicked] = useState<PickTarget | null>(null);
  const query = useQuery(
    { ...resource.catalog.options(target), refetchOnMount: "always" },
    resource.catalog.client,
  );
  const refresh = useEvent(() => {
    resource.catalog.refresh(target).catch(() => undefined);
  });
  const open = useEvent((check: CheckItem) => {
    refresh();
    setPicked({ check, target });
  });
  const close = useEvent((origin: PickTarget) => {
    setPicked((current) => (current === origin ? null : current));
  });
  const byCheck = query.data ?? EMPTY_GROUPS;
  const groupRuns = useCheckTriggerRuns(resource.catalog.client, picked?.target ?? target);
  const error = discoveryError(query.error);
  return (
    <ManualTriggersContext.Provider value={{ byCheck, error, open, refresh, runs: groupRuns }}>
      {children}
      {picked === null ? null : (
        <PickedTriggers
          access={access}
          byCheck={byCheck}
          error={error}
          onClose={close}
          picked={picked}
          runs={groupRuns}
        />
      )}
    </ManualTriggersContext.Provider>
  );
}

type PickTarget = { readonly check: CheckItem; readonly target: CheckTriggerTarget };

function discoveryError(error: Error | null): string | null {
  if (error === null) {
    return null;
  }
  const failure = classifyForgeError(error);
  return failure.kind === "companionTooOld"
    ? "Update the companion to use manual actions"
    : failure.message;
}

function PickedTriggers({
  access,
  byCheck,
  error,
  onClose,
  picked,
  runs,
}: {
  readonly access: ManualTriggerAccess;
  readonly byCheck: ReadonlyMap<string, readonly CheckTrigger[]>;
  readonly error: string | null;
  readonly onClose: (origin: PickTarget) => void;
  readonly picked: PickTarget;
  readonly runs: ReadonlyMap<string, ReadonlyMap<string, TriggerRun>>;
}): React.JSX.Element {
  const close = useEvent(() => {
    onClose(picked);
  });
  const stale = picked.target.headRevision !== access.target.headRevision;
  const groups = stale ? access.resource.catalog.data(picked.target) : byCheck;
  return (
    <ManualTriggerPicker
      access={access}
      commands={groups?.get(picked.check.checkId) ?? []}
      error={error}
      onClose={close}
      runs={runs.get(picked.check.checkId) ?? EMPTY_RUNS}
      stale={stale}
    />
  );
}
