import { Ionicons } from "@expo/vector-icons";
import { Pressable, View } from "react-native";
import { colors, iconSize } from "../../theme";
import { InlineIcon } from "../../ui/InlineIcon";
import { AppText as Text } from "../../ui/Typography";
import { serverScopeIncludes } from "../../services/servers/serverScope";
import { SidebarProjectHeader } from "../projects/SidebarProjects";
import { styles } from "./MobileThreads.styles";
import type { MobileThreadsProps } from "./MobileThreadsContract";
import { ThreadFilterMenu, ThreadListMenu } from "./ThreadListMenus";

export function MobileThreadsHeader({
  props,
  archivedCount,
}: {
  props: MobileThreadsProps;
  archivedCount: number;
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
    onQueryChange,
    onOpenSearch,
    searchContent,
    onModeChange,
    onFilterChange,
    onSelectServer,
    onSettings,
    onRefreshAccountRateLimits,
  } = props;
  const activeServer =
    serverScope.kind === "connection"
      ? servers.find((server) => server.id === serverScope.connectionId)
      : undefined;
  return (
    <View style={searchContent === null ? styles.threadListHeaderChrome : undefined}>
      <View style={styles.mobileTitleRow}>
        {project !== null ? (
          <SidebarProjectHeader
            project={project}
            serverName={
              servers.find((entry) => entry.id === project.connectionId)?.name ??
              activeServer?.name ??
              "Server"
            }
            archived={mode === "archived"}
            onRoot={onBackToProjects}
            onBack={() => {
              onQueryChange("");
              if (mode === "archived") onModeChange("active");
              else onBackToProjects();
            }}
          />
        ) : mode === "archived" ? (
          <View style={styles.mobileTitleSelector}>
            <Pressable
              accessibilityLabel="Back to threads"
              onPress={() => onModeChange("active")}
              style={styles.headerIcon}
            >
              <Ionicons name="arrow-back" size={iconSize.navigation} color={colors.text} />
            </Pressable>
            <View style={styles.mobileIdentity}>
              <Text numberOfLines={1} style={styles.mobileTitle}>
                Archived threads
              </Text>
              <Text numberOfLines={1} style={styles.mobileSubtitle}>
                {archivedCount === 1 ? "1 thread" : `${archivedCount} threads`}
              </Text>
            </View>
          </View>
        ) : (
          <Text numberOfLines={1} style={[styles.mobileTitle, styles.mobileTitleGrow]}>
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
            onQueryChange("");
            onModeChange(mode === "archived" ? "active" : "archived");
          }}
          archived={mode === "archived"}
          includeArchiveCount={project === null}
          accountDatabase={remote.accountRateLimitsDatabase}
          accountServers={servers.filter((server) => serverScopeIncludes(serverScope, server.id))}
          {...(onRefreshAccountRateLimits === undefined ? {} : { onRefreshAccountRateLimits })}
        />
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
