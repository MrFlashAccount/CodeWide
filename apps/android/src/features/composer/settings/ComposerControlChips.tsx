/** V1 ComposerControlChips owner, extracted without changing interaction or resource lifetime. */
import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { projectedThreadExecutionSettings } from "@codewide/sync-client";
import { View } from "react-native";
import type { TurnControlsValue } from "../../../data/turn-controls-types";
import { useTurnControlsRow } from "../../../data/use-workspace-resource-row";
import type { WorkspaceResourceDatabase } from "../../../data/workspace-resource-database";
import { useAsyncResource } from "../../../rendering/async-resource-store";
import { colors } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { ComposerContextLabel } from "../../../ui/ResourceContextChip";
import { ModelThinkingMenu, PermissionsMenu } from "../../../ui/TurnControlMenus";
import { composerModelSettings } from "../modelSettings";
import {
  EMPTY_TURN_CONTROLS,
  executionPermissionsLabel,
  permissionProfileLabel,
} from "../settings";
import { styles } from "./ComposerControlChips.styles";

export function ComposerControlChips({
  cwd,
  error,
  load,
  newChat,
  onClose,
  onFallback,
  onQuickOpen,
  onSelectEffort,
  onSelectModel,
  onSelectPermissions,
  onSelectPersonality,
  readOnly,
  remoteThread,
  resourceId,
  resources,
  selectedEffort,
  selectedModel,
  selectedPermissions,
  selectedPersonality,
}: {
  cwd: string;
  error: string | null;
  load?: (cwd: string) => Promise<TurnControlsValue>;
  newChat: boolean;
  onClose: (scope: "model-menu" | "permissions-menu") => void;
  onFallback: (page: "model" | "permissions") => void;
  onQuickOpen: (scope: "model-menu" | "permissions-menu") => void;
  onSelectEffort: (effort: string) => void;
  onSelectModel: (model: string, effort: string) => void;
  onSelectPermissions: (permissions: string | null) => void;
  onSelectPersonality: (personality: Personality | null) => void;
  readOnly: boolean;
  remoteThread: Thread | null | undefined;
  resourceId: string | null;
  resources: WorkspaceResourceDatabase | null;
  selectedEffort: string | null;
  selectedModel: string | null;
  selectedPermissions: string | null;
  selectedPersonality: Personality | null;
}) {
  const resource = useTurnControlsRow(resources, resourceId);
  useAsyncResource<TurnControlsValue>(
    load === undefined || resourceId === null ? null : "conversation-turn-controls",
    resourceId ?? "inactive",
    async () => (load === undefined ? EMPTY_TURN_CONTROLS : load(cwd)),
  );
  const controls = resource?.value ?? EMPTY_TURN_CONTROLS;
  const initialLoading =
    load !== undefined &&
    (resource === null || (resource.status === "loading" && resource.value === null));
  const refreshing = resource?.status === "loading" || resource?.status === "refreshing";
  const pending = load !== undefined && (resource === null || refreshing);
  const effectiveError = error ?? resource?.error ?? null;
  const serverExecution =
    remoteThread === null || remoteThread === undefined
      ? null
      : projectedThreadExecutionSettings(remoteThread);
  const { effort: effectiveEffort, model: effectiveModel } = composerModelSettings(
    newChat,
    serverExecution,
    { effort: selectedEffort, model: selectedModel },
    controls,
  );
  const effectivePermissions =
    selectedPermissions ?? serverExecution?.permissions ?? controls.defaults.permissions;
  const modelLabel =
    controls.models.find((candidate) => candidate.id === effectiveModel)?.label ??
    effectiveModel ??
    (pending ? "Loading model…" : "Model not confirmed");
  const modelText = effectiveEffort === null ? modelLabel : `${modelLabel} · ${effectiveEffort}`;
  const permissionLabel =
    effectivePermissions === null
      ? executionPermissionsLabel(serverExecution, pending)
      : permissionProfileLabel(effectivePermissions);
  const modelPending = initialLoading;
  const permissionsPending = initialLoading;
  return (
    <>
      {readOnly ? (
        <View style={styles.composerContextChip} testID="readonly-model-chip">
          <InlineIcon color={colors.textMuted} name="sparkles-outline" role="label" />
          <ComposerContextLabel
            loading={modelPending}
            testID="composer-model-label"
            text={modelPending ? "Loading model…" : modelText}
          />
        </View>
      ) : (
        <ModelThinkingMenu
          accessibilityLabel={
            modelPending
              ? "Loading model"
              : `Model and thinking: ${modelLabel}, ${effectiveEffort ?? "not specified"}`
          }
          error={effectiveError}
          loading={initialLoading}
          models={controls.models}
          onClose={() => {
            onClose("model-menu");
          }}
          onFallbackPress={() => {
            onFallback("model");
          }}
          onOpen={() => {
            onQuickOpen("model-menu");
          }}
          onSelectEffort={onSelectEffort}
          onSelectModel={onSelectModel}
          onSelectPersonality={onSelectPersonality}
          selectedEffort={effectiveEffort}
          selectedModel={effectiveModel}
          selectedPersonality={selectedPersonality}
          triggerChildren={
            <>
              <InlineIcon color={colors.textMuted} name="sparkles-outline" role="label" />
              <ComposerContextLabel
                loading={modelPending}
                testID="composer-model-label"
                text={modelPending ? "Loading model…" : modelText}
              />
            </>
          }
          triggerStyle={styles.composerContextChip}
        />
      )}
      {readOnly ? (
        <View style={styles.composerContextChip} testID="readonly-permissions-chip">
          <InlineIcon color={colors.textMuted} name="shield-checkmark-outline" role="label" />
          <ComposerContextLabel
            loading={permissionsPending}
            testID="composer-permissions-label"
            text={permissionsPending ? "Loading access…" : permissionLabel}
          />
        </View>
      ) : (
        <PermissionsMenu
          accessibilityLabel={
            permissionsPending ? "Loading access" : `Permissions: ${permissionLabel}`
          }
          error={effectiveError}
          loading={initialLoading}
          onClose={() => {
            onClose("permissions-menu");
          }}
          onFallbackPress={() => {
            onFallback("permissions");
          }}
          onOpen={() => {
            onQuickOpen("permissions-menu");
          }}
          onSelectPermissions={onSelectPermissions}
          permissions={controls.permissions}
          selectedPermissions={effectivePermissions}
          triggerChildren={
            <>
              <InlineIcon color={colors.textMuted} name="shield-checkmark-outline" role="label" />
              <ComposerContextLabel
                loading={permissionsPending}
                testID="composer-permissions-label"
                text={permissionsPending ? "Loading access…" : permissionLabel}
              />
            </>
          }
          triggerStyle={styles.composerContextChip}
        />
      )}
    </>
  );
}
