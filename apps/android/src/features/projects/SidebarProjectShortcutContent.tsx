import { View } from "react-native";
import { colors } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text } from "../../ui/Typography";
import { ServerIcon } from "../connections/ServerIcon";
import type { SidebarProject, SidebarProjectServer } from "./sidebarProjects";
import { styles } from "./SidebarProjects.styles";

const folderIcon = { color: colors.textMuted, name: "folder-outline", role: "body" } as const;

type ShortcutContentProps = {
  readonly pending: boolean;
  readonly project: SidebarProject;
  readonly server?: SidebarProjectServer | undefined;
};

/**
 * Keeps the shortcut's text, leading icon and unread indicator stable during
 * commands. One leading icon: the server's across several servers, else the folder.
 */
export function SidebarProjectShortcutContent(props: ShortcutContentProps): React.JSX.Element {
  return (
    <>
      {props.server === undefined ? (
        <InlineIcon {...folderIcon} />
      ) : (
        <View accessibilityLabel={`Server ${props.server.name}`} accessible>
          <ServerIcon iconId={props.server.iconId} metric="body" />
        </View>
      )}
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
