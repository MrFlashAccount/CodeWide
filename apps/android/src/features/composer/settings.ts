/** V1 settings owner, extracted without changing interaction or resource lifetime. */
import type { projectedThreadExecutionSettings } from "@codewide/sync-client";
import type { TurnControlsSection, TurnControlsValue } from "../../data/turn-controls-types";

export function executionPermissionsLabel(
  settings: ReturnType<typeof projectedThreadExecutionSettings>,
  pending = true,
): string {
  if (settings?.permissions !== null && settings?.permissions !== undefined) {
    return permissionProfileLabel(settings.permissions);
  }
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
  if (sandbox !== null && approval !== null) {
    return `${sandbox} · ${approval}`;
  }
  return sandbox ?? approval ?? (pending ? "Loading access…" : "Access unavailable");
}

export function permissionProfileLabel(id: string): string {
  if (id === ":workspace") {
    return "Workspace";
  }
  if (id === ":read-only") {
    return "Read only";
  }
  if (id === ":full-access" || id === ":danger-full-access") {
    return "Full access";
  }
  return id.startsWith(":") ? id.slice(1).replaceAll("-", " ") : id;
}

export const EMPTY_TURN_CONTROLS: TurnControlsValue = {
  defaults: { effort: null, model: null, permissions: null, serviceTier: null },
  models: [],
  permissions: [],
  skills: [],
};

