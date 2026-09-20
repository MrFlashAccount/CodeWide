import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compactSource, sourceHasJsxElement } from "./source-contract";

const screen = compactSource(
  readFileSync(new URL("../app/v1/_layout.tsx", import.meta.url), "utf8"),
);

const sidebarBody = compactSource(
  readFileSync(new URL("../src/features/threadList/ThreadSidebar.tsx", import.meta.url), "utf8"),
);
const mobileBody = compactSource(
  readFileSync(new URL("../src/features/threadList/MobileThreads.tsx", import.meta.url), "utf8"),
);
const sidebarHeader = compactSource(
  readFileSync(
    new URL("../src/features/threadList/ThreadSidebarHeader.tsx", import.meta.url),
    "utf8",
  ),
);
const mobileHeader = compactSource(
  readFileSync(
    new URL("../src/features/threadList/MobileThreadsHeader.tsx", import.meta.url),
    "utf8",
  ),
);
const listMenus = compactSource(
  readFileSync(new URL("../src/features/threadList/ThreadListMenus.tsx", import.meta.url), "utf8"),
);
const serverSelection = compactSource(
  readFileSync(new URL("../src/services/servers/serverScope.ts", import.meta.url), "utf8"),
);
const newChat = compactSource(
  readFileSync(new URL("../app/v1/V1WorkspaceRouteComposition.tsx", import.meta.url), "utf8"),
);
const newThreadButton = compactSource(
  readFileSync(
    new URL("../src/features/projects/NewThreadFloatingButton.tsx", import.meta.url),
    "utf8",
  ),
);
const listFilters = compactSource(
  readFileSync(new URL("../src/features/threadList/threadListFilters.ts", import.meta.url), "utf8"),
);
const rowContent = compactSource(
  readFileSync(new URL("../src/features/threadList/ThreadRowContent.tsx", import.meta.url), "utf8"),
);
const projectList = compactSource(
  readFileSync(new URL("../src/features/threadList/projectThreadList.ts", import.meta.url), "utf8"),
);

const ownerWorkspaceThreadList = compactSource(
  readFileSync(
    new URL("../src/features/workspace/WorkspaceThreadList.tsx", import.meta.url),
    "utf8",
  ),
);

const listBinding = compactSource(
  readFileSync(
    new URL("../src/features/workspace/WorkspaceThreadList.tsx", import.meta.url),
    "utf8",
  ),
);

