import { View } from "react-native";
import { colors } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text } from "../../ui/Typography";
import type { SidebarProject } from "./sidebarProjects";
import { styles } from "./SidebarProjects.styles";

const folderIcon = { color: colors.textMuted, name: "folder-outline", role: "body" } as const;

type ShortcutContentProps = {
  readonly pending: boolean;
  readonly project: SidebarProject;
};

/** Keeps the shortcut's text, folder and unread indicator stable during commands. */
export function SidebarProjectShortcutContent(props: ShortcutContentProps): React.JSX.Element {
  return (
    <>
      <InlineIcon {...folderIcon} />
      <ProjectIdentity {...props} />
      <View style={styles.unreadSlot}>
        {props.project.unread && (
          <View style={styles.unread} testID={`project-unread:${props.project.key}`} />
        )}
      </View>
    </>
  );
}

function ProjectIdentity({ pending, project }: ShortcutContentProps): React.JSX.Element {
  return (
    <View style={styles.shortcutIdentity}>
      <Text numberOfLines={1} shimmering={pending} style={styles.name}>
        {project.name}
      </Text>
      {project.serverLabel !== null && (
        <Text numberOfLines={1} style={styles.serverLabel}>{` · ${project.serverLabel}`}</Text>
      )}
    </View>
  );
}
