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
  archivedCount,
  props,
}: {
  archivedCount: number;
  props: MobileThreadsProps;
}) {
  const {
    filter,
    mode,
    onBackToProjects,
    onFilterChange,
    onManageProjects,
    onModeChange,
    onOpenSearch,
    onQueryChange,
    onRefreshAccountRateLimits,
    onSelectServer,
    onSettings,
    project,
    remote,
    searchContent,
    servers,
    serverScope,
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
            archived={mode === "archived"}
            onBack={() => {
              onQueryChange("");
              if (mode === "archived") {
                onModeChange("active");
              } else {
                onBackToProjects();
              }
            }}
            onRoot={onBackToProjects}
            project={project}
            serverName={
              servers.find((entry) => entry.id === project.connectionId)?.name ??
              activeServer?.name ??
              "Server"
            }
          />
        ) : mode === "archived" ? (
          <View style={styles.mobileTitleSelector}>
            <Pressable
              accessibilityLabel="Back to threads"
              onPress={() => {
                onModeChange("active");
              }}
              style={styles.headerIcon}
            >
              <Ionicons color={colors.text} name="arrow-back" size={iconSize.navigation} />
            </Pressable>
            <View style={styles.mobileIdentity}>
              <Text numberOfLines={1} style={styles.mobileTitle}>
                Archived threads
              </Text>
              <Text numberOfLines={1} style={styles.mobileSubtitle}>
                {archivedCount === 1 ? "1 thread" : `${String(archivedCount)} threads`}
              </Text>
            </View>
          </View>
        ) : (
          <Text numberOfLines={1} style={[styles.mobileTitle, styles.mobileTitleGrow]}>
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
            onQueryChange("");
            onModeChange(mode === "archived" ? "active" : "archived");
          }}
          {...(onRefreshAccountRateLimits === undefined ? {} : { onRefreshAccountRateLimits })}
        />
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
