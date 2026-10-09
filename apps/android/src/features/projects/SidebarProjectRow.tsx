import { useEvent } from "../../react/useEvent";
import type { ActionMenuItem } from "../../ui/ActionMenu.types";
import { RowActionTrigger } from "../../ui/RowActionTrigger";
import { SidebarProjectShortcutContent } from "./SidebarProjectShortcutContent";
import { RowActionMenu } from "../../ui/RowActionMenu";
import type { SidebarProject, SidebarProjectActions } from "./sidebarProjects";
import { styles } from "./SidebarProjects.styles";
import { useProjectShortcutActions } from "./projectShortcutActions";

type SidebarProjectRowProps = {
  actions?: SidebarProjectActions | undefined;
  onPress: () => void;
  project: SidebarProject;
};

/** A pinned shortcut retains its own command lifetime when a virtualized row is recycled. */
export function SidebarProjectRow(props: SidebarProjectRowProps): React.JSX.Element {
  return <ProjectShortcut key={props.project.key} {...props} />;
}

function ProjectShortcut({ actions, onPress, project }: SidebarProjectRowProps): React.JSX.Element {
  const press = useEvent(onPress);
  const { pending, select } = useProjectShortcutActions(project, actions);
  const menuActions: readonly ActionMenuItem[] = [
    {
      disabled: actions === undefined || pending,
      icon: "pin-outline",
      id: "unpin",
      label: "Unpin",
    },
    {
      disabled: actions === undefined || pending,
      icon: "checkmark-done-outline",
      id: "read",
      label: "Mark all as read",
    },
  ];
  return (
    <RowActionMenu actions={menuActions} onSelect={select} rowKey={project.key}>
      {(onLongPress) => (
        <ProjectTrigger
          onLongPress={onLongPress}
          onPress={press}
          pending={pending}
          project={project}
        />
      )}
    </RowActionMenu>
  );
}

function ProjectTrigger({
  onLongPress,
  onPress,
  pending,
  project,
}: {
  readonly onLongPress: (() => void) | undefined;
  readonly onPress: () => void;
  readonly pending: boolean;
  readonly project: SidebarProject;
}): React.JSX.Element {
  return (
    <RowActionTrigger
      accessibilityHint={project.path}
      accessibilityLabel={`Open project ${project.name}${project.serverLabel === null ? "" : `, ${project.serverLabel}`}${project.unread ? ", unread chats" : ""}`}
      accessibilityRole="button"
      gestureTestId="project-row"
      onLongPress={onLongPress}
      onPress={onPress}
      style={[styles.project, styles.shortcut]}
    >
      <SidebarProjectShortcutContent pending={pending} project={project} />
    </RowActionTrigger>
  );
}
