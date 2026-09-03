import type { V2QueryResult, V2ThreadSettings } from "@codewide/sync-client/v2";

import type { ComposerContextItem } from "../../presentation/input/ComposerContextStripView";
import { newThreadModelActions } from "./newThreadModelControls";
import { accessLabel, permissionMenuActions } from "./newThreadPermissionControls";

export type ModelsResult = Extract<V2QueryResult, { kind: "models.list" }>;

export interface NewThreadSettingsSelection {
  approvalPolicy: V2ThreadSettings["approvalPolicy"];
  effort: V2ThreadSettings["effort"];
  model: V2ThreadSettings["model"];
  personality: V2ThreadSettings["personality"];
  sandbox: V2ThreadSettings["sandbox"];
}

interface NewThreadContextItemsInput {
  error: string | null;
  loading: boolean;
  models: ModelsResult["models"];
  onSelectModel(id: string): void;
  onSelectPermissions(id: string): void;
  selection: NewThreadSettingsSelection;
}

export function defaultNewThreadSettings(): NewThreadSettingsSelection {
  return {
    approvalPolicy: "onRequest",
    effort: null,
    model: null,
    personality: null,
    sandbox: "workspaceWrite",
  };
}

export function modelRows(result: V2QueryResult | null): ModelsResult["models"] {
  return result?.kind === "models.list" ? result.models : [];
}

export function newThreadContextItems(input: NewThreadContextItemsInput): ComposerContextItem[] {
  const { error, loading, models, onSelectModel, onSelectPermissions, selection } = input;
  const model = models.find((candidate) => candidate.id === selection.model) ?? models[0];
  const label = model?.label ?? "Model";
  const effort = selection.effort ?? "default";
  const access = accessLabel(selection);
  return [
    {
      icon: "sparkles",
      id: "model",
      label: `${label} · ${effort}`,
      loading,
      menu: {
        accessibilityLabel: `Model and thinking: ${label}, ${effort}`,
        actions: newThreadModelActions(models, selection, loading, error),
        menuWidth: 344,
        onSelect: onSelectModel,
      },
    },
    {
      icon: "shield",
      id: "permissions",
      label: access,
      menu: {
        accessibilityLabel: `Permissions: ${access}`,
        actions: permissionMenuActions(selection),
        menuWidth: 344,
        onSelect: onSelectPermissions,
      },
    },
  ];
}
