import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource } from "./source-contract";

const screen = compactSource(readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8"));

describe("unified thread filters", () => {
  it("keeps server management out of filters and new thread as a floating action", () => {
    const mobileThreads = screen.slice(
      screen.indexOf("function MobileThreads("),
      screen.indexOf("function NewThreadFloatingButton("),
    );
    const filters = screen.slice(
      screen.indexOf("function ThreadFilterMenu("),
      screen.indexOf("function ThreadListSuspenseFallback("),
    );

    expect(mobileThreads).toContain('searchContent === null && mode === "active" && ( <NewThreadFloatingButton projectName={project?.name ?? null} onPress={onNewThread} /> )');
    expect(screen).toContain("style={({ pressed }) => [styles.newThreadFab, pressed && styles.pressed]}");
    expect(filters).not.toContain("Add server");
    expect(filters).not.toContain("Settings");
    expect(screen).toContain('{ id: "settings", label: "Settings", icon: "settings-outline", onPress: onSettings }');
  });

  it("uses one filter entry point on compact and expanded layouts", () => {
    const sidebar = screen.slice(
      screen.indexOf("function ThreadSidebar("),
      screen.indexOf("function SelectableThreadRow("),
    );
    const mobile = screen.slice(
      screen.indexOf("function MobileThreads("),
      screen.indexOf("function NewThreadFloatingButton("),
    );
    const filters = screen.slice(
      screen.indexOf("function ThreadFilterMenu("),
      screen.indexOf("function ThreadListSuspenseFallback("),
    );

    expect(screen).not.toContain('testID="server-rail"');
    expect(sidebar).not.toContain('accessibilityLabel="Choose server"');
    expect(mobile).not.toContain('accessibilityLabel="Choose server"');
    expect(sidebar).toContain("<ThreadFilterMenu");
    expect(mobile).toContain("<ThreadFilterMenu");
    expect(filters).toContain("<ActionMenu");
    expect(filters).toContain("menuWidth={344}");
    expect(filters).not.toContain("<AppPopover");
    expect(filters).not.toContain("<AppSheet");
    expect(filters).toContain('testID="thread-filter-active-dot"');
    expect(sidebar).toContain('searchContent === null && mode === "active" && ( <NewThreadFloatingButton projectName={project?.name ?? null} onPress={onNewThread} /> )');
  });

  it("treats server and thread state as independent filter criteria", () => {
    const filters = screen.slice(
      screen.indexOf("function ThreadFilterMenu("),
      screen.indexOf("function ThreadListSuspenseFallback("),
    );
    const selectServer = screen.slice(screen.indexOf("const selectServer ="), screen.indexOf("const openConnectionSheet ="));

    expect(screen).toContain("const [requestedServerId, setActiveServerId] = useState(ALL_SERVERS_ID)");
    expect(screen).toContain("servers.length <= 1 || requestedServerId === ALL_SERVERS_ID");
    expect(filters).toContain('id: `server:${ALL_SERVERS_ID}`');
    expect(filters).toContain('section: "Server"');
    expect(filters).toContain('section: "Threads"');
    expect(filters).toContain('label: "All servers"');
    expect(filters).not.toContain("<AppListRow");
    expect(filters).not.toContain("<ControlOption");
    expect(filters).toContain("selectedCriteria.join(\" and \")");
    expect(screen).toContain('label: "Approval needed"');
    expect(selectServer).toContain("setActiveServerId(serverId)");
    expect(selectServer).not.toContain("setActiveThreadId(");
    expect(selectServer).toContain("setDesktopDefaultThreadEnabled(false)");
    expect(screen.match(/activeServerId === ALL_SERVERS_ID && servers\.length > 1/gu)).toHaveLength(2);
    expect(screen).toContain('accessibilityLabel={`Server ${server.name}`}');
    expect(screen).toContain('initialOffset={mobileThreadOffset.read(sidebarScopeKey)}');
    expect(screen).toContain('onOffsetChange={(offset) => mobileThreadOffset.write(sidebarScopeKey, offset)}');
    expect(screen).toContain('`${activeServerId}:${sidebarMode}${sidebarProject === null ? "" : `:${sidebarProject.key}`}`');
  });

  it("hides the server criterion in projects and removes impossible archive states", () => {
    const filters = screen.slice(screen.indexOf("function ThreadFilterMenu("), screen.indexOf("function ThreadListSuspenseFallback("));
    expect(filters).toContain("const showServerFilter = !projectScoped && servers.length > 1");
    expect(screen).toContain('mode === "archived"');
    expect(screen).toContain('{ id: "all", label: "All archived" }');
    expect(screen).toContain('filter === "running" || filter === "approval"');
  });

  it("keeps usage near the thread list without a duplicate Accounts navigation entry", () => {
    const menu = screen.slice(
      screen.indexOf("function ThreadListMenu("),
      screen.indexOf("function ThreadFilterMenu("),
    );

    expect(menu).toContain("<UsagePopover");
    expect(menu).toContain("accountSources={accountSources}");
    expect(menu).not.toContain('id: "accounts"');
    expect(menu).not.toContain("onPress: onOpenAccounts");
    expect(menu).toContain('label: archived ? "Active threads" : "Archived threads"');
    expect(menu).toContain('onPress: onToggleArchive');
    expect(menu).toContain('{ id: "settings", label: "Settings", icon: "settings-outline", onPress: onSettings }');
    expect(screen.match(/onSettings=\{onSettings\}/gu)).toHaveLength(2);
  });

  it("creates a new sidebar thread in the selected project context", () => {
    const createSidebarThread = screen.slice(
      screen.indexOf("const createSidebarThread ="),
      screen.indexOf("const openNewChat ="),
    );

    expect(createSidebarThread).toContain("if (sidebarProject !== null)");
    expect(createSidebarThread).toContain("openNewChat(sidebarProject.connectionId, sidebarProject.path)");
    expect(screen.match(/onNewThread=\{createSidebarThread\}/gu)).toHaveLength(2);
    expect(screen).toContain('accessibilityLabel={projectName === null ? "New thread" : `New thread in ${projectName}`}');
  });

  it("passes the same account sources to folded and unfolded thread lists", () => {
    expect(screen.match(/accountSources=\{threadListAccountSources\}/gu)).toHaveLength(2);
    expect(screen).toContain(
      "activeServerId === ALL_SERVERS_ID ? null : activeServerId",
    );
  });

  it("places project breadcrumbs in the title row and keeps archive in the scope menu on both layouts", () => {
    for (const [start, end, searchStart] of [
      ["function ThreadSidebar(", "function SelectableThreadRow(", "<View style={styles.threadSearchRow}>"],
      ["function MobileThreads(", "function NewThreadFloatingButton(", "<View style={styles.mobileSearchWrap}>"],
    ]) {
      const body = screen.slice(screen.indexOf(start), screen.indexOf(end));
      const header = body.indexOf("<SidebarProjectHeader");
      expect(header).toBeGreaterThan(0);
      expect(header).toBeLessThan(body.indexOf(searchStart));
      expect(body.slice(header + 1)).not.toContain("<SidebarProjectHeader");
      expect(body).toContain('includeArchiveCount={project === null}');
      expect(body).toContain('onModeChange(mode === "archived" ? "active" : "archived")');
      expect(body).not.toContain('showArchive={project === null}');
    }
  });
});