describe("unified thread filters", () => {
  it("keeps server management out of filters and new thread as a floating action", () => {
    const mobileThreads = mobileBody;
    const filters = listMenus.slice(listMenus.indexOf("function ThreadFilterMenu("));

    expect(mobileThreads).toContain('searchContent === null && mode === "active"');
    expect(
      sourceHasJsxElement(mobileThreads, "NewThreadFloatingButton", [
        "projectName={project?.name ?? null}",
        "onPress={onNewThread}",
      ]),
    ).toBe(true);
    expect(newThreadButton).toContain(
      "style={({ pressed }) => [styles.newThreadFab, pressed && styles.pressed]}",
    );
    expect(filters).not.toContain("Add server");
    expect(filters).not.toContain("Settings");
    expect(listMenus).toContain('id: "settings"');
    expect(listMenus).toContain('label: "Settings"');
    expect(listMenus).toContain('icon: "settings-outline"');
    expect(listMenus).toContain("onPress: onSettings");
  });

  it("uses one filter entry point on compact and expanded layouts", () => {
    const sidebar = sidebarHeader;
    const mobile = mobileHeader;
    const filters = listMenus.slice(listMenus.indexOf("function ThreadFilterMenu("));

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
    expect(sidebarBody).toContain('searchContent === null && mode === "active"');
    expect(
      sourceHasJsxElement(sidebarBody, "NewThreadFloatingButton", [
        "projectName={project?.name ?? null}",
        "onPress={onNewThread}",
      ]),
    ).toBe(true);
  });

  it("treats server and thread state as independent filter criteria", () => {
    const filters = listMenus.slice(listMenus.indexOf("function ThreadFilterMenu("));
    const selectServer = serverSelection;

    expect(serverSelection).toContain(
      "const [requested, setRequested] = useState<ServerScope>(ALL_SERVER_SCOPE)",
    );
    expect(serverSelection).toContain('connections.length <= 1 || requested.kind === "all"');
    expect(filters).toContain('id: "server:all"');
    expect(filters).toContain('section: "Server"');
    expect(filters).toContain('section: "Threads"');
    expect(filters).toContain('label: "All servers"');
    expect(filters).not.toContain("<AppListRow");
    expect(filters).not.toContain("<ControlOption");
    expect(filters).toContain('selectedCriteria.join(" and ")');
    expect(listFilters).toContain('label: "Approval needed"');
    expect(selectServer).toContain("setRequested(next)");
    expect(selectServer).toContain("readonly select: (next: ServerScope) => void");
    expect(selectServer).not.toContain("setActiveThreadId(");
    expect(selectServer).toContain("consumeDesktopDefaultThread()");
    for (const body of [sidebarBody, mobileBody])
      expect(body.match(/serverScope\.kind === "all" && servers\.length > 1/gu)).toHaveLength(1);
    expect(rowContent).toContain("accessibilityLabel={`Server ${server.name}`}");
    expect(ownerWorkspaceThreadList).toContain(
      "initialOffset: mobileThreadOffset.read(sidebarScopeKey)",
    );
    expect(ownerWorkspaceThreadList).toMatch(
      /onOffsetChange: \(offset\) => \{\s*mobileThreadOffset\.write\(sidebarScopeKey, offset\);\s*\}/u,
    );
    expect(projectList).toContain(
      '`${serverScopeKey}:${sidebarMode}${sidebarProject === null ? "" : `:${sidebarProject.key}`}`',
    );
  });

  it("hides the server criterion in projects and removes impossible archive states", () => {
    const filters = listMenus.slice(listMenus.indexOf("function ThreadFilterMenu("));
    expect(filters).toContain("const showServerFilter = !projectScoped && servers.length > 1");
    expect(listFilters).toContain('mode === "archived"');
    expect(listFilters).toContain('{ id: "all", label: "All archived" }');
    expect(listFilters).toContain('filter === "running" || filter === "approval"');
  });

  it("keeps usage near the thread list without a duplicate Accounts navigation entry", () => {
    const menu = listMenus.slice(0, listMenus.indexOf("function ThreadFilterMenu("));

    expect(menu).toContain("<WorkspaceAccountUsageMenu");
    expect(menu).toContain("database={accountDatabase}");
    expect(menu).toContain("servers={accountServers}");
    expect(menu).not.toContain('id: "accounts"');
    expect(menu).not.toContain("onPress: onOpenAccounts");
    expect(menu).toContain('label: archived ? "Active threads" : "Archived threads"');
    expect(menu).toContain("onPress: onToggleArchive");
    expect(menu).toContain('id: "settings"');
    expect(menu).toContain('label: "Settings"');
    expect(menu).toContain('icon: "settings-outline"');
    expect(menu).toContain("onPress: onSettings");
    for (const header of [sidebarHeader, mobileHeader])
      expect(header.match(/onSettings=\{onSettings\}/gu)).toHaveLength(1);
  });

  it("creates a new sidebar thread in the selected project context", () => {
    const createSidebarThread = newChat.slice(
      newChat.indexOf("const createSidebarThread ="),
      newChat.indexOf("const openGlobalSearch ="),
    );

    expect(createSidebarThread).toContain("if (list.projectSelection.sidebarProject !== null)");
    expect(createSidebarThread).toContain("list.projectSelection.sidebarProject.connectionId");
    expect(createSidebarThread).toContain("list.projectSelection.sidebarProject.path");
    expect(listBinding.match(/onNewThread: createSidebarThread/gu)).toHaveLength(2);
    expect(newThreadButton).toContain(
      'accessibilityLabel={projectName === null ? "New thread" : `New thread in ${projectName}`}',
    );
  });

  it("scopes account subscriptions identically in folded and unfolded thread lists", () => {
    for (const body of [sidebarHeader, mobileHeader]) {
      expect(body).toContain("accountDatabase={remote.accountRateLimitsDatabase}");
      expect(body).toContain(
        "accountServers={servers.filter((server) => serverScopeIncludes(serverScope, server.id))}",
      );
    }
  });

  it("keeps title, Voice, Search, filters and overflow in one ordered header row", () => {
    for (const body of [sidebarHeader, mobileHeader]) {
      const row = body.indexOf("<ThreadListHeaderRow");
      const header = body.indexOf("<SidebarProjectHeader");
      const search = body.indexOf('accessibilityLabel="Search threads and messages"');
      const filter = body.indexOf("<ThreadFilterMenu");
      const voice = body.indexOf("<GlobalVoiceEntryAction");
      const overflow = body.indexOf("<ThreadListMenu");
      expect(header).toBeGreaterThan(row);
      expect(voice).toBeGreaterThan(header);
      expect(search).toBeGreaterThan(voice);
      expect(filter).toBeGreaterThan(search);
      expect(overflow).toBeGreaterThan(filter);
      expect(body.slice(header + 1)).not.toContain("<SidebarProjectHeader");
      expect(body).not.toContain("threadSearchRow");
      expect(body).not.toContain("mobileSearchWrap");
      expect(body).toContain('onModeChange(mode === "archived" ? "active" : "archived")');
      expect(body).not.toContain("showArchive={project === null}");
      expect(body).not.toContain("archivedCount");
      expect(body).not.toContain("includeArchiveCount");
    }
  });
});
