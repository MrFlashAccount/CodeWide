import type { ReactNode } from "react";
import { ComposerControlOptions } from "./settings/ComposerControlOptions";
/** V1 ComposerMenu owner, extracted without changing interaction or resource lifetime. */
import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import type { Thread } from "@codewide/codex-protocol/v0.147.0/v2";
import { projectedThreadExecutionSettings } from "@codewide/sync-client";
import { View } from "react-native";
import { type GetTransferAccess } from "../../data/private-transfer";
import { type TurnControlsValue } from "../../data/turn-controls-types";
import { useTurnControlsRow } from "../../data/use-workspace-resource-row";
import { type WorkspaceResourceDatabase } from "../../data/workspace-resource-database";
import { PrivateImageAccessProvider } from "../../rendering/use-private-image-uri";
import { AppSheet } from "../../ui/AppSheet";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./ComposerMenu.styles";
import { type ComposerMenuPage } from "./composerTypes";
import { composerModelSettings } from "./modelSettings";
import { EMPTY_TURN_CONTROLS } from "./settings";
import { SkillsPicker } from "./skills/SkillsPicker";

export function ResourceComposerMenu({
  newChat,
  resources,
  controlsResourceId,
  controlError,
  ...props
}: Omit<ComposerMenuProps, "controls" | "loading" | "error"> & {
  newChat: boolean;
  resources: WorkspaceResourceDatabase | null;
  controlsResourceId: string | null;
  controlError: string | null;
}) {
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
  const { model: selectedModel, effort: selectedEffort } = composerModelSettings(
    newChat,
    serverExecution,
    { model: props.selectedModel, effort: props.selectedEffort },
    controls,
  );
  const selectedPermissions =
    props.selectedPermissions ?? serverExecution?.permissions ?? controls.defaults.permissions;
  return (
    <ComposerMenu
      {...props}
      selectedModel={selectedModel}
      selectedEffort={selectedEffort}
      selectedPermissions={selectedPermissions}
      controls={controls}
      loading={loading}
      error={controlError ?? controlsResource?.error ?? null}
    />
  );
}

export function ComposerMenu({
  toolPage,
  hideTitle,
  visible,
  initialPage,
  onClose,
  controls,
  voiceScope,
  loading,
  error,
  selectedModel,
  selectedEffort,
  selectedPersonality,
  selectedPermissions,
  onSelectModel,
  onSelectEffort,
  onSelectPersonality,
  onSelectPermissions,
  onInvokeSkill,
  getTransferAccess,
}: {
  toolPage: ReactNode;
  hideTitle: boolean;
  visible: boolean;
  initialPage: ComposerMenuPage;
  onClose(): void;
  controls: TurnControlsValue;
  thread: Thread | null;
  voiceScope: string;
  loading: boolean;
  error: string | null;
  selectedModel: string | null;
  selectedEffort: string | null;
  selectedPersonality: Personality | null;
  selectedPermissions: string | null;
  onSelectModel(model: string, effort: string): void;
  onSelectEffort(effort: string): void;
  onSelectPersonality(personality: Personality | null): void;
  onSelectPermissions(permissions: string | null): void;
  onInvokeSkill(skill: { name: string; path: string }): void;
  getTransferAccess?: GetTransferAccess;
}) {
  const page = initialPage;
  if (page === "goal") return toolPage;

  return (
    <AppSheet
      isOpen={visible}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      contentProps={{
        index: 0,
        snapPoints: ["55%", "90%"],
        enableDynamicSizing: false,
        enableOverDrag: false,
        contentContainerClassName: "h-full",
        performanceSurface: page === "ports" ? "ports" : page === "skills" ? "skills" : "sheet",
      }}
    >
      {!hideTitle && (
        <View style={styles.menuTitleRow}>
          <Text numberOfLines={1} ellipsizeMode="tail" style={styles.sheetTitle}>
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
                skills={controls.skills}
                loading={loading}
                error={error}
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
            page={page}
            controls={controls}
            selectedModel={selectedModel}
            selectedEffort={selectedEffort}
            selectedPersonality={selectedPersonality}
            selectedPermissions={selectedPermissions}
            onSelectModel={onSelectModel}
            onSelectEffort={onSelectEffort}
            onSelectPersonality={onSelectPersonality}
            onSelectPermissions={onSelectPermissions}
          />
        )}
      </View>
    </AppSheet>
  );
}

export function pageTitle(page: ComposerMenuPage): string {
  if (page === "model") return "Model & Thinking";
  if (page === "skills") return "Skills";
  if (page === "permissions") return "Permissions";
  if (page === "queue") return "Queued prompts";
  if (page === "goal") return "Goal & progress";
  if (page === "review") return "Review";
  if (page === "ports") return "Ports";
  return "Runtime";
}

export type ComposerMenuProps = Parameters<typeof ComposerMenu>[0];

import { useConversationState } from "../../ui/use-conversation-scope";

export function useComposerMenuState(composerScope: string) {
  const [composerTrayVisible, setComposerTrayVisible] = useConversationState(
    composerScope,
    () => false,
  );

  return {
    composerTrayVisible,
    setComposerTrayVisible,
  };
}
