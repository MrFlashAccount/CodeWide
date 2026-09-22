import type { ReactNode } from "react";
import { ComposerControlOptions } from "./settings/ComposerControlOptions";
/** V1 ComposerMenu owner, extracted without changing interaction or resource lifetime. */
import type { Personality } from "@codewide/codex-protocol/v0.155.1";
import type { Thread } from "@codewide/codex-protocol/v0.155.1/v2";
import { projectedThreadExecutionSettings } from "@codewide/sync-client";
import { View } from "react-native";
import type { GetTransferAccess } from "../../data/private-transfer";
import type { TurnControlsValue } from "../../data/turn-controls-types";
import { useTurnControlsRow } from "../../data/use-workspace-resource-row";
import type { WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
import { useEvent } from "../../react/useEvent";
import { PrivateImageAccessProvider } from "../../rendering/use-private-image-uri";
import { AppSheet } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ComposerMenu.styles";
import type { ComposerMenuPage } from "./composerTypes";
import { composerModelSettings } from "./modelSettings";
import { EMPTY_TURN_CONTROLS } from "./settings";
import { SkillsPicker } from "./skills/SkillsPicker";

export function ResourceComposerMenu({
  controlError,
  controlsResourceId,
  newChat,
  resources,
  ...props
}: Omit<ComposerMenuProps, "controls" | "loading" | "error"> & {
  controlError: string | null;
  controlsResourceId: string | null;
  newChat: boolean;
  resources: WorkspaceResourceDatabase | null;
}): ReactNode {
  const controlsResource = useTurnControlsRow(resources, controlsResourceId);
  const controls = controlsResource?.value ?? EMPTY_TURN_CONTROLS;
  const loading =
    props.initialPage === "skills"
      ? controls.skills.length === 0 &&
        (controlsResource === null ||
          controlsResource.status === "loading" ||
          controlsResource.status === "refreshing")
      : controlsResource?.status === "loading" && controlsResource.value === null;
  const serverExecution =
    props.thread === null ? null : projectedThreadExecutionSettings(props.thread);
  const { effort: selectedEffort, model: selectedModel } = composerModelSettings(
    newChat,
    serverExecution,
    { effort: props.selectedEffort, model: props.selectedModel },
    controls,
  );
  const selectedPermissions =
    props.selectedPermissions ?? serverExecution?.permissions ?? controls.defaults.permissions;
  return (
    <ComposerMenu
      {...props}
      controls={controls}
      error={controlError ?? controlsResource?.error ?? null}
      loading={loading}
      selectedEffort={selectedEffort}
      selectedModel={selectedModel}
      selectedPermissions={selectedPermissions}
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
  selectedEffort,
  selectedModel,
  selectedPermissions,
  selectedPersonality,
  toolPage,
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
  onSelectModel: (model: string, effort: string) => void;
  onSelectPermissions: (permissions: string | null) => void;
  onSelectPersonality: (personality: Personality | null) => void;
  selectedEffort: string | null;
  selectedModel: string | null;
  selectedPermissions: string | null;
  selectedPersonality: Personality | null;
  thread: Thread | null;
  toolPage: ReactNode;
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
            selectedEffort={selectedEffort}
            selectedModel={selectedModel}
            selectedPermissions={selectedPermissions}
            selectedPersonality={selectedPersonality}
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

export function useComposerMenuState(composerScope: string) {
  const [composerTrayVisible, setComposerTrayVisible] = useConversationState(
    composerScope,
    () => false,
  );
  const [goalAttachmentVisible, setGoalAttachmentVisible] = useConversationState(
    `${composerScope}\u0000goal-attachment`,
    () => false,
  );
  const closeGoalAttachment = useEvent(() => {
    setGoalAttachmentVisible(false);
  });
  const openGoalAttachment = useEvent(() => {
    setComposerTrayVisible(false);
    setGoalAttachmentVisible(true);
  });

  return {
    closeGoalAttachment,
    composerTrayVisible,
    goalAttachmentVisible,
    openGoalAttachment,
    setComposerTrayVisible,
  };
}