import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type { StoredComposerPreferences } from "../../data/thread-ui-state-types";
import type { TurnControlsRow } from "../../data/workspace-resource-database";
import { useEvent } from "../../react/useEvent";
import { retainedServiceTier } from "../../ui/modelServiceTier";
import type { ModelSettingsChoice } from "../../ui/TurnControlMenus.types";
import { useConversationRef, useConversationState } from "../../ui/use-conversation-scope";
import type { ComposerSettingsCapabilities } from "./settingsCapabilities";
import { rollbackOwnedModelSelection } from "./submissionRecovery";
export function useComposerSettings({
  composerPreferences,
  composerScope,
  composerSession,
  controlsResourceId,
  conversationOwner,
  cwd,
  draftConnectionId,
  draftThreadId,
  newChat,
  onLoadControls,
  onUpdateSettings,
  saveComposerPreferences,
  workspaceResources,
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

  const updatePreferences = (
    owner: Pick<typeof composerSession, "read" | "updatePreferences">,
    apply: (current: StoredComposerPreferences) => StoredComposerPreferences,
  ) => {
    const next = apply(owner.read().preferences);
    owner.updatePreferences(() => next);
    if (
      saveComposerPreferences !== undefined &&
      draftConnectionId !== null &&
      draftThreadId !== null
    ) {
      void saveComposerPreferences(draftConnectionId, draftThreadId, next).catch(() => undefined);
    }
  };
  const updateCurrentPreferences = (
    apply: (current: StoredComposerPreferences) => StoredComposerPreferences,
  ) => {
    updatePreferences(composerSession, apply);
  };

  // Existing threads are configured via thread/settings/update. Re-sending a
  // persisted local choice would undo model changes made on another device.
  const selectedModel = newChat ? composerPreferences.model : null;

  const selectedEffort = newChat ? composerPreferences.effort : null;
  const selectedServiceTier = newChat ? composerPreferences.serviceTier : undefined;

  const selectedPersonality = composerPreferences.personality;

  const selectedPermissions = composerPreferences.permissions;

  const setSelectedModel = (apply: (current: string | null) => string | null) => {
    updateCurrentPreferences((current) => ({ ...current, model: apply(current.model) }));
  };
  const setSelectedEffort = (value: string | null) => {
    updateCurrentPreferences((current) => ({ ...current, effort: value }));
  };
  const updateSelectedEffort = (apply: (current: string | null) => string | null) => {
    updateCurrentPreferences((current) => ({ ...current, effort: apply(current.effort) }));
  };
  const setSelectedPersonality = useEvent((value: Personality | null) => {
    updateCurrentPreferences((current) => ({ ...current, personality: value }));
  });
  const setSelectedPermissions = (value: string | null) => {
    updateCurrentPreferences((current) => ({ ...current, permissions: value }));
  };
  const updateSelectedPermissions = (apply: (current: string | null) => string | null) => {
    updateCurrentPreferences((current) => ({
      ...current,
      permissions: apply(current.permissions),
    }));
  };

  const settingsMutationRef = useConversationRef(composerScope, () => ({
    effort: 0,
    model: 0,
    permissions: 0,
    serviceTier: 0,
  }));

  const requestControls = useEvent((sections: readonly TurnControlsSection[]) => {
    const current = currentControlsResource();
    if (onLoadControls === undefined || (current?.status === "loading" && current.value === null)) {
      return;
    }
    setControlError(null);
    void onLoadControls(cwd, { mode: "refresh", sections })
      .then((next) => {
        if (!conversationOwner.isCurrent()) {
          return;
        }
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
      .catch((error: unknown) => {
        if (!conversationOwner.isCurrent()) {
          return;
        }
        setControlError(error instanceof Error ? error.message : "Could not load turn controls");
      });
  });

  const applyModelSettings = useEvent((choice: ModelSettingsChoice) => {
    updateCurrentPreferences((current) =>
      choice.executionChanged
        ? {
            ...current,
            effort: choice.effort,
            model: choice.model,
            personality: choice.personality,
            serviceTier: choice.serviceTier,
          }
        : { ...current, personality: choice.personality },
    );
    if (!choice.executionChanged) {
      return;
    }
    ++settingsMutationRef.current.model;
    ++settingsMutationRef.current.effort;
    ++settingsMutationRef.current.serviceTier;
    if (onUpdateSettings === undefined) {
      return;
    }
    setControlError(null);
    void onUpdateSettings({
      effort: choice.effort,
      model: choice.model,
      serviceTier: choice.serviceTier ?? null,
    }).catch((error: unknown) => {
      if (conversationOwner.isCurrent()) {
        setControlError(error instanceof Error ? error.message : "Could not update model settings");
      }
    });
  });

  const selectModel = useEvent((model: string, effort: string) => {
    const modelMutation = ++settingsMutationRef.current.model;
    const effortMutation = ++settingsMutationRef.current.effort;
    const previousModel = selectedModel;
    const previousEffort = selectedEffort;
    const modelTiers = currentControlsResource()?.value?.models.find(
      (item) => item.id === model,
    )?.serviceTiers;
    const serviceTier = retainedServiceTier(selectedServiceTier, modelTiers);
    const previousServiceTier = selectedServiceTier;
    const tierMutation = ++settingsMutationRef.current.serviceTier;
    updateCurrentPreferences((current) => ({ ...current, effort, model, serviceTier }));
    if (onUpdateSettings === undefined) {
      return;
    }
    setControlError(null);
    void onUpdateSettings({ effort, model, serviceTier: serviceTier ?? null }).catch(
      (error: unknown) => {
        const ownsModel = settingsMutationRef.current.model === modelMutation;
        const ownsEffort = settingsMutationRef.current.effort === effortMutation;
        const ownsTier = settingsMutationRef.current.serviceTier === tierMutation;
        if (
          (ownsModel || ownsEffort) &&
          (conversationOwner.isCurrent() || !conversationOwner.hasReplacement())
        ) {
          updateCurrentPreferences((current) => ({
            ...current,
            ...rollbackOwnedModelSelection(
              current,
              { effort, model },
              { effort: previousEffort, model: previousModel },
              { effort: ownsEffort, model: ownsModel },
            ),
            ...(ownsTier && current.serviceTier === serviceTier
              ? { serviceTier: previousServiceTier }
              : {}),
          }));
        }
        if ((ownsModel || ownsEffort) && conversationOwner.isCurrent()) {
          setControlError(
            error instanceof Error ? error.message : "Could not update model settings",
          );
        }
      },
    );
  });

  const selectEffort = useEvent((effort: string) => {
    const mutation = ++settingsMutationRef.current.effort;
    const previous = selectedEffort;
    setSelectedEffort(effort);
    if (onUpdateSettings === undefined) {
      return;
    }
    setControlError(null);
    void onUpdateSettings({ effort }).catch((error: unknown) => {
      const ownsMutation = settingsMutationRef.current.effort === mutation;
      if (ownsMutation && (conversationOwner.isCurrent() || !conversationOwner.hasReplacement())) {
        updateSelectedEffort((current) => (current === effort ? previous : current));
      }
      if (ownsMutation && conversationOwner.isCurrent()) {
        setControlError(
          error instanceof Error ? error.message : "Could not update thinking effort",
        );
      }
    });
  });

  const selectServiceTier = useEvent((serviceTier: string) => {
    const mutation = ++settingsMutationRef.current.serviceTier;
    const previous = selectedServiceTier;
    updateCurrentPreferences((current) => ({ ...current, serviceTier }));
    if (onUpdateSettings === undefined) {
      return;
    }
    setControlError(null);
    void onUpdateSettings({ serviceTier }).catch((error: unknown) => {
      const ownsMutation = settingsMutationRef.current.serviceTier === mutation;
      if (ownsMutation && (conversationOwner.isCurrent() || !conversationOwner.hasReplacement())) {
        updateCurrentPreferences((current) =>
          current.serviceTier === serviceTier ? { ...current, serviceTier: previous } : current,
        );
      }
      if (ownsMutation && conversationOwner.isCurrent()) {
        setControlError(error instanceof Error ? error.message : "Could not update Fast mode");
      }
    });
  });

  const selectPermissions = useEvent((permissions: string | null) => {
    const mutation = ++settingsMutationRef.current.permissions;
    const previous = selectedPermissions;
    setSelectedPermissions(permissions);
    if (onUpdateSettings === undefined) {
      return;
    }
    setControlError(null);
    void onUpdateSettings({ permissions }).catch((error: unknown) => {
      const ownsMutation = settingsMutationRef.current.permissions === mutation;
      if (ownsMutation && (conversationOwner.isCurrent() || !conversationOwner.hasReplacement())) {
        updateSelectedPermissions((current) => (current === permissions ? previous : current));
      }
      if (ownsMutation && conversationOwner.isCurrent()) {
        setControlError(error instanceof Error ? error.message : "Could not update permissions");
      }
    });
  });
  const updateComposerPreferences = useEvent(updateCurrentPreferences);
  const capturePreferenceUpdate = useEvent(() => {
    const owner = composerSession.capture();
    return (apply: (current: StoredComposerPreferences) => StoredComposerPreferences) => {
      updatePreferences(owner, apply);
    };
  });
  return {
    applyModelSettings,
    captureControlsResource,
    capturePreferenceUpdate,
    controlError,
    currentControlsResource,
    requestControls,
    selectedEffort,
    selectedModel,
    selectedPermissions,
    selectedPersonality,
    selectedServiceTier,
    selectEffort,
    selectModel,
    selectPermissions,
    selectServiceTier,
    setSelectedPersonality,
    updateComposerPreferences,
  };
}

import type { Dispatch, SetStateAction } from "react";
import type { ComposerMenuPage } from "./composerTypes";
type ComposerControlActions = Pick<ReturnType<typeof useComposerSettings>, "requestControls"> & {
  closeInlineQueueOverlay: () => void;
  dismissComposerKeyboardForOverlay: () => void;
  openToolRoute: (page: ComposerMenuPage) => void;
  setComposerTrayVisible: Dispatch<SetStateAction<boolean>>;
};
export function useComposerControlActions({
  closeInlineQueueOverlay,
  dismissComposerKeyboardForOverlay,
  openToolRoute,
  requestControls,
  setComposerTrayVisible,
}: ComposerControlActions) {
  const openControls = useEvent((initialPage: ComposerMenuPage) => {
    closeInlineQueueOverlay();
    setComposerTrayVisible(false);
    dismissComposerKeyboardForOverlay();
    openToolRoute(initialPage);
    const sections = controlSectionsForPage(initialPage);
    if (sections !== null) {
      requestControls(sections);
    }
  });

  const openQuickControlMenu = useEvent((scope: "model-menu" | "permissions-menu") => {
    setComposerTrayVisible(false);
    dismissComposerKeyboardForOverlay();
    requestControls(scope === "model-menu" ? ["models", "defaults"] : ["permissions", "defaults"]);
  });

  const closeQuickControlMenu = useEvent((_scope: "model-menu" | "permissions-menu") => undefined);
  return { closeQuickControlMenu, openControls, openQuickControlMenu };
}

function controlSectionsForPage(page: ComposerMenuPage): readonly TurnControlsSection[] | null {
  if (page === "model") {
    return ["models", "defaults"];
  }
  if (page === "skills") {
    return ["skills"];
  }
  if (page === "permissions") {
    return ["permissions", "defaults"];
  }
  return null;
}
