/** V1 settings owner, extracted without changing interaction or resource lifetime. */
import { projectedThreadExecutionSettings } from "@codewide/sync-client";
import type { TurnControlsValue } from "../../data/turn-controls-types";

export function executionPermissionsLabel(
  settings: ReturnType<typeof projectedThreadExecutionSettings>,
  pending = true,
): string {
  if (settings?.permissions !== null && settings?.permissions !== undefined)
    return permissionProfileLabel(settings.permissions);
  const sandbox =
    settings?.sandboxPolicy === "dangerFullAccess"
      ? "Full access"
      : settings?.sandboxPolicy === "workspaceWrite"
        ? "Workspace"
        : settings?.sandboxPolicy === "readOnly"
          ? "Read only"
          : settings?.sandboxPolicy === "externalSandbox"
            ? "External sandbox"
            : null;
  const approval =
    settings?.approvalPolicy === "on-request"
      ? "Ask"
      : settings?.approvalPolicy === "untrusted"
        ? "Untrusted"
        : settings?.approvalPolicy === "never"
          ? null
          : settings?.approvalPolicy === "granular"
            ? "Granular"
            : null;
  if (sandbox !== null && approval !== null) return `${sandbox} · ${approval}`;
  return sandbox ?? approval ?? (pending ? "Loading access…" : "Access unavailable");
}

export function permissionProfileLabel(id: string): string {
  if (id === ":workspace") return "Workspace";
  if (id === ":read-only") return "Read only";
  if (id === ":full-access" || id === ":danger-full-access") return "Full access";
  return id.startsWith(":") ? id.slice(1).replaceAll("-", " ") : id;
}

export const EMPTY_TURN_CONTROLS: TurnControlsValue = {
  models: [],
  skills: [],
  permissions: [],
  defaults: { model: null, effort: null, permissions: null },
};

import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import type { StoredComposerPreferences } from "../../data/thread-ui-state-types";
import type { TurnControlsRow } from "../../data/workspace-resource-database";
import { useEvent } from "../../react/useEvent";
import { useConversationRef, useConversationState } from "../../ui/use-conversation-scope";
import type { ComposerSettingsCapabilities } from "./settingsCapabilities";
import { rollbackOwnedModelSelection } from "./submissionRecovery";
export function useComposerSettings({
  composerScope,
  newChat,
  cwd,
  draftConnectionId,
  draftThreadId,
  workspaceResources,
  controlsResourceId,
  composerPreferences,
  latestComposerPreferencesRef,
  conversationOwner,
  onLoadControls,
  onUpdateSettings,
  saveComposerPreferences,
}: ComposerSettingsCapabilities) {
  const readCurrentControls = (): TurnControlsRow | null =>
    workspaceResources === null || controlsResourceId === null
      ? null
      : (workspaceResources.turnControls.get(controlsResourceId) ?? null);
  const currentControlsResource = useEvent(readCurrentControls);
  const captureControlsResource = useEvent(() => readCurrentControls);

  const [controlError, setControlError] = useConversationState<string | null>(
    composerScope,
    () => null,
  );

  const updateCurrentPreferences = (
    apply: (current: StoredComposerPreferences) => StoredComposerPreferences,
  ) => {
    const next = apply(latestComposerPreferencesRef.current.latest);
    latestComposerPreferencesRef.current.latest = next;
    if (
      saveComposerPreferences !== undefined &&
      draftConnectionId !== null &&
      draftThreadId !== null
    ) {
      void saveComposerPreferences(draftConnectionId, draftThreadId, next).catch(() => undefined);
    }
  };

  // Existing threads are configured via thread/settings/update. Re-sending a
  // persisted local choice would undo model changes made on another device.
  const selectedModel = newChat ? composerPreferences.model : null;

  const selectedEffort = newChat ? composerPreferences.effort : null;

  const selectedPersonality = composerPreferences.personality;

  const selectedPermissions = composerPreferences.permissions;

  const setSelectedModel = (apply: (current: string | null) => string | null) =>
    updateCurrentPreferences((current) => ({ ...current, model: apply(current.model) }));
  const setSelectedEffort = (value: string | null) =>
    updateCurrentPreferences((current) => ({ ...current, effort: value }));
  const updateSelectedEffort = (apply: (current: string | null) => string | null) =>
    updateCurrentPreferences((current) => ({ ...current, effort: apply(current.effort) }));
  const setSelectedPersonality = useEvent((value: Personality | null) =>
    updateCurrentPreferences((current) => ({ ...current, personality: value })),
  );
  const setSelectedPermissions = (value: string | null) =>
    updateCurrentPreferences((current) => ({ ...current, permissions: value }));
  const updateSelectedPermissions = (apply: (current: string | null) => string | null) =>
    updateCurrentPreferences((current) => ({
      ...current,
      permissions: apply(current.permissions),
    }));

  const settingsMutationRef = useConversationRef(composerScope, () => ({
    model: 0,
    effort: 0,
    permissions: 0,
  }));

  const requestControls = useEvent(() => {
    const current = currentControlsResource();
    if (onLoadControls === undefined || (current?.status === "loading" && current.value === null))
      return;
    setControlError(null);
    void onLoadControls(cwd)
      .then((next) => {
        if (!conversationOwner.isCurrent()) return;
        setSelectedModel((current) =>
          current !== null && !next.models.some((candidate) => candidate.id === current)
            ? null
            : current,
        );
        updateSelectedEffort((current) =>
          current !== null && !next.models.some((candidate) => candidate.efforts.includes(current))
            ? null
            : current,
        );
      })
      .catch((cause) => {
        if (!conversationOwner.isCurrent()) return;
        setControlError(cause instanceof Error ? cause.message : "Could not load turn controls");
      });
  });

  const selectModel = useEvent((model: string, effort: string) => {
    const modelMutation = ++settingsMutationRef.current.model;
    const effortMutation = ++settingsMutationRef.current.effort;
    const previousModel = selectedModel;
    const previousEffort = selectedEffort;
    updateCurrentPreferences((current) => ({ ...current, model, effort }));
    if (onUpdateSettings === undefined) return;
    setControlError(null);
    void onUpdateSettings({ model, effort }).catch((cause) => {
      const ownsModel = settingsMutationRef.current.model === modelMutation;
      const ownsEffort = settingsMutationRef.current.effort === effortMutation;
      if (
        (ownsModel || ownsEffort) &&
        (conversationOwner.isCurrent() || !conversationOwner.hasReplacement())
      ) {
        updateCurrentPreferences((current) => ({
          ...current,
          ...rollbackOwnedModelSelection(
            current,
            { model, effort },
            { model: previousModel, effort: previousEffort },
            { model: ownsModel, effort: ownsEffort },
          ),
        }));
      }
      if ((ownsModel || ownsEffort) && conversationOwner.isCurrent()) {
        setControlError(cause instanceof Error ? cause.message : "Could not update model settings");
      }
    });
  });

  const selectEffort = useEvent((effort: string) => {
    const mutation = ++settingsMutationRef.current.effort;
    const previous = selectedEffort;
    setSelectedEffort(effort);
    if (onUpdateSettings === undefined) return;
    setControlError(null);
    void onUpdateSettings({ effort }).catch((cause) => {
      const ownsMutation = settingsMutationRef.current.effort === mutation;
      if (ownsMutation && (conversationOwner.isCurrent() || !conversationOwner.hasReplacement())) {
        updateSelectedEffort((current) => (current === effort ? previous : current));
      }
      if (ownsMutation && conversationOwner.isCurrent()) {
        setControlError(
          cause instanceof Error ? cause.message : "Could not update thinking effort",
        );
      }
    });
  });

  const selectPermissions = useEvent((permissions: string | null) => {
    const mutation = ++settingsMutationRef.current.permissions;
    const previous = selectedPermissions;
    setSelectedPermissions(permissions);
    if (onUpdateSettings === undefined) return;
    setControlError(null);
    void onUpdateSettings({ permissions }).catch((cause) => {
      const ownsMutation = settingsMutationRef.current.permissions === mutation;
      if (ownsMutation && (conversationOwner.isCurrent() || !conversationOwner.hasReplacement())) {
        updateSelectedPermissions((current) => (current === permissions ? previous : current));
      }
      if (ownsMutation && conversationOwner.isCurrent()) {
        setControlError(cause instanceof Error ? cause.message : "Could not update permissions");
      }
    });
  });
  const updateComposerPreferences = useEvent(updateCurrentPreferences);
  const capturePreferenceUpdate = useEvent(() => updateCurrentPreferences);
  return {
    captureControlsResource,
    currentControlsResource,
    controlError,
    requestControls,
    selectedModel,
    selectedEffort,
    selectedPersonality,
    selectedPermissions,
    setSelectedPersonality,
    selectModel,
    selectEffort,
    selectPermissions,
    updateComposerPreferences,
    capturePreferenceUpdate,
  };
}

