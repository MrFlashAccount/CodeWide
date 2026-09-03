import type { V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import type { QueryResourceHandle } from "../../application/resources/queryResource";
import { ObservableResource } from "../../application/resources/resource";
import {
  defaultNewThreadSettings,
  modelRows,
  type ModelsResult,
  type NewThreadSettingsSelection,
} from "./newThreadControls";
import { effectiveNewThreadSettings, nextModelSelection } from "./newThreadModelControls";
import { nextPermissionSelection } from "./newThreadPermissionControls";

const EMPTY_RESOURCE = new ObservableResource<V2QueryResult | null>(null);

interface UseNewThreadSettingsModelInput {
  initial: NewThreadSettingsSelection | null;
  openingError: string | null;
  resource: QueryResourceHandle | null;
}

export interface NewThreadSettingsModel {
  error: string | null;
  loading: boolean;
  models: ModelsResult["models"];
  selectModel(id: string): NewThreadSettingsSelection | null;
  selectPermissions(id: string): NewThreadSettingsSelection | null;
  settings: NewThreadSettingsSelection;
}

/** Owns model, effort, personality, sandbox, and approval selections for one draft. */
export function useNewThreadSettingsModel(
  input: UseNewThreadSettingsModelInput,
): NewThreadSettingsModel {
  const resource = input.resource ?? EMPTY_RESOURCE;
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const models = modelRows(snapshot.value);
  const [selection, setSelection] = useState(() => input.initial ?? defaultNewThreadSettings());
  const settings = effectiveNewThreadSettings(models, selection);
  const selectModel = useEvent((id: string): NewThreadSettingsSelection | null => {
    const next = nextModelSelection(id, models, settings);
    if (next === null) return null;
    setSelection(next);
    return next;
  });
  const selectPermissions = useEvent((id: string): NewThreadSettingsSelection | null => {
    const next = nextPermissionSelection(id, settings);
    if (next === null) return null;
    setSelection(next);
    return next;
  });
  return {
    error: input.openingError ?? (snapshot.status === "error" ? snapshot.message : null),
    loading:
      input.resource === null || snapshot.status === "loading" || !input.resource.actionable(),
    models,
    selectModel,
    selectPermissions,
    settings,
  };
}
