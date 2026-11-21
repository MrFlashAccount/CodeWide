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
import type { ThreadCatalogControls } from "../../../data/threadCatalogControls";
import { readThreadAgent } from "../../../data/threadAgent";
import type { LoadTurnControls, TurnControlsValue } from "../../../data/turn-controls-types";
import { useTurnControlsRow } from "../../../data/use-workspace-resource-row";
import type { WorkspaceResourceDatabase } from "../../../data/workspace-resource-database";
import { useAsyncResource } from "../../../rendering/async-resource-store";
import { colors, iconSize } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import {
  fastServiceTier,
  isFastServiceTier,
  serviceTiersMatch,
} from "../../../ui/modelServiceTier";
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
  catalogControls?: ThreadCatalogControls | null;
  /** The settings owner's state; `null` on a read-only surface without settings commands. */
  controls$: Observable<ComposerControlsState> | null;
  cwd: string;
  detailCursor?: number;
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
  const detailExecution =
    remoteThread === null || remoteThread === undefined
      ? null
      : projectedThreadExecutionSettings(remoteThread);
  const catalogRow = props.catalogControls ?? null;
  const listed =
    !newChat &&
    catalogRow !== null &&
    (detailExecution === null || catalogRow.cursor > (props.detailCursor ?? 0))
      ? catalogRow
      : null;
  const serverExecution = displayExecution(listed, detailExecution);
  const knownThreadModel = serverExecution?.model ?? null;
  const resource = useTurnControlsRow(resources, resourceId);
  useAsyncResource<TurnControlsValue>(
    load === undefined || resourceId === null || (!newChat && knownThreadModel !== null)
      ? null
      : "conversation-turn-controls",
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
  const pending =
    load !== undefined &&
    (newChat ? resource === null || refreshing : (remoteThread ?? null) === null);
  const effectiveError = error ?? resource?.error ?? null;
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
  // The server names the model it runs; a locally chosen model is named by the catalog.
  const serverModelLabel =
    serverExecution !== null && view.model.value === serverExecution.model
      ? (serverExecution.modelLabel ??
        (catalogRow?.model === serverExecution.model ? catalogRow.modelLabel : null))
      : null;
  const displayedModel = view.model.value;
  const displayedEffort = view.effort.value;
  const modelLabel =
    serverModelLabel ??
    view.modelEntry?.label ??
    displayedModel ??
    (pending ? "Loading model…" : "Model not confirmed");
  const modelNameAndEffort =
    displayedEffort === null ? modelLabel : `${modelLabel} · ${modelEffortLabel(displayedEffort)}`;
  const modelProvider =
    view.modelEntry?.provider ?? readThreadAgent(remoteThread)?.provider ?? null;
  const modelIcon =
    modelProvider === null ? (
      <InlineIcon color={colors.textMuted} name="sparkles-outline" role="label" />
    ) : (
      <ProviderIcon provider={modelProvider} />
    );
  // A choice shimmers until the server answers it.
  const modelLoading = initialLoading && (newChat || displayedModel === null);
  const modelTextPending =
    modelLoading || view.model.pending || view.effort.pending || view.serviceTier.pending;
  const fastTier = fastServiceTier(view.modelEntry?.serviceTiers);
  const fast =
    view.modelEntry === undefined
      ? serviceTiersMatch("fast", view.serviceTier.value)
      : fastTier !== undefined && isFastServiceTier(view.serviceTier.value, fastTier);
  const listedPermission = listed?.permissions ?? null;
  const access = serverExecution ?? (listed === null ? null : displayAccess(listed, null));
  const accessKnown =
    view.permissions.value.kind === "profile" ||
    listedPermission !== null ||
    (access?.approvalPolicy ?? null) !== null ||
    (access?.sandboxPolicy ?? null) !== null;
  const accessLoading = initialLoading && (newChat || (!accessKnown && pending));
  const permissionLabel =
    view.permissions.value.kind === "legacy" && listedPermission !== null
      ? permissionProfileLabel(listedPermission)
      : permissionsDisplayLabel(view.permissions.value, access, pending);

  const modelText = modelLoading ? "Loading model…" : modelNameAndEffort;
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
  const permissionsText = accessLoading ? "Loading access…" : permissionLabel;
  const permissionsTrigger = (
    <>
      <InlineIcon color={colors.textMuted} name="shield-checkmark-outline" role="label" />
      <ComposerContextLabel
        loading={accessLoading || view.permissions.pending}
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
            modelLoading
              ? "Loading model"
              : `Model and thinking: ${modelLabel}, ${displayedEffort ?? "not specified"}`
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
          selectedEffort={displayedEffort}
          selectedModel={displayedModel}
          selectedModelLabel={serverModelLabel}
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
          accessibilityLabel={accessLoading ? "Loading access" : `Permissions: ${permissionLabel}`}
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
          selectedPermissions={
            selectedPermissionProfile(view.permissions.value) ?? listedPermission
          }
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
  serverExecution: DisplayAccess | null,
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

/** Uses only fields the newer list row actually knows; older servers omit access entirely. */
function displayExecution(
  listed: ThreadCatalogControls | null,
  detail: ProjectedThreadExecutionSettings | null,
): ProjectedThreadExecutionSettings | null {
  if (listed === null) {
    return detail;
  }
  if (listed.model === null) {
    return detail === null ? null : { ...detail, ...displayAccess(listed, detail) };
  }
  const sameModel =
    detail?.model === listed.model ? detail : { modelLabel: null, serviceTier: undefined };
  return {
    ...displayAccess(listed, detail),
    effort: listed.effort,
    model: listed.model,
    modelLabel: listed.modelLabel ?? sameModel.modelLabel ?? null,
    serviceTier: sameModel.serviceTier,
  };
}

type DisplayAccess = Pick<
  ProjectedThreadExecutionSettings,
  "approvalPolicy" | "permissions" | "sandboxPolicy"
>;

function displayAccess(
  listed: ThreadCatalogControls,
  detail: ProjectedThreadExecutionSettings | null,
): DisplayAccess {
  const policy = listed.accessPolicy ?? null;
  if (policy !== null) {
    return { ...policy, permissions: listed.permissions ?? null };
  }
  if (listed.permissions === undefined && detail !== null) {
    return {
      approvalPolicy: detail.approvalPolicy,
      permissions: detail.permissions,
      sandboxPolicy: detail.sandboxPolicy,
    };
  }
  return { approvalPolicy: null, permissions: listed.permissions ?? null, sandboxPolicy: null };
}
