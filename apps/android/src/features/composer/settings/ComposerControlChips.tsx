/** V1 ComposerControlChips owner, extracted without changing interaction or resource lifetime. */
import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { projectedThreadExecutionSettings } from "@codewide/sync-client";
import { View } from "react-native";
import { type TurnControlsValue } from "../../../data/turn-controls-types";
import { useTurnControlsRow } from "../../../data/use-workspace-resource-row";
import { type WorkspaceResourceDatabase } from "../../../data/workspace-resource-database";
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
  resources,
  resourceId,
  cwd,
  remoteThread,
  newChat,
  readOnly,
  selectedModel,
  selectedEffort,
  selectedPersonality,
  selectedPermissions,
  error,
  load,
  onQuickOpen,
  onFallback,
  onClose,
  onSelectModel,
  onSelectEffort,
  onSelectPersonality,
  onSelectPermissions,
}: {
  resources: WorkspaceResourceDatabase | null;
  resourceId: string | null;
  cwd: string;
  remoteThread: Thread | null | undefined;
  newChat: boolean;
  readOnly: boolean;
  selectedModel: string | null;
  selectedEffort: string | null;
  selectedPersonality: Personality | null;
  selectedPermissions: string | null;
  error: string | null;
  load?: (cwd: string) => Promise<TurnControlsValue>;
  onQuickOpen(scope: "model-menu" | "permissions-menu"): void;
  onFallback(page: "model" | "permissions"): void;
  onClose(scope: "model-menu" | "permissions-menu"): void;
  onSelectModel(model: string, effort: string): void;
  onSelectEffort(effort: string): void;
  onSelectPersonality(personality: Personality | null): void;
  onSelectPermissions(permissions: string): void;
}) {
  const resource = useTurnControlsRow(resources, resourceId);
  useAsyncResource<TurnControlsValue>(
    load === undefined || resourceId === null ? null : "conversation-turn-controls",
    resourceId ?? "inactive",
    async () => (load === undefined ? EMPTY_TURN_CONTROLS : await load(cwd)),
  );
  const controls = resource?.value ?? EMPTY_TURN_CONTROLS;
  const loading = resource?.status === "loading" && resource.value === null;
  const refreshing = resource?.status === "loading" || resource?.status === "refreshing";
  const pending = load !== undefined && (resource === null || refreshing);
  const effectiveError = error ?? resource?.error ?? null;
  const serverExecution =
    remoteThread === null || remoteThread === undefined
      ? null
      : projectedThreadExecutionSettings(remoteThread);
  const { model: effectiveModel, effort: effectiveEffort } = composerModelSettings(
    newChat,
    serverExecution,
    { model: selectedModel, effort: selectedEffort },
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
  const modelPending = pending && effectiveModel === null;
  const permissionsPending = pending && effectivePermissions === null;
  return (
    <>
      {readOnly ? (
        <View testID="readonly-model-chip" style={styles.composerContextChip}>
          <InlineIcon name="sparkles-outline" role="label" color={colors.textMuted} />
          <ComposerContextLabel
            loading={modelPending}
            testID="composer-model-label"
            text={modelPending ? "Loading model…" : modelText}
          />
        </View>
      ) : (
        <ModelThinkingMenu
          accessibilityLabel={`Model and thinking: ${modelLabel}, ${effectiveEffort ?? "not specified"}`}
          triggerStyle={styles.composerContextChip}
          triggerChildren={
            <>
              <InlineIcon name="sparkles-outline" role="label" color={colors.textMuted} />
              <ComposerContextLabel
                loading={modelPending}
                testID="composer-model-label"
                text={modelPending ? "Loading model…" : modelText}
              />
            </>
          }
          models={controls.models}
          loading={loading}
          error={effectiveError}
          selectedModel={effectiveModel}
          selectedEffort={effectiveEffort}
          selectedPersonality={selectedPersonality}
          onOpen={() => onQuickOpen("model-menu")}
          onClose={() => onClose("model-menu")}
          onFallbackPress={() => onFallback("model")}
          onSelectModel={onSelectModel}
          onSelectEffort={onSelectEffort}
          onSelectPersonality={onSelectPersonality}
        />
      )}
      {readOnly ? (
        <View testID="readonly-permissions-chip" style={styles.composerContextChip}>
          <InlineIcon name="shield-checkmark-outline" role="label" color={colors.textMuted} />
          <ComposerContextLabel
            loading={permissionsPending}
            testID="composer-permissions-label"
            text={permissionsPending ? "Loading access…" : permissionLabel}
          />
        </View>
      ) : (
        <PermissionsMenu
          accessibilityLabel={`Permissions: ${permissionLabel}`}
          triggerStyle={styles.composerContextChip}
          triggerChildren={
            <>
              <InlineIcon name="shield-checkmark-outline" role="label" color={colors.textMuted} />
              <ComposerContextLabel
                loading={permissionsPending}
                testID="composer-permissions-label"
                text={permissionsPending ? "Loading access…" : permissionLabel}
              />
            </>
          }
          permissions={controls.permissions}
          loading={loading}
          error={effectiveError}
          selectedPermissions={effectivePermissions}
          onOpen={() => onQuickOpen("permissions-menu")}
          onClose={() => onClose("permissions-menu")}
          onFallbackPress={() => onFallback("permissions")}
          onSelectPermissions={onSelectPermissions}
        />
      )}
    </>
  );
}
