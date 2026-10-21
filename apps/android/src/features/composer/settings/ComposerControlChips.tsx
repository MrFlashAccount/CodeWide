/** V1 ComposerControlChips owner, extracted without changing interaction or resource lifetime. */
import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import {
  projectedThreadExecutionSettings,
  type ProjectedThreadExecutionSettings,
} from "@codewide/sync-client";
import type { Observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { readThreadAgent } from "../../../data/threadAgent";
import type { LoadTurnControls, TurnControlsValue } from "../../../data/turn-controls-types";
import { useTurnControlsRow } from "../../../data/use-workspace-resource-row";
import type { WorkspaceResourceDatabase } from "../../../data/workspace-resource-database";
import { useAsyncResource } from "../../../rendering/async-resource-store";
import { colors, iconSize } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { fastServiceTier, isFastServiceTier } from "../../../ui/modelServiceTier";
import { modelEffortLabel } from "../../../ui/modelEffortPresentation";
import { ProviderIcon } from "../../../ui/ProviderIcon";
import { ComposerContextLabel } from "../../../ui/ResourceContextChip";
import { ModelThinkingMenu, PermissionsMenu } from "../../../ui/TurnControlMenus";
import type { ModelSettingsChoice } from "../../../ui/TurnControlMenus.types";
import {
  EMPTY_TURN_CONTROLS,
  executionPermissionsLabel,
  permissionProfileLabel,
} from "../settings";
import { styles } from "./ComposerControlChips.styles";
import {
  existingThreadControlsView,
  newChatControlsView,
  selectedPermissionProfile,
  type ComposerPermissionsDisplay,
} from "./composerControlsView";
import { EMPTY_CONTROLS_OVERLAY, type ComposerControlsState } from "./controlsOverlay";
import { modelAgentScope } from "./modelAgentScope";
import { providerScopedControls } from "./providerScopedControls";

/** Props of the composer's model and access chips. */
export type ComposerControlChipsProps = {
  /** The settings owner's state; `null` on a read-only surface without settings commands. */
  controls$: Observable<ComposerControlsState> | null;
  cwd: string;
  error: string | null;
  load?: LoadTurnControls;
  newChat: boolean;
  onApplySettings: (choice: ModelSettingsChoice) => void;
  onClose: (scope: "model-menu" | "permissions-menu") => void;
  onFallback: (page: "model" | "permissions") => void;
  onQuickOpen: (scope: "model-menu" | "permissions-menu") => void;
  onSelectPermissions: (permissions: string | null) => void;
  readOnly: boolean;
  remoteThread: Thread | null | undefined;
  resourceId: string | null;
  resources: WorkspaceResourceDatabase | null;
  selectedEffort: string | null;
  selectedModel: string | null;
  selectedPermissions: string | null;
  selectedPersonality: Personality | null;
  selectedServiceTier: string | null | undefined;
};

/**
 * The model/thinking and access chips. An existing thread shows its server
 * settings with the settings owner's pending local choices over them; a new
 * chat shows its local choices over the catalog defaults.
 */
export function ComposerControlChips(props: ComposerControlChipsProps) {
  const {
    cwd,
    error,
    load,
    newChat,
    onClose,
    onFallback,
    onQuickOpen,
    readOnly,
    remoteThread,
    resourceId,
    resources,
  } = props;
  const resource = useTurnControlsRow(resources, resourceId);
  useAsyncResource<TurnControlsValue>(
    load === undefined || resourceId === null ? null : "conversation-turn-controls",
    resourceId ?? "inactive",
    async () => (load === undefined ? EMPTY_TURN_CONTROLS : load(cwd)),
  );
  const overlay = useSelector(() => props.controls$?.overlay.get() ?? EMPTY_CONTROLS_OVERLAY);
  const catalog = resource?.value ?? EMPTY_TURN_CONTROLS;
  const controls = providerScopedControls(catalog, newChat, remoteThread);
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
  const view = newChat
    ? newChatControlsView(controls, {
        effort: props.selectedEffort,
        model: props.selectedModel,
        permissions: props.selectedPermissions,
        serviceTier: props.selectedServiceTier,
      })
    : existingThreadControlsView({
        agent: readThreadAgent(remoteThread),
        controls,
        overlay,
        server: serverExecution,
      });
  const modelLabel =
    view.modelEntry?.label ??
    view.model.value ??
    (pending ? "Loading model…" : "Model not confirmed");
  const modelNameAndEffort =
    view.effort.value === null
      ? modelLabel
      : `${modelLabel} · ${modelEffortLabel(view.effort.value)}`;
  const modelProvider = view.modelEntry?.provider ?? null;
  const modelIcon =
    modelProvider === null ? (
      <InlineIcon color={colors.textMuted} name="sparkles-outline" role="label" />
    ) : (
      <ProviderIcon provider={modelProvider} />
    );
  // A choice shimmers until the server answers it.
  const modelTextPending =
    initialLoading || view.model.pending || view.effort.pending || view.serviceTier.pending;
  const fastTier = fastServiceTier(view.modelEntry?.serviceTiers);
  const fast = fastTier !== undefined && isFastServiceTier(view.serviceTier.value, fastTier);
  const permissionLabel = permissionsDisplayLabel(view.permissions.value, serverExecution, pending);
  const modelText = initialLoading ? "Loading model…" : modelNameAndEffort;
  const modelTrigger = (
    <>
      {modelIcon}
      <ComposerContextLabel
        loading={modelTextPending}
        testID="composer-model-label"
        text={modelText}
      />
      {fast && <Ionicons color={colors.text} name="flash" size={iconSize.inline} />}
    </>
  );
  const permissionsText = initialLoading ? "Loading access…" : permissionLabel;
  const permissionsTrigger = (
    <>
      <InlineIcon color={colors.textMuted} name="shield-checkmark-outline" role="label" />
      <ComposerContextLabel
        loading={initialLoading || view.permissions.pending}
        testID="composer-permissions-label"
        text={permissionsText}
      />
    </>
  );
  return (
    <>
      {readOnly ? (
        <View
          accessibilityState={{ disabled: true }}
          style={[styles.composerContextChip, styles.disabled]}
          testID="readonly-model-chip"
        >
          {modelTrigger}
        </View>
      ) : (
        <ModelThinkingMenu
          accessibilityLabel={
            initialLoading
              ? "Loading model"
              : `Model and thinking: ${modelLabel}, ${view.effort.value ?? "not specified"}`
          }
          agentScope={modelAgentScope(catalog, newChat)}
          error={effectiveError}
          loading={initialLoading}
          models={controls.models}
          onApplySettings={props.onApplySettings}
          onClose={() => {
            onClose("model-menu");
          }}
          onFallbackPress={() => {
            onFallback("model");
          }}
          onOpen={() => {
            onQuickOpen("model-menu");
          }}
          selectedEffort={view.effort.value}
          selectedModel={view.model.value}
          selectedPersonality={props.selectedPersonality}
          selectedServiceTier={view.serviceTier.value}
          triggerChildren={modelTrigger}
          triggerStyle={styles.composerContextChip}
        />
      )}
      {readOnly ? (
        <View
          accessibilityState={{ disabled: true }}
          style={[styles.composerContextChip, styles.disabled]}
          testID="readonly-permissions-chip"
        >
          {permissionsTrigger}
        </View>
      ) : (
        <PermissionsMenu
          accessibilityLabel={initialLoading ? "Loading access" : `Permissions: ${permissionLabel}`}
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
          onSelectPermissions={props.onSelectPermissions}
          permissions={controls.permissions}
          selectedPermissions={selectedPermissionProfile(view.permissions.value)}
          serverDefault={view.permissionDefault}
          triggerChildren={permissionsTrigger}
          triggerStyle={styles.composerContextChip}
        />
      )}
    </>
  );
}

/** The access chip's text. */
function permissionsDisplayLabel(
  display: ComposerPermissionsDisplay,
  serverExecution: ProjectedThreadExecutionSettings | null,
  pending: boolean,
): string {
  if (display.kind === "profile") {
    return permissionProfileLabel(display.id);
  }
  if (display.kind === "default") {
    return display.resolved === null
      ? pending
        ? "Loading access…"
        : "Server default"
      : permissionProfileLabel(display.resolved);
  }
  return executionPermissionsLabel(serverExecution, pending);
}
