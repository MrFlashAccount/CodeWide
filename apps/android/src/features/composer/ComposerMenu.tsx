import type { ReactNode } from "react";
import { ComposerControlOptions } from "./settings/ComposerControlOptions";
/** V1 ComposerMenu owner, extracted without changing interaction or resource lifetime. */
import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { projectedThreadExecutionSettings } from "@codewide/sync-client";
import type { Observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useSyncExternalStore } from "react";
import { View } from "react-native";
import type { GetTransferAccess } from "../../data/private-transfer";
import { readThreadAgent } from "../../data/threadAgent";
import type { StoredComposerPreferences } from "../../data/thread-ui-state-types";
import type { TurnControlsValue } from "../../data/turn-controls-types";
import { useTurnControlsRow } from "../../data/use-workspace-resource-row";
import type { WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
import { useEvent } from "../../react/useEvent";
import { PrivateImageAccessProvider } from "../../rendering/use-private-image-uri";
import { AppSheet } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ComposerMenu.styles";
import type { ComposerMenuPage } from "./composerTypes";
import { EMPTY_TURN_CONTROLS } from "./settings";
import {
  existingThreadControlsView,
  newChatControlsView,
  type ComposerControlsView,
} from "./settings/composerControlsView";
import type { ComposerControlsState } from "./settings/controlsOverlay";
import { providerScopedControls } from "./settings/providerScopedControls";
import { SkillsPicker } from "./skills/SkillsPicker";

/** Reads a new chat's persisted local control choices as they change. */
export type ComposerDraftPreferencesSource = {
  readonly read: () => StoredComposerPreferences;
  readonly subscribe: (listener: () => void) => () => void;
};

export function ResourceComposerMenu({
  controlError,
  controls$,
  controlsResourceId,
  draftPreferences,
  newChat,
  resources,
  ...props
}: Omit<ComposerMenuProps, "controls" | "loading" | "error" | "view"> & {
  controlError: string | null;
  /** The settings owner's state: the thread's server settings and pending local choices. */
  controls$: Observable<ComposerControlsState>;
  controlsResourceId: string | null;
  draftPreferences: ComposerDraftPreferencesSource;
  newChat: boolean;
  resources: WorkspaceResourceDatabase | null;
}): ReactNode {
  const controlsResource = useTurnControlsRow(resources, controlsResourceId);
  const controls = providerScopedControls(
    controlsResource?.value ?? EMPTY_TURN_CONTROLS,
    newChat,
    props.thread,
  );
  const loading =
    props.initialPage === "skills"
      ? controls.skills.length === 0 &&
        (controlsResource === null ||
          controlsResource.status === "loading" ||
          controlsResource.status === "refreshing")
      : controlsResource?.status === "loading" && controlsResource.value === null;
  const state = useSelector(() => controls$.get());
  const draft = useSyncExternalStore(
    draftPreferences.subscribe,
    draftPreferences.read,
    draftPreferences.read,
  );
  // The route opened with a snapshot of the thread; the owner's state carries
  // the server settings the conversation has observed since.
  const server =
    state.server ?? (props.thread === null ? null : projectedThreadExecutionSettings(props.thread));
  const view = newChat
    ? newChatControlsView(controls, draft)
    : existingThreadControlsView({
        activeTurnId: state.activeTurnId,
        agent: readThreadAgent(props.thread),
        controls,
        overlay: state.overlay,
        server,
      });
  return (
    <ComposerMenu
      {...props}
      controls={controls}
      error={controlError ?? controlsResource?.error ?? null}
      loading={loading}
      view={view}
    />
  );
}

export function ComposerMenu({
  controls,
  error,
  getTransferAccess,
  hideTitle,
  initialPage,
  loading,
  onClose,
  onInvokeSkill,
  onSelectEffort,
  onSelectModel,
  onSelectPermissions,
  onSelectPersonality,
  selectedPersonality,
  toolPage,
  view,
  visible,
  voiceScope,
}: {
  controls: TurnControlsValue;
  error: string | null;
  getTransferAccess?: GetTransferAccess;
  hideTitle: boolean;
  initialPage: ComposerMenuPage;
  loading: boolean;
  onClose: () => void;
  onInvokeSkill: (skill: { name: string; path: string }) => void;
  onSelectEffort: (effort: string) => void;
  onSelectModel: (model: string, effort: string | null) => void;
  onSelectPermissions: (permissions: string | null) => void;
  onSelectPersonality: (personality: Personality | null) => void;
  selectedPersonality: Personality | null;
  thread: Thread | null;
  toolPage: ReactNode;
  view: ComposerControlsView;
  visible: boolean;
  voiceScope: string;
}): ReactNode {
  const page = initialPage;
  if (page === "goal") {
    return toolPage;
  }

  return (
    <AppSheet
      contentProps={{
        contentContainerClassName: "h-full",
        enableDynamicSizing: false,
        enableOverDrag: false,
        index: 0,
        performanceSurface: page === "ports" ? "ports" : page === "skills" ? "skills" : "sheet",
        snapPoints: ["55%", "90%"],
      }}
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      {!hideTitle && (
        <View style={styles.menuTitleRow}>
          <Text ellipsizeMode="tail" numberOfLines={1} style={styles.sheetTitle}>
            {pageTitle(page)}
          </Text>
        </View>
      )}
      <View style={[styles.sheetPage, styles.expandedSheetPage]}>
        {(page === "model" || page === "permissions") && loading && (
          <Text style={styles.menuNotice}>Loading from remote server…</Text>
        )}
        {(page === "model" || page === "permissions") && error !== null && (
          <Text style={styles.errorText}>{error}</Text>
        )}
        {page === "skills" ? (
          <PrivateImageAccessProvider
            scope={`${voiceScope}:skills`}
            {...(getTransferAccess === undefined ? {} : { getAccess: getTransferAccess })}
          >
            {visible && (
              <SkillsPicker
                error={error}
                loading={loading}
                skills={controls.skills}
                {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                onSelect={(skill) => {
                  onInvokeSkill(skill);
                  onClose();
                }}
              />
            )}
          </PrivateImageAccessProvider>
        ) : toolPage !== null ? (
          toolPage
        ) : (
          <ComposerControlOptions
            controls={controls}
            onSelectEffort={onSelectEffort}
            onSelectModel={onSelectModel}
            onSelectPermissions={onSelectPermissions}
            onSelectPersonality={onSelectPersonality}
            page={page}
            selectedPersonality={selectedPersonality}
            view={view}
          />
        )}
      </View>
    </AppSheet>
  );
}

export function pageTitle(page: ComposerMenuPage): string {
  if (page === "model") {
    return "Model & Thinking";
  }
  if (page === "skills") {
    return "Skills";
  }
  if (page === "permissions") {
    return "Permissions";
  }
  if (page === "queue") {
    return "Queued prompts";
  }
  if (page === "goal") {
    return "Goal & progress";
  }
  if (page === "review") {
    return "Review";
  }
  if (page === "ports") {
    return "Ports";
  }
  return "Runtime";
}

export type ComposerMenuProps = Parameters<typeof ComposerMenu>[0];

import { useConversationState } from "../../ui/use-conversation-scope";
import { useComposerGoalMode } from "./composerGoalMode";

export function useComposerMenuState(composerScope: string) {
  const [composerTrayVisible, setComposerTrayVisible] = useConversationState(
    composerScope,
    () => false,
  );
  const goalMode = useComposerGoalMode(composerScope);
  const openGoalAttachment = useEvent(() => {
    setComposerTrayVisible(false);
    goalMode.openGoalAttachment();
  });

  return {
    ...goalMode,
    composerTrayVisible,
    openGoalAttachment,
    setComposerTrayVisible,
  };
}
