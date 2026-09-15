import { Ionicons } from "@expo/vector-icons";
import { useSelector } from "@legendapp/state/react";
import { useState } from "react";
import { Pressable, View } from "react-native";
import type { AccountRateLimitsDatabase } from "../../data/account-rate-limits-database";
import { catalogSummaryModel } from "../../data/catalog-summary-model";
import type { AccountUsageServer } from "../../data/thread-list-account-usage";
import { colors, iconSize } from "../../theme";
import { ActionMenu, type ActionMenuItem } from "../../ui/ActionMenu";
import { WorkspaceAccountUsagePopover } from "../accounts/WorkspaceAccountUsagePopover";
import { serverGlyph, type ThreadListServer } from "../connections/connectionPresentation";
import { ALL_SERVERS_ID } from "../navigation/serverSelection";
import { threadFilterLabel, threadFilterOptions, type ThreadListFilter } from "./threadListFilters";
import { styles } from "./ThreadListMenus.styles";
import { type ThreadListMode } from "./threadListModel";

export function ThreadListMenu({
  onManageProjects,
  onSettings,
  catalogConnectionIds,
  onToggleArchive,
  archived,
  accountDatabase,
  accountServers,
  includeArchiveCount = true,
  onRefreshAccountRateLimits,
}: {
  onManageProjects(): void;
  onSettings(): void;
  catalogConnectionIds: string[];
  onToggleArchive(): void;
  archived: boolean;
  accountDatabase: AccountRateLimitsDatabase | null;
  accountServers: readonly AccountUsageServer[];
  includeArchiveCount?: boolean;
  onRefreshAccountRateLimits?(): Promise<unknown>;
}) {
  const archivedCount = useSelector(() =>
    includeArchiveCount && !archived ? catalogSummaryModel.count(catalogConnectionIds) : null,
  );
  return (
    <WorkspaceAccountUsagePopover
      database={accountDatabase}
      servers={accountServers}
      {...(onRefreshAccountRateLimits === undefined
        ? {}
        : { onRefresh: onRefreshAccountRateLimits })}
      placement="bottom"
      align="end"
      actions={[
        {
          id: "projects",
          label: "Manage Projects",
          icon: "folder-outline",
          onPress: onManageProjects,
        },
        {
          id: "archived",
          label: archived ? "Active threads" : "Archived threads",
          ...(archivedCount === null
            ? {}
            : { description: archivedCount === 1 ? "1 thread" : `${archivedCount} threads` }),
          icon: archived ? "chatbubbles-outline" : "archive-outline",
          onPress: onToggleArchive,
        },
        { id: "settings", label: "Settings", icon: "settings-outline", onPress: onSettings },
      ]}
    >
      <Pressable accessibilityLabel="Thread list menu" style={styles.headerIcon}>
        <Ionicons name="ellipsis-vertical" size={iconSize.navigation} color={colors.text} />
      </Pressable>
    </WorkspaceAccountUsagePopover>
  );
}

export function ThreadFilterMenu({
  mode,
  projectScoped,
  servers,
  activeServerId,
  selected,
  onSelect,
  onSelectServer,
}: {
  mode: ThreadListMode;
  projectScoped: boolean;
  servers: readonly ThreadListServer[];
  activeServerId: string;
  selected: ThreadListFilter;
  onSelect(filter: ThreadListFilter): void;
  onSelectServer(serverId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const showServerFilter = !projectScoped && servers.length > 1;
  const selectedServer = servers.find((server) => server.id === activeServerId);
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
            id: `server:${ALL_SERVERS_ID}`,
            section: "Server",
            label: "All servers",
            selected: activeServerId === ALL_SERVERS_ID,
            keepOpen: true,
          },
          ...servers.map((server) => ({
            id: `server:${server.id}`,
            section: "Server",
            label: `${serverGlyph(server)} ${server.name}`,
            selected: activeServerId === server.id,
            keepOpen: true,
          })),
        ]
      : []),
    ...threadOptions.map((option) => ({
      id: `thread:${option.id}`,
      section: "Threads",
      label: option.label,
      selected: selected === option.id,
    })),
  ];
  const select = (id: string) => {
    if (id.startsWith("server:")) {
      onSelectServer(id.slice("server:".length));
      return;
    }
    if (!id.startsWith("thread:")) return;
    const filter = threadOptions.find((option) => option.id === id.slice("thread:".length));
    if (filter !== undefined) onSelect(filter.id);
  };
  const trigger = (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ selected: activeCount > 0, expanded: open }}
      hitSlop={2}
      style={({ pressed }) => [styles.threadFilterButton, pressed && styles.pressed]}
    >
      <Ionicons
        name={activeCount > 0 ? "filter" : "filter-outline"}
        size={iconSize.action}
        color={colors.text}
      />
      {activeCount > 0 && (
        <View testID="thread-filter-active-dot" style={styles.threadFilterActiveDot} />
      )}
    </Pressable>
  );
  return (
    <ActionMenu
      accessibilityLabel={accessibilityLabel}
      actions={actions}
      menuWidth={344}
      placement="bottom"
      align="end"
      onOpenChange={setOpen}
      onSelect={select}
    >
      {trigger}
    </ActionMenu>
  );
}
