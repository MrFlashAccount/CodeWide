import { Pressable, useWindowDimensions, View } from "react-native";

import type {
  ComposerAttachmentDraftItem,
  ComposerSubmission,
} from "../../application/composer/composerAttachmentTypes";
import type { ComposerAttachmentTarget } from "../../application/ports/composerAttachmentTransport";
import type { ComposerContextItem } from "../../presentation/input/ComposerContextStripView";
import { ComposerContextStripView } from "../../presentation/input/ComposerContextStripView";
import { ConversationView } from "../../presentation/conversation/ConversationView";
import { TopBarActionView } from "../../presentation/actions/TopBarActionView";
import { WorkspaceView } from "../../presentation/layouts/WorkspaceView";
import { isDesktopWindow } from "../../presentation/layouts/windowLayout";
import {
  ProjectPickerView,
  type ProjectPickerRow,
} from "../../presentation/navigation/ProjectPickerView";
import { ProductText } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import type { ActionMenuItem } from "../../ui/ActionMenu";
import type { SavedServerId } from "../../domain/ids";
import { V2ChatComposer } from "../../V2ChatComposer";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import type { VoiceInputControlModel } from "../conversation/VoiceInputControl";
import { NewThreadWorkspaceMode, type WorkspaceModeSelection } from "./NewThreadWorkspaceMode";
import { newThreadViewStyles as styles } from "./newThreadViewStyles";

export interface NewThreadViewProps {
  composerTarget: ComposerAttachmentTarget;
  connectionError: string | null;
  connectionLoading: boolean;
  contextItems: ComposerContextItem[];
  draftLocked: boolean;
  error: string | null;
  locallyLocked: boolean;
  menuActions: readonly ActionMenuItem[];
  message: string;
  onAddProject(path: string): Promise<ProjectPickerRow>;
  onBack(): void;
  onEdit(): void;
  onEditAttachment(item: ComposerAttachmentDraftItem): void;
  onOpenProjectPicker(): void;
  onPinProject(project: ProjectPickerRow): Promise<void>;
  onProjectPickerChange(visible: boolean): void;
  onReleaseUnsettled(): Promise<void>;
  onSelectComposerAction(id: string): void;
  onSelectProject(path: string | null): Promise<void>;
  onSelectWorkspaceMode(selection: WorkspaceModeSelection): void;
  onSubmit(submission: ComposerSubmission): Promise<boolean>;
  onTextChange(value: string): void;
  projectLoading: boolean;
  projectMutationsLocked: boolean;
  projectPickerVisible: boolean;
  projectSelectionLocked: boolean;
  projects: readonly ProjectPickerRow[];
  projectStatus: string | null;
  retryBlocked: boolean;
  savedServerId: SavedServerId;
  unsettledCount: number;
  voice: VoiceInputControlModel;
  voiceLevel: number;
  voiceNowMs: number;
  workspace: string | null;
  workspaceMode: WorkspaceModeSelection;
}

export function NewThreadView(props: NewThreadViewProps): React.JSX.Element {
  const window = useWindowDimensions();
  const {
    composerTarget,
    connectionError,
    connectionLoading,
    contextItems,
    draftLocked,
    error,
    locallyLocked,
    menuActions,
    message,
    onAddProject,
    onBack,
    onEdit,
    onEditAttachment,
    onOpenProjectPicker,
    onPinProject,
    onProjectPickerChange,
    onReleaseUnsettled,
    onSelectComposerAction,
    onSelectProject,
    onSelectWorkspaceMode,
    onSubmit,
    onTextChange,
    projectLoading,
    projectMutationsLocked,
    projectPickerVisible,
    projectSelectionLocked,
    projects,
    projectStatus,
    retryBlocked,
    savedServerId,
    unsettledCount,
    voice,
    voiceLevel,
    voiceNowMs,
    workspace,
    workspaceMode,
  } = props;
  return (
    <WorkspaceView
      leading={
        isDesktopWindow(window) ? undefined : (
          <TopBarActionView icon="back" label="Back to threads" onPress={onBack} />
        )
      }
      subtitle={
        <ProductText numberOfLines={1} tone="muted">
          {workspace ?? "Server default"}
        </ProductText>
      }
      title="New Chat"
    >
      <ConversationView>
        <View style={styles.emptyState}>
          <ProductText style={styles.prompt} weight="semibold">
            What would you like to work on?
          </ProductText>
          <Pressable
            accessibilityLabel={`Change project, currently ${projectName(workspace)}`}
            accessibilityRole="button"
            accessibilityState={{ disabled: projectSelectionLocked }}
            disabled={projectSelectionLocked}
            onPress={onOpenProjectPicker}
            style={[styles.projectButton, projectSelectionLocked && styles.disabled]}
          >
            <ProductText numberOfLines={1} style={styles.projectText}>
              in {projectName(workspace)}
            </ProductText>
            <ProductText style={styles.chevron}>⌄</ProductText>
          </Pressable>
          <NewThreadWorkspaceMode
            disabled={projectSelectionLocked}
            onSelect={onSelectWorkspaceMode}
            savedServerId={savedServerId}
            selection={workspaceMode}
            workspace={workspace}
          />
          {projectLoading ? (
            <ShimmerText style={styles.projectLoading} text="Reading projects…" />
          ) : null}
          {projectStatus === null ? null : (
            <ProductText accessibilityLiveRegion="polite" tone="danger">
              {projectStatus}
            </ProductText>
          )}
        </View>
        {unsettledCount === 0 ? null : (
          <>
            <ProductText accessibilityLiveRegion="polite" style={styles.pending} tone="warning">
              {unsettledCount} saved action{unsettledCount === 1 ? " is" : "s are"} waiting for the
              server
            </ProductText>
            {locallyLocked ? (
              <ActionPressable
                action={{
                  id: `release-new-thread:${savedServerId}`,
                  label: "Start another anyway",
                  run: onReleaseUnsettled,
                }}
              />
            ) : null}
          </>
        )}
        {connectionError === null ? null : (
          <ProductText accessibilityLiveRegion="polite" tone="danger">
            {connectionError}
          </ProductText>
        )}
        {connectionLoading && connectionError === null ? (
          <ShimmerText style={styles.pending} text="Connecting to server…" />
        ) : null}
        <ComposerContextStripView items={contextItems} onOpen={ignoreContextOpen} />
        <V2ChatComposer
          disabled={draftLocked}
          draftId={`new-thread:${savedServerId}`}
          error={error}
          locked={locallyLocked}
          menuActions={menuActions}
          onEdit={onEdit}
          onEditAttachment={onEditAttachment}
          onSelectMenu={onSelectComposerAction}
          onSubmit={onSubmit}
          onTextChange={onTextChange}
          retryBlocked={retryBlocked}
          savedServerId={savedServerId}
          target={composerTarget}
          text={message}
          voice={voice}
          voiceLevel={voiceLevel}
          voiceNowMs={voiceNowMs}
        />
        <ProjectPickerView
          currentPath={workspace}
          isOpen={projectPickerVisible}
          mutationsDisabled={projectMutationsLocked}
          onAddProject={onAddProject}
          onOpenChange={onProjectPickerChange}
          onPinProject={onPinProject}
          onSelect={onSelectProject}
          projects={projects}
        />
      </ConversationView>
    </WorkspaceView>
  );
}

function projectName(path: string | null): string {
  if (path === null) return "server default";
  const normalized = path.replace(/[\\/]+$/u, "");
  const label = normalized.split(/[\\/]/u).at(-1);
  return label === undefined || label === "" ? path : label;
}

function ignoreContextOpen(): void {}
