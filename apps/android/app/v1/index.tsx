import { useWorkspaceRouteResources } from "../../src/services/workspace/workspaceRouteResources";
import { CommitOnChangeProbe } from "../../src/ui/CommitProbe";

/** Opens the initial desktop conversation while mobile keeps All as a real destination. */
export default function V1AllRoute(): React.JSX.Element | null {
  const { desktop, list } = useWorkspaceRouteResources();
  const defaultThread = list.defaultDesktopThreadId;
  return desktop && defaultThread !== null && list.selectedThreadKey === null ? (
    <CommitOnChangeProbe
      // WHY: This callback stays render-local; repository policy delegates ordinary JSX callback memoization to React Compiler.
      // oxlint-disable-next-line react-doctor/jsx-no-new-function-as-prop
      onCommit={() => {
        list.selectThread(defaultThread);
      }}
      revision={defaultThread}
      scope="v1-desktop-default-thread"
    />
  ) : null;
}
