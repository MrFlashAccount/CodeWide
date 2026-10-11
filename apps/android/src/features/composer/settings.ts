/** V1 settings owner, extracted without changing interaction or resource lifetime. */
import { projectedThreadExecutionSettings } from "@codewide/sync-client";
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
import { observable } from "@legendapp/state";
import { useEffect } from "react";
import { activeTurnId } from "../../data/thread-lifecycle";
import { readThreadAgent } from "../../data/threadAgent";
import type { StoredComposerPreferences } from "../../data/thread-ui-state-types";
import type { TurnControlsRow } from "../../data/workspace-resource-database";
import { useEvent } from "../../react/useEvent";
import { clampModelEffort } from "../../ui/modelEffort";
import { retainedServiceTier } from "../../ui/modelServiceTier";
import type { ModelSettingsChoice } from "../../ui/TurnControlMenus.types";
import { useConversationRef, useConversationState } from "../../ui/use-conversation-scope";
import {
  controlBaseline,
  EMPTY_CONTROLS_OVERLAY,
  overlayAccepted,
  overlayOwnsMutation,
  overlayRejected,
  overlayWithChanges,
  reconcileControlsState,
  threadSettingsUpdate,
  type ComposerControlChanges,
  type ComposerControlsState,
} from "./settings/controlsOverlay";
import {
  resolvedDefaultPermissions,
  threadPermissionDefaultScope,
} from "./settings/permissionDefault";
import type { ComposerSettingsCapabilities } from "./settingsCapabilities";
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
  remoteThread,
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

  // Existing threads are configured via thread/settings/update and show the
  // server's settings. Re-sending a persisted local choice with a message would
  // undo a change made on another device, so only a new chat sends its choices.
  const selectedModel = newChat ? composerPreferences.model : null;

  const selectedEffort = newChat ? composerPreferences.effort : null;
  const selectedServiceTier = newChat ? composerPreferences.serviceTier : undefined;

  const selectedPersonality = composerPreferences.personality;

  const selectedPermissions = newChat ? composerPreferences.permissions : null;

  const setSelectedModel = (apply: (current: string | null) => string | null) => {
    updateCurrentPreferences((current) => ({ ...current, model: apply(current.model) }));
  };
  const updateSelectedEffort = (apply: (current: string | null) => string | null) => {
    updateCurrentPreferences((current) => ({ ...current, effort: apply(current.effort) }));
  };
  const setSelectedPersonality = useEvent((value: Personality | null) => {
    updateCurrentPreferences((current) => ({ ...current, personality: value }));
  });

  const [controls$] = useConversationState(composerScope, () =>
    observable<ComposerControlsState>({
      activeTurnId: null,
      overlay: EMPTY_CONTROLS_OVERLAY,
      server: null,
    }),
  );
  const mutationRef = useConversationRef(composerScope, () => 0);
  const server =
    remoteThread === null || remoteThread === undefined
      ? null
      : projectedThreadExecutionSettings(remoteThread);
  const currentTurnId = activeTurnId(remoteThread);
  // Publishes the server's settings to the route-owned control sheet and
  // retires local choices the server has echoed or replaced since.
  useEffect(() => {
    const current = controls$.peek();
    const next = reconcileControlsState(current, server, currentTurnId);
    if (next !== current) {
      controls$.set(next);
    }
  }, [controls$, currentTurnId, server]);
  const readThread = useEvent(() => remoteThread ?? null);
  const remoteSettings = !newChat && onUpdateSettings !== undefined;

  /**
   * Sends one existing-thread change and shows it over the server value until
   * the server answers: an echo confirms it, a rejection removes it and shows
   * the server's error. A queued command keeps it pending while offline.
   */
  const sendThreadChanges = (changes: ComposerControlChanges, failure: string) => {
    if (onUpdateSettings === undefined) {
      return;
    }
    const thread = readThread();
    const mutation = ++mutationRef.current;
    controls$.set((state) => ({
      ...state,
      overlay: overlayWithChanges(state.overlay, {
        baseline: controlBaseline(
          thread === null ? null : projectedThreadExecutionSettings(thread),
          activeTurnId(thread),
        ),
        changes,
        mutation,
      }),
    }));
    setControlError(null);
    void onUpdateSettings(threadSettingsUpdate(changes)).then(
      () => {
        controls$.set((state) => ({ ...state, overlay: overlayAccepted(state.overlay, mutation) }));
      },
      (error: unknown) => {
        const owned = overlayOwnsMutation(controls$.peek().overlay, mutation);
        controls$.set((state) => ({ ...state, overlay: overlayRejected(state.overlay, mutation) }));
        if (owned && conversationOwner.isCurrent()) {
          setControlError(error instanceof Error ? error.message : failure);
        }
      },
    );
  };

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
          current !== null &&
          !next.models.some((candidate) => clampModelEffort(candidate, current) === current)
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
    if (remoteSettings) {
      updateCurrentPreferences((current) => ({ ...current, personality: choice.personality }));
      if (choice.executionChanged) {
        sendThreadChanges(
          {
            ...(choice.effort === null ? {} : { effort: choice.effort }),
            model: choice.model,
            serviceTier: choice.serviceTier ?? null,
          },
          "Could not update model settings",
        );
      }
      return;
    }
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
  });

  const selectModel = useEvent((model: string, effort: string | null) => {
    const modelTiers = currentControlsResource()?.value?.models.find(
      (item) => item.id === model,
    )?.serviceTiers;
    if (remoteSettings) {
      const tier = retainedServiceTier(
        controls$.peek().server?.serviceTier ?? undefined,
        modelTiers,
      );
      sendThreadChanges(
        {
          ...(effort === null ? {} : { effort }),
          model,
          serviceTier: tier ?? null,
        },
        "Could not update model settings",
      );
      return;
    }
    const serviceTier = retainedServiceTier(selectedServiceTier, modelTiers);
    updateCurrentPreferences((current) => ({ ...current, effort, model, serviceTier }));
  });

  const selectEffort = useEvent((effort: string) => {
    if (remoteSettings) {
      sendThreadChanges({ effort }, "Could not update thinking effort");
      return;
    }
    updateCurrentPreferences((current) => ({ ...current, effort }));
  });

  const selectServiceTier = useEvent((serviceTier: string) => {
    if (remoteSettings) {
      sendThreadChanges({ serviceTier }, "Could not update Fast mode");
      return;
    }
    updateCurrentPreferences((current) => ({ ...current, serviceTier }));
  });

  /**
   * `null` is "Server default": a new chat names no profile and the provider
   * applies its default; an existing thread sends that default explicitly,
   * because an absent profile means "unchanged" on the wire.
   */
  const selectPermissions = useEvent((permissions: string | null) => {
    if (!remoteSettings) {
      updateCurrentPreferences((current) => ({ ...current, permissions }));
      return;
    }
    const profile =
      permissions ??
      resolvedDefaultPermissions(
        currentControlsResource()?.value ?? EMPTY_TURN_CONTROLS,
        threadPermissionDefaultScope(readThreadAgent(readThread())),
      );
    if (profile === null) {
      setControlError("The server's default access is unknown");
      return;
    }
    sendThreadChanges({ permissions: profile }, "Could not update permissions");
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
    controls$,
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
