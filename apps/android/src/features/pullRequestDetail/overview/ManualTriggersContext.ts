import { createContext } from "react";

import type {
  CheckTrigger,
  CheckTriggerTarget,
  ForgeCheckTriggers,
  TriggerRun,
} from "../../../data/forgeCheckTriggers";
import type { CheckItem } from "../../../data/forgePullRequestContract";

/** Capability and target supplied by the PR workspace; only an open Checks sheet observes the query. */
export type ManualTriggerAccess = {
  readonly resource: ForgeCheckTriggers;
  readonly target: CheckTriggerTarget;
};

/** Null until the Companion and this PR's provider support manual check actions. */
export const ManualTriggerAccessContext = createContext<ManualTriggerAccess | null>(null);

/** Visible job rows consume these actions independently from the ordinary PR catalog. */
export const ManualTriggersContext = createContext<{
  readonly byCheck: ReadonlyMap<string, readonly CheckTrigger[]>;
  readonly error: string | null;
  readonly open: (check: CheckItem) => void;
  readonly refresh: () => void;
  readonly runs: ReadonlyMap<string, ReadonlyMap<string, TriggerRun>>;
} | null>(null);
