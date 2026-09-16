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
    filter,
    mode,
    onBackToProjects,
    onFilterChange,
    onManageProjects,
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
  return (
    <View style={searchContent === null ? styles.threadListHeaderChrome : undefined}>
      <View style={styles.sidebarHeader}>
        <View style={styles.serverTitleRow}>
          {mode === "archived" && project === null && (
            <Pressable
              accessibilityLabel="Back to threads"
              onPress={() => {
                onModeChange("active");
              }}
              style={styles.headerIcon}
            >
              <Ionicons color={colors.text} name="arrow-back" size={iconSize.navigation} />
            </Pressable>
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
          <ThreadListMenu
            accountDatabase={remote.accountRateLimitsDatabase}
            accountServers={servers.filter((server) => serverScopeIncludes(serverScope, server.id))}
            archived={mode === "archived"}
            catalogConnectionIds={
              serverScope.kind === "all"
                ? servers.map((entry) => entry.id)
                : [serverScope.connectionId]
            }
            includeArchiveCount={project === null}
            onManageProjects={onManageProjects}
            onSettings={onSettings}
            onToggleArchive={() => {
              setQuery("");
              onModeChange(mode === "archived" ? "active" : "archived");
            }}
            {...(onRefreshAccountRateLimits === undefined ? {} : { onRefreshAccountRateLimits })}
          />
        </View>
      </View>
      {searchContent === null && (
        <View style={styles.mobileSearchWrap}>
          <View style={styles.threadSearchRow}>
            <Pressable
              accessibilityLabel="Search threads and messages"
              accessibilityRole="button"
              onPress={onOpenSearch}
              style={[styles.searchBox, styles.threadSearchBox]}
            >
              <InlineIcon color={colors.textMuted} name="search" role="body" />
              <Text style={styles.searchInput}>Search</Text>
            </Pressable>
            <ThreadFilterMenu
              mode={mode}
              onSelect={onFilterChange}
              onSelectServer={onSelectServer}
              projectScoped={project !== null}
              selected={filter}
              servers={servers}
              serverScope={serverScope}
            />
          </View>
        </View>
      )}
    </View>
  );
}
