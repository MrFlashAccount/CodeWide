import { View } from "react-native";
import {
  ThreadListHeaderAction,
  ThreadListHeaderRow,
} from "../../presentation/navigation/ThreadListHeader";
import { AppText as Text } from "../../ui/Typography";
import { serverScopeIncludes } from "../../services/servers/serverScope";
import { SidebarProjectHeader } from "../projects/SidebarProjects";
import { ThreadFilterMenu, ThreadListMenu } from "./ThreadListMenus";
import { styles } from "./ThreadSidebar.styles";
import type { ThreadSidebarProps } from "./ThreadSidebarContract";
import { GlobalVoiceEntryAction } from "./GlobalVoiceEntryAction";
import { ThreadListSearchRow } from "./ThreadListSearchRow";

export function ThreadSidebarHeader({
  props,
  setQuery,
}: {
  props: ThreadSidebarProps;
  setQuery: (query: string) => void;
}) {
  const {
    filter,
    globalVoice,
    mode,
    onBackToProjects,
    onFilterChange,
    onManageProjects,
    onManageTerminals,
    onModeChange,
    onOpenSearch,
    onRefreshAccountRateLimits,
    onSelectServer,
    onSettings,
    project,
    remote,
    searchContent,
    servers,
    serverScope,
  } = props;
  if (searchContent !== null) {
    return null;
  }
  return (
    <View style={styles.threadListHeaderChrome}>
      <ThreadListHeaderRow testID="thread-list-header-row">
        {mode === "archived" && project === null && (
          <ThreadListHeaderAction
            accessibilityLabel="Back to threads"
            name="arrow-back"
            onPress={() => {
              onModeChange("active");
            }}
          />
        )}
        {project !== null ? (
          <SidebarProjectHeader
            archived={mode === "archived"}
            onBack={() => {
              setQuery("");
              if (mode === "archived") {
                onModeChange("active");
              } else {
                onBackToProjects();
              }
            }}
            onRoot={onBackToProjects}
            project={project}
            serverName={
              servers.find((entry) => entry.id === project.connectionId)?.name ?? "Server"
            }
          />
        ) : mode === "archived" ? (
          <Text
            ellipsizeMode="tail"
            numberOfLines={1}
            style={styles.serverTitle}
            testID="server-title"
          >
            Archived threads
          </Text>
        ) : (
          <Text numberOfLines={1} style={styles.serverTitle} testID="server-title">
            Threads
          </Text>
        )}
        <GlobalVoiceEntryAction {...globalVoice} />
        <ThreadFilterMenu
          mode={mode}
          onSelect={onFilterChange}
          onSelectServer={onSelectServer}
          projectScoped={project !== null}
          selected={filter}
          servers={servers}
          serverScope={serverScope}
        />
        <ThreadListMenu
          accountDatabase={remote.accountRateLimitsDatabase}
          accountServers={servers.filter((server) => serverScopeIncludes(serverScope, server.id))}
          archived={mode === "archived"}
          onManageProjects={onManageProjects}
          onManageTerminals={onManageTerminals}
          onSettings={onSettings}
          onToggleArchive={() => {
            setQuery("");
            onModeChange(mode === "archived" ? "active" : "archived");
          }}
          {...(onRefreshAccountRateLimits === undefined ? {} : { onRefreshAccountRateLimits })}
        />
      </ThreadListHeaderRow>
      <ThreadListSearchRow onOpenSearch={onOpenSearch} />
    </View>
  );
}
