import { useEvent } from "../react/useEvent";
import {
  CLOSED_PROJECT_MANAGEMENT,
  OPEN_PROJECT_MANAGEMENT,
  type LocalProjectManagementPage,
} from "./localProjectManagementPage";
import { AddProjectSheet, ProjectManagementSheet } from "./ProjectManagementSheets";

/**
 * Presents Manage Projects and its Add project browser without navigating, for a destination
 * that must stay focused and mounted beneath them (a PR's review chat, whose route lives in the
 * Pull requests tab while `/projects` belongs to Threads). Both are the same native sheet windows
 * the `/projects` routes present; the owner keeps the page and receives every page change.
 */
export function LocalProjectManagement({
  onNavigate,
  page,
}: {
  readonly onNavigate: (page: LocalProjectManagementPage) => void;
  readonly page: LocalProjectManagementPage;
}): React.JSX.Element | null {
  const browse = useEvent((connectionId: string | null): void => {
    onNavigate({ connectionId, kind: "add" });
  });
  const close = useEvent((): void => {
    onNavigate(CLOSED_PROJECT_MANAGEMENT);
  });
  const closeBrowser = useEvent((): void => {
    onNavigate(OPEN_PROJECT_MANAGEMENT);
  });
  if (page.kind === "closed") {
    return null;
  }
  return (
    <>
      {/* Hidden, not unmounted, while Add project covers it, like the covered `/projects` route. */}
      <ProjectManagementSheet
        initialConnectionId={null}
        onBrowse={browse}
        onClose={close}
        visible={page.kind === "projects"}
      />
      {page.kind === "add" ? (
        <AddProjectSheet initialConnectionId={page.connectionId} onClose={closeBrowser} visible />
      ) : null}
    </>
  );
}
