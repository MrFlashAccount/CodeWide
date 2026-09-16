import { ContentReviewComposer } from "../../rendering/ContentReviewHost";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import { useComposerProjectSelection } from "../projects/composerProjectSelection";
import type { ProjectConversationCapabilities } from "../projects/projectConversationCapabilities";
import { ProjectPickerSheet } from "../projects/ProjectPickerSheet";
import { useThreadRename } from "../turnActions/threadRename";
import { ThreadRenameDialog } from "../turnActions/ThreadRenameDialog";
import type { ThreadConversationCapabilities } from "../turnActions/threadConversationCapabilities";
import type { ThreadListItem } from "../threadList/threadListTypes";

/** Builds only conversation-local overlays; application destinations belong to Router. */
export function createConversationOverlayContent({
  surfaceInputs,
  composerProjectSelectionBinding,
  projectsInputs,
  threadRenameBinding,
  thread,
  actionsInputs,
}: {
  readonly surfaceInputs: ConversationSurfaceCapabilities;
  readonly composerProjectSelectionBinding: ReturnType<typeof useComposerProjectSelection>;
  readonly projectsInputs: ProjectConversationCapabilities;
  readonly threadRenameBinding: ReturnType<typeof useThreadRename>;
  readonly thread: ThreadListItem;
  readonly actionsInputs: ThreadConversationCapabilities;
}) {
  const projectPickerContent = (
    <ProjectPickerSheet
      visible={composerProjectSelectionBinding.projectPickerVisible}
      cwd={surfaceInputs.cwd}
      projects={projectsInputs.projects}
      discoveredProjects={projectsInputs.discoveredProjects}
      busy={composerProjectSelectionBinding.projectChangeBusy}
      error={composerProjectSelectionBinding.projectChangeError ?? projectsInputs.projectLoadError}
      onSelect={composerProjectSelectionBinding.selectProject}
      {...(projectsInputs.onAddProject === undefined
        ? {}
        : { onAddProject: projectsInputs.onAddProject })}
      {...(projectsInputs.onReadDirectory === undefined
        ? {}
        : { onReadDirectory: projectsInputs.onReadDirectory })}
      onClose={composerProjectSelectionBinding.closeProjectPicker}
      {...(projectsInputs.onManageProjects === undefined
        ? {}
        : {
            onManageProjects: () => {
              composerProjectSelectionBinding.closeProjectPicker();
              projectsInputs.onManageProjects?.();
            },
          })}
    />
  );
  const renameContent = (
    <ThreadRenameDialog
      visible={threadRenameBinding.threadRenameVisible}
      title={thread.title}
      onClose={threadRenameBinding.closeThreadRename}
      {...(actionsInputs.onRename === undefined ? {} : { onRename: actionsInputs.onRename })}
    />
  );
  return {
    reviewContent: <ContentReviewComposer targetPrefix="agent-response:" />,
    projectPickerContent,
    renameContent,
  };
}