import type { Dispatch, SetStateAction } from "react";
import type { ComposerMenuPage } from "./composerTypes";
type ComposerControlActions = Pick<
  ReturnType<typeof useComposerSettings>,
  "currentControlsResource" | "requestControls"
> & {
  closeInlineQueueOverlay(): void;
  setComposerTrayVisible: Dispatch<SetStateAction<boolean>>;
  dismissComposerKeyboardForOverlay(): void;
  setMenuInitialPage: Dispatch<SetStateAction<ComposerMenuPage>>;
  setMenuVisible: Dispatch<SetStateAction<boolean>>;
};
export function useComposerControlActions({
  closeInlineQueueOverlay,
  setComposerTrayVisible,
  dismissComposerKeyboardForOverlay,
  setMenuInitialPage,
  setMenuVisible,
  currentControlsResource,
  requestControls,
}: ComposerControlActions) {
  const openControls = useEvent((initialPage: ComposerMenuPage) => {
    closeInlineQueueOverlay();
    setComposerTrayVisible(false);
    dismissComposerKeyboardForOverlay();
    setMenuInitialPage(initialPage);
    setMenuVisible(true);
    // A failed/background prefetch may be retried, but an already loaded sheet
    // never refetches its model, skill and permission lists.
    const current = currentControlsResource();
    if (initialPage !== "ports" && (current === null || current.status === "error"))
      requestControls();
  });

  const closeControls = useEvent(() => {
    setMenuVisible(false);
  });

  const openQuickControlMenu = useEvent((_scope: "model-menu" | "permissions-menu") => {
    setComposerTrayVisible(false);
    dismissComposerKeyboardForOverlay();
    const current = currentControlsResource();
    if (current === null || current.status === "error") requestControls();
  });

  const closeQuickControlMenu = useEvent((_scope: "model-menu" | "permissions-menu") => undefined);
  return { openControls, closeControls, openQuickControlMenu, closeQuickControlMenu };
}
