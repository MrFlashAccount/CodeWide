import { View } from "react-native";
import {
  ThreadListHeaderAction,
  ThreadListHeaderRow,
} from "../../presentation/navigation/ThreadListHeader";
import { serverScopeIncludes } from "../../services/servers/serverScope";
import { SidebarProjectHeader } from "../projects/SidebarProjectViews";
import { CatalogTitle } from "../../ui/CatalogTitle";
import { styles } from "./MobileThreads.styles";
import type { MobileThreadsProps } from "./MobileThreadsContract";
import { ThreadFilterMenu, ThreadListMenu } from "./ThreadListMenus";
import { GlobalVoiceEntryAction } from "./GlobalVoiceEntryAction";
import { ThreadListSearchRow } from "./ThreadListSearchRow";

type MobileThreadsHeaderProps = Pick<
  MobileThreadsProps,
  | "filter"
  | "globalVoice"
  | "mode"
  | "onBackToProjects"
  | "onFilterChange"
  | "onManageProjects"
  | "onManageTerminals"
  | "onModeChange"
  | "onOpenSearch"
  | "onQueryChange"
  | "onRefreshAccountRateLimits"
  | "onSelectServer"
  | "onSettings"
  | "project"
  | "remote"
  | "searchContent"
  | "servers"
  | "serverScope"
>;

export function MobileThreadsHeader({ props }: { props: MobileThreadsHeaderProps }) {
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
  if (searchContent !== null) {
    return null;
  }
  return (
    <View style={styles.threadListHeaderChrome}>
      <ThreadListHeaderRow testID="thread-list-header-row">
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
            <ThreadListHeaderAction
              accessibilityLabel="Back to threads"
              name="arrow-back"
              onPress={() => {
                onModeChange("active");
              }}
            />
            <View style={styles.mobileIdentity}>
              <CatalogTitle layout={styles.mobileTitle}>Archived threads</CatalogTitle>
            </View>
          </View>
        ) : (
          <CatalogTitle layout={[styles.mobileTitle, styles.mobileTitleGrow]}>Threads</CatalogTitle>
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
          agentProviders={remote.agentProviders}
          archived={mode === "archived"}
          onManageProjects={onManageProjects}
          onManageTerminals={onManageTerminals}
          onSettings={onSettings}
          onToggleArchive={() => {
            onQueryChange("");
            onModeChange(mode === "archived" ? "active" : "archived");
          }}
          {...(onRefreshAccountRateLimits === undefined ? {} : { onRefreshAccountRateLimits })}
        />
      </ThreadListHeaderRow>
      <ThreadListSearchRow onOpenSearch={onOpenSearch} />
    </View>
  );
}
