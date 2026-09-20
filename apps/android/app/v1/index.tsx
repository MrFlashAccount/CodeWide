import { useIsFocused, usePathname } from "expo-router";

import { ConversationSelectionPlaceholder } from "../../src/features/conversation/ConversationEmptyState";
import { useWorkspaceRouteResources } from "../../src/services/workspace/workspaceRouteResources";
import { CommitOnChangeProbe } from "../../src/ui/CommitProbe";

/** Opens the initial desktop conversation while mobile keeps All as a real destination. */
export default function V1AllRoute(): React.JSX.Element | null {
  const focused = useIsFocused();
  const pathname = usePathname();
  const { desktop, list } = useWorkspaceRouteResources();
  const defaultThread = list.defaultDesktopThreadId;
  if (!desktop) {
    return null;
  }
  const defaultSelection =
    focused && pathname === "/v1" && defaultThread !== null && list.selectedThreadKey === null ? (
      <CommitOnChangeProbe
        onCommit={() => {
          list.selectThread(defaultThread);
        }}
        revision={defaultThread}
        scope="v1-desktop-default-thread"
      />
    ) : null;
  return (
    <>
      <ConversationSelectionPlaceholder />
      {defaultSelection}
    </>
  );
}
