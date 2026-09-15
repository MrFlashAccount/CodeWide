import { useEvent } from "../../react/useEvent";
import type { ConversationOwner } from "../../ui/use-conversation-owner";
import { useConversationState } from "../../ui/use-conversation-scope";

/** Picker completion belongs to one mounted conversation activation. */
export function useComposerProjectSelection(
  composerScope: string,
  onChangeProject: ((cwd: string | null) => Promise<void>) | undefined,
  dismissComposerKeyboardForOverlay: () => void,
  conversationOwner: ConversationOwner,
) {
  const [projectPickerVisible, setProjectPickerVisible] = useConversationState(
    composerScope,
    () => false,
  );

  const [projectChangeBusy, setProjectChangeBusy] = useConversationState(
    composerScope,
    () => false,
  );

  const [projectChangeError, setProjectChangeError] = useConversationState<string | null>(
    composerScope,
    () => null,
  );

  const openProjectPicker = useEvent(() => {
    if (onChangeProject === undefined) return;
    dismissComposerKeyboardForOverlay();
    setProjectChangeError(null);
    setProjectPickerVisible(true);
  });

  const closeProjectPicker = useEvent(() => {
    setProjectPickerVisible(false);
  });

  const selectProject = useEvent(async (nextCwd: string | null) => {
    if (onChangeProject === undefined || projectChangeBusy) return;
    setProjectChangeBusy(true);
    setProjectChangeError(null);
    const cause = await onChangeProject(nextCwd).then(
      () => null,
      (error: unknown) => error,
    );
    if (!conversationOwner.isCurrent()) return;
    setProjectChangeBusy(false);
    if (cause === null) {
      closeProjectPicker();
    } else {
      setProjectChangeError(cause instanceof Error ? cause.message : "Could not change project");
    }
  });
  return {
    projectPickerVisible,
    projectChangeBusy,
    projectChangeError,
    openProjectPicker,
    closeProjectPicker,
    selectProject,
  };
}
