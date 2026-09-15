import { useEvent } from "../../react/useEvent";
import { useConversationState } from "../../ui/use-conversation-scope";

export function useThreadRename(composerScope: string) {
  const [threadRenameVisible, setThreadRenameVisible] = useConversationState(
    composerScope,
    () => false,
  );

  const openThreadRename = useEvent(() => {
    setThreadRenameVisible(true);
  });

  const closeThreadRename = useEvent(() => {
    setThreadRenameVisible(false);
  });
  return { threadRenameVisible, openThreadRename, closeThreadRename };
}
