import { AppRouteSheet } from "../../ui/AppRouteSheet";
import type { ProjectManagementProps } from "./projectManagementContract";
import { ProjectManagementContent } from "./SidebarProjectViews";

/**
 * Route-owned project manager. The transparent route is its only presentation
 * owner; no second native modal can outlive or obscure the Router entry.
 */
export function SidebarProjectsRouteSurface(props: ProjectManagementProps): React.JSX.Element {
  return (
    <AppRouteSheet
      dismissLabel="Close project management"
      onDismiss={props.onClose}
      testID="project-management-route"
    >
      <ProjectManagementContent props={props} />
    </AppRouteSheet>
  );
}
