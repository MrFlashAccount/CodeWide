import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text } from "../../ui/Typography";
import { serverScopeIncludes } from "../../services/servers/serverScope";
import { SidebarProjectHeader } from "../projects/SidebarProjects";
import { ThreadFilterMenu, ThreadListMenu } from "./ThreadListMenus";
import { styles } from "./ThreadSidebar.styles";
import type { ThreadSidebarProps } from "./ThreadSidebarContract";

export function ThreadSidebarHeader({
  props,
  setQuery,
}: {
  props: ThreadSidebarProps;
  setQuery: (query: string) => void;
}) {
  const {
    remote,
    project,
    onBackToProjects,
    onManageProjects,
    servers,
    serverScope,
    mode,
    filter,
    onOpenSearch,
    searchContent,
    onModeChange,
    onFilterChange,
    onSelectServer,
    onSettings,
    onRefreshAccountRateLimits,
  } = props;
  return (
    <View style={searchContent === null ? styles.threadListHeaderChrome : undefined}>
      <View style={styles.sidebarHeader}>
        <View style={styles.serverTitleRow}>
          {mode === "archived" && project === null && (
            <Pressable
              onPress={() => onModeChange("active")}
              style={styles.headerIcon}
              accessibilityLabel="Back to threads"
            >
              <Ionicons name="arrow-back" size={iconSize.navigation} color={colors.text} />
            </Pressable>
          )}
          {project !== null ? (
            <SidebarProjectHeader
              project={project}
              serverName={
                servers.find((entry) => entry.id === project.connectionId)?.name ?? "Server"
              }
              archived={mode === "archived"}
              onRoot={onBackToProjects}
              onBack={() => {
                setQuery("");
                if (mode === "archived") onModeChange("active");
                else onBackToProjects();
              }}
            />
          ) : mode === "archived" ? (
            <Text
              testID="server-title"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={styles.serverTitle}
            >
              Archived threads
            </Text>
          ) : (
            <Text testID="server-title" numberOfLines={1} style={styles.serverTitle}>
              Threads
            </Text>
          )}
          <ThreadListMenu
            onManageProjects={onManageProjects}
            onSettings={onSettings}
            catalogConnectionIds={
              serverScope.kind === "all"
                ? servers.map((entry) => entry.id)
                : [serverScope.connectionId]
            }
            onToggleArchive={() => {
              setQuery("");
              onModeChange(mode === "archived" ? "active" : "archived");
            }}
            archived={mode === "archived"}
            includeArchiveCount={project === null}
            accountDatabase={remote.accountRateLimitsDatabase}
            accountServers={servers.filter((server) => serverScopeIncludes(serverScope, server.id))}
            {...(onRefreshAccountRateLimits === undefined ? {} : { onRefreshAccountRateLimits })}
          />
        </View>
      </View>
      {searchContent === null && (
        <View style={styles.mobileSearchWrap}>
          <View style={styles.threadSearchRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search threads and messages"
              onPress={onOpenSearch}
              style={[styles.searchBox, styles.threadSearchBox]}
            >
              <InlineIcon name="search" color={colors.textMuted} role="body" />
              <Text style={styles.searchInput}>Search</Text>
            </Pressable>
            <ThreadFilterMenu
              mode={mode}
              projectScoped={project !== null}
              servers={servers}
              serverScope={serverScope}
              selected={filter}
              onSelect={onFilterChange}
              onSelectServer={onSelectServer}
            />
          </View>
        </View>
      )}
    </View>
  );
}
