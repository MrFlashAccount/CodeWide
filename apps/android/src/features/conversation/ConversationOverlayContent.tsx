import { ContentReviewComposer } from "../../rendering/ContentReviewHost";
import type { ConversationSurfaceCapabilities } from "./conversationSurfaceCapabilities";
import type { useComposerProjectSelection } from "../projects/composerProjectSelection";
import type { ProjectConversationCapabilities } from "../projects/projectConversationCapabilities";
import { ProjectPickerSheet } from "../projects/ProjectPickerSheet";
import type { useThreadRename } from "../turnActions/threadRename";
import { ThreadRenameDialog } from "../turnActions/ThreadRenameDialog";
import type { ThreadConversationCapabilities } from "../turnActions/threadConversationCapabilities";
import type { ThreadListItem } from "../threadList/threadListTypes";

/** Builds only conversation-local overlays; application destinations belong to Router. */
export function createConversationOverlayContent({
  actionsInputs,
  composerProjectSelectionBinding,
  projectsInputs,
  surfaceInputs,
  thread,
  threadRenameBinding,
}: {
  readonly actionsInputs: ThreadConversationCapabilities;
  readonly composerProjectSelectionBinding: ReturnType<typeof useComposerProjectSelection>;
  readonly projectsInputs: ProjectConversationCapabilities;
  readonly surfaceInputs: ConversationSurfaceCapabilities;
  readonly thread: ThreadListItem;
  readonly threadRenameBinding: ReturnType<typeof useThreadRename>;
}) {
  const projectPickerContent = (
    <ProjectPickerSheet
      busy={composerProjectSelectionBinding.projectChangeBusy}
      cwd={surfaceInputs.cwd}
      discoveredProjects={projectsInputs.discoveredProjects}
      error={composerProjectSelectionBinding.projectChangeError ?? projectsInputs.projectLoadError}
      onSelect={composerProjectSelectionBinding.selectProject}
      projects={projectsInputs.projects}
      visible={composerProjectSelectionBinding.projectPickerVisible}
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
      onClose={threadRenameBinding.closeThreadRename}
      title={thread.title}
      visible={threadRenameBinding.threadRenameVisible}
      {...(actionsInputs.onRename === undefined ? {} : { onRename: actionsInputs.onRename })}
    />
  );
  return {
    projectPickerContent,
    renameContent,
    reviewContent: <ContentReviewComposer targetPrefix="agent-response:" />,
  };
}
