import { useWorkspaceRouteResources } from "../../src/services/workspace/workspaceRouteResources";
import { CommitOnChangeProbe } from "../../src/ui/CommitProbe";

/** Opens the initial desktop conversation while mobile keeps All as a real destination. */
export default function V1AllRoute(): React.JSX.Element | null {
  const { desktop, list } = useWorkspaceRouteResources();
  const defaultThread = list.defaultDesktopThreadId;
  return desktop && defaultThread !== null && list.selectedThreadKey === null ? (
    <CommitOnChangeProbe
      onCommit={() => {
        list.selectThread(defaultThread);
      }}
      revision={defaultThread}
      scope="v1-desktop-default-thread"
    />
  ) : null;
}
