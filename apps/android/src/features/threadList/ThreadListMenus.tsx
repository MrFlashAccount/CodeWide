import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import { catalogSummaryModel } from "../../data/catalog-summary-model";
import type { AccountUsageServer } from "../../data/thread-list-account-usage";
import type { ServerScope } from "../../services/servers/serverScope";
import { colors, iconSize } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { WorkspaceAccountUsageMenu } from "../accounts/WorkspaceAccountUsageMenu";
import { serverGlyph, type ThreadListServer } from "../connections/connectionPresentation";
import { threadFilterLabel, threadFilterOptions, type ThreadListFilter } from "./threadListFilters";
import { styles } from "./ThreadListMenus.styles";
import type { ThreadListMode } from "./threadListModel";

export function ThreadListMenu({
  accountDatabase,
  accountServers,
  archived,
  catalogConnectionIds,
  includeArchiveCount = true,
  onManageProjects,
  onRefreshAccountRateLimits,
  onSettings,
  onToggleArchive,
}: {
  accountDatabase: AccountRateLimitsDatabase | null;
  accountServers: readonly AccountUsageServer[];
  archived: boolean;
  catalogConnectionIds: string[];
  includeArchiveCount?: boolean;
  onManageProjects: () => void;
  onRefreshAccountRateLimits?: () => Promise<unknown>;
  onSettings: () => void;
  onToggleArchive: () => void;
}) {
  const archivedCount = useSelector(() =>
    includeArchiveCount && !archived ? catalogSummaryModel.count(catalogConnectionIds) : null,
  );
  return (
    <WorkspaceAccountUsageMenu
      database={accountDatabase}
      servers={accountServers}
      {...(onRefreshAccountRateLimits === undefined
        ? {}
        : { onRefresh: onRefreshAccountRateLimits })}
      actions={[
        {
          icon: "folder-outline",
          id: "projects",
          label: "Manage Projects",
          onPress: onManageProjects,
        },
        {
          id: "archived",
          label: archived ? "Active threads" : "Archived threads",
          ...(archivedCount === null
            ? {}
            : {
                description: archivedCount === 1 ? "1 thread" : `${String(archivedCount)} threads`,
              }),
          icon: archived ? "chatbubbles-outline" : "archive-outline",
          onPress: onToggleArchive,
        },
        { icon: "settings-outline", id: "settings", label: "Settings", onPress: onSettings },
      ]}
      align="end"
      placement="bottom"
    >
      <Pressable accessibilityLabel="Thread list menu" style={styles.headerIcon}>
        <Ionicons color={colors.text} name="ellipsis-vertical" size={iconSize.navigation} />
      </Pressable>
    </WorkspaceAccountUsageMenu>
  );
}

export function ThreadFilterMenu({
  mode,
  onSelect,
  onSelectServer,
  projectScoped,
  selected,
  servers,
  serverScope,
}: {
  mode: ThreadListMode;
  onSelect: (filter: ThreadListFilter) => void;
  onSelectServer: (scope: ServerScope) => void;
  projectScoped: boolean;
  selected: ThreadListFilter;
  servers: readonly ThreadListServer[];
  serverScope: ServerScope;
}) {
  const [open, setOpen] = useState(false);
  const showServerFilter = !projectScoped && servers.length > 1;
  const selectedServer =
    serverScope.kind === "connection"
      ? servers.find((server) => server.id === serverScope.connectionId)
      : undefined;
  const serverFilterActive = showServerFilter && selectedServer !== undefined;
  const threadFilterActive = selected !== "all";
  const threadOptions = threadFilterOptions(mode);
  const activeCount = Number(serverFilterActive) + Number(threadFilterActive);
  const selectedCriteria = [
    ...(serverFilterActive ? [selectedServer.name] : []),
    ...(threadFilterActive ? [threadFilterLabel(selected, mode)] : []),
  ];
  const accessibilityLabel =
    selectedCriteria.length === 0
      ? "Thread filters, no filters selected"
      : `Thread filters, ${selectedCriteria.join(" and ")} selected`;
  const actions: ActionMenuItem[] = [
    ...(showServerFilter
      ? [
          {
            id: "server:all",
            keepOpen: true,
            label: "All servers",
            section: "Server",
            selected: serverScope.kind === "all",
          },
          ...servers.map((server) => ({
            id: `server:${server.id}`,
            keepOpen: true,
            label: `${serverGlyph(server)} ${server.name}`,
            section: "Server",
            selected: serverScope.kind === "connection" && serverScope.connectionId === server.id,
          })),
        ]
      : []),
    ...threadOptions.map((option) => ({
      id: `thread:${option.id}`,
      label: option.label,
      section: "Threads",
      selected: selected === option.id,
    })),
  ];
  const select = (id: string) => {
    if (id.startsWith("server:")) {
      const connectionId = id.slice("server:".length);
      onSelectServer(
        connectionId === "all" ? { kind: "all" } : { connectionId, kind: "connection" },
      );
      return;
    }
    if (!id.startsWith("thread:")) {
      return;
    }
    const filter = threadOptions.find((option) => option.id === id.slice("thread:".length));
    if (filter !== undefined) {
      onSelect(filter.id);
    }
  };
  const trigger = (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ expanded: open, selected: activeCount > 0 }}
      hitSlop={2}
      style={({ pressed }) => [styles.threadFilterButton, pressed && styles.pressed]}
    >
      <Ionicons
        color={colors.text}
        name={activeCount > 0 ? "filter" : "filter-outline"}
        size={iconSize.action}
      />
      {activeCount > 0 && (
        <View style={styles.threadFilterActiveDot} testID="thread-filter-active-dot" />
      )}
    </Pressable>
  );
  return (
    <ActionMenu
      accessibilityLabel={accessibilityLabel}
      actions={actions}
      align="end"
      menuWidth={344}
      onOpenChange={setOpen}
      onSelect={select}
      placement="bottom"
    >
      {trigger}
    </ActionMenu>
  );
}
