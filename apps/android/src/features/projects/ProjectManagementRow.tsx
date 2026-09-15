import { Pressable, View } from "react-native";
import { colors } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight } from "../../ui/AppListRow.types";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text } from "../../ui/Typography";
import { SECTION_HEIGHT, styles } from "./SidebarProjects.styles";
import type { ProjectManagementState } from "./projectManagement";
import type { ProjectManagementProps, ProjectManagerItem } from "./projectManagementContract";
import type { SidebarProject } from "./sidebarProjects";

function projectManagerItemHeight(item: ProjectManagerItem): number | undefined {
  switch (item.kind) {
    case "section":
      return SECTION_HEIGHT;
    case "project":
      return listRowHeight.double;
    case "server":
      return listRowHeight.single;
    case "message":
      return undefined;
  }
}
function projectLocation(project: SidebarProject, serverName: string | undefined): string {
  const path = project.path;
  return serverName === undefined ? path : `${serverName} · ${path}`;
}
function projectActions(
  project: SidebarProject,
  pinned: readonly SidebarProject[],
  disabled: boolean,
): ActionMenuItem[] {
  const actions: ActionMenuItem[] = [
    {
      id: "pin",
      label: project.pinned ? "Unpin project" : "Pin project",
      icon: project.pinned ? "pin" : "pin-outline",
      disabled,
    },
  ];
  if (project.pinned) {
    actions.push(
      {
        id: "up",
        label: "Move up",
        icon: "arrow-up",
        disabled: disabled || pinned[0]?.key === project.key,
      },
      {
        id: "down",
        label: "Move down",
        icon: "arrow-down",
        disabled: disabled || pinned.at(-1)?.key === project.key,
      },
    );
  }
  return actions;
}
export { projectManagerItemHeight };
export function ProjectManagementRow({
  props,
  state,
  item,
  index,
}: {
  props: ProjectManagementProps;
  state: ProjectManagementState;
  item: ProjectManagerItem;
  index: number;
}) {
  const { servers, onToggle, onMove, onBrowse } = props;
  const { pending, rowIconSize, setChoosingServer, pinned, rows, change } = state;

  const previousSameKind = rows[index - 1]?.kind === item.kind;
  const nextSameKind = rows[index + 1]?.kind === item.kind;
  const position = previousSameKind
    ? nextSameKind
      ? "middle"
      : "last"
    : nextSameKind
      ? "first"
      : "only";
  if (item.kind === "message")
    return (
      <Text
        accessibilityRole={item.error ? "alert" : undefined}
        style={item.error ? styles.error : styles.empty}
      >
        {item.message}
      </Text>
    );
  if (item.kind === "server") {
    const { server } = item;
    return (
      <AppListRow
        title={server.name}
        position={position}
        fixedHeight={listRowHeight.single}
        accessibilityLabel={`Add project on ${server.name}`}
        onPress={() => {
          setChoosingServer(false);
          onBrowse(server.id);
        }}
        leadingIcon={{ name: "server-outline", size: rowIconSize, color: colors.textMuted }}
      />
    );
  }
  if (item.kind === "section") {
    const { section } = item;
    return (
      <View testID={`project-section:${section.title}`} style={styles.section}>
        {section.onToggle === undefined ? (
          <View style={styles.sectionHeading}>
            <Text numberOfLines={1} accessibilityRole="header" style={styles.sectionTitle}>
              {section.title}
            </Text>
            {section.projects.length > 0 && (
              <Text style={styles.sectionCount}>{section.projects.length}</Text>
            )}
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${section.title} projects, ${section.projects.length}`}
            accessibilityState={{ expanded: section.expanded }}
            onPress={section.onToggle}
            style={styles.sectionToggle}
          >
            <View style={styles.sectionHeading}>
              <Text numberOfLines={1} style={styles.sectionTitle}>
                {section.title}
              </Text>
              <Text style={styles.sectionCount}>{section.projects.length}</Text>
            </View>
            <View style={styles.menuSlot}>
              <InlineIcon
                name={section.expanded ? "chevron-down" : "chevron-forward"}
                role="caption"
                color={colors.textMuted}
              />
            </View>
          </Pressable>
        )}
      </View>
    );
  }
  const { project } = item;
  return (
    <ActionMenu
      key={project.key}
      accessibilityLabel={`Actions for ${project.name}, ${project.subtitle}`}
      actions={projectActions(project, pinned, pending !== null)}
      onSelect={(id) => {
        if (id === "pin") void change(project, () => onToggle(project));
        else if (id === "up" || id === "down")
          void change(project, () => onMove(project, id === "up" ? -1 : 1));
      }}
    >
      <AppListRow
        title={project.name}
        position={position}
        fixedHeight={listRowHeight.double}
        description={projectLocation(
          project,
          servers.length > 1
            ? servers.find((server) => server.id === project.connectionId)?.name
            : undefined,
        )}
        accessibilityLabel={`Actions for ${project.name}, ${project.subtitle}`}
        accessibilityHint="Pin or arrange this project"
        disabled={pending !== null}
        leadingIcon={{ name: "folder-outline", size: rowIconSize, color: colors.textMuted }}
        {...(pending === project.key
          ? { trailingBusy: true }
          : {
              trailingIcon: {
                name: "ellipsis-horizontal",
                size: rowIconSize,
                color: colors.textMuted,
              },
            })}
      />
    </ActionMenu>
  );
}
