import { fireEvent, render } from "@testing-library/react-native";
import { observable } from "@legendapp/state";
import { Pressable, Text } from "react-native";

import type { AgentProvidersState } from "../src/data/agentProviders";
import { parseAgentProvidersResult } from "../src/data/agentProviders";
import { ProviderAccounts } from "../src/features/accounts/ProviderAccounts";
import { UsageMenu } from "../src/features/accounts/UsageMenu";
import { WorkspaceAccountUsageMenu } from "../src/features/accounts/WorkspaceAccountUsageMenu";
import { AgentProviderMarks } from "../src/features/connections/AgentProviderMarks";
import { ConversationHeader } from "../src/features/conversation/header/ConversationHeader";
import { ContentMenu } from "../src/ui/ContentMenu";

const claudeThread = {
  codewideAgent: {
    capabilities: { "accounts.rateLimits": false, "threads.compact": true },
    primary: false,
    provider: "claude",
    providerName: "Claude",
  },
  id: "claude-thread",
};

function openMenuBody(view: ReturnType<typeof render>) {
  fireEvent(view.UNSAFE_getByType(ContentMenu), "openChange", true);
  return render(view.UNSAFE_getByType(ContentMenu).props.children);
}

it("keeps the context ring of a Claude thread without Codex account rows", () => {
  const view = render(
    <ConversationHeader
      accountRateLimitsDatabase={null}
      archived={false}
      closeThreadSearch={jest.fn()}
      compact={false}
      currentUsage={null}
      cwd="/w"
      deleteThread={undefined}
      dismissComposerKeyboardForOverlay={jest.fn()}
      draftConnectionId={null}
      draftThreadId={null}
      forkTargets={undefined}
      historyActivityModel={null}
      historyActivityResourceId={null}
      newChat={false}
      onArchive={undefined}
      onBack={undefined}
      onCompact={undefined}
      onFork={undefined}
      onRefreshAccountRateLimits={undefined}
      onTogglePin={undefined}
      onUnarchive={undefined}
      openThreadRename={jest.fn()}
      pinned={false}
      readOnly
      // WHY: the header reads only the agent descriptor and usage from the remote thread.
      remoteThread={claudeThread as never}
      server={undefined}
      sessionCompactionCount={null}
      setThreadSearchVisible={jest.fn()}
      thread={{ id: "claude-thread", pinned: false, preview: "", serverId: "server", timestamp: 1, title: "Claude chat", unread: 0 }}
      threadChatModel={null}
      threadSearchVisible={false}
    />,
  );
  expect(view.getByLabelText("Context usage")).toBeOnTheScreen();
  // The provider is shown on the model chip, not in the title.
  expect(view.queryByTestId("provider-icon-claude", { includeHiddenElements: true })).toBeNull();
  const body = openMenuBody(view);
  expect(body.getByTestId("usage-context-section")).toBeOnTheScreen();
  expect(body.queryByTestId("usage-accounts-section")).toBeNull();
});

it("does not read the account pool when the menu has no account database", () => {
  const onRefresh = jest.fn(async () => undefined);
  const view = render(
    <WorkspaceAccountUsageMenu database={null} onRefresh={onRefresh} servers={[{ id: "server", name: "Server" }]}>
      <Pressable accessibilityLabel="Menu">
        <Text>Menu</Text>
      </Pressable>
    </WorkspaceAccountUsageMenu>,
  );
  fireEvent(view.UNSAFE_getByType(ContentMenu), "openChange", true);
  expect(onRefresh).not.toHaveBeenCalled();
});

it("titles the account rows with the pool owner's provider", () => {
  const view = render(
    <UsageMenu
      accountSources={[
        {
          id: "server",
          name: "Server",
          rateLimits: {
            accountPool: {
              activeProfileId: "a",
              allExhausted: false,
              nextResetAt: null,
              profiles: [
                {
                  active: true,
                  email: null,
                  enabled: true,
                  exhaustedIndefinitely: false,
                  exhaustedUntil: null,
                  id: "a",
                  lastUsedAt: null,
                  planType: null,
                  priority: 0,
                  rateLimits: null,
                  rateLimitsError: null,
                  rateLimitsUpdatedAt: null,
                },
              ],
            },
            connectionId: "server",
            error: null,
            id: "server",
            snapshot: null,
            status: "ready",
            updatedAt: 0,
          },
        },
      ]}
      accountsTitle="Codex accounts"
    >
      <Pressable accessibilityLabel="Menu">
        <Text>Menu</Text>
      </Pressable>
    </UsageMenu>,
  );
  expect(openMenuBody(view).getByText("Codex accounts")).toBeOnTheScreen();
});

it("marks the server's agents with their sign-in status, not as accounts", () => {
  const value = parseAgentProvidersResult({
    hostCapabilities: {},
    providers: [
      { auth: "unknown", capabilities: {}, id: "codex", name: "Codex", planLabel: null, primary: true, status: "live" },
      { auth: "unauthenticated", capabilities: {}, id: "claude", name: "Claude", planLabel: null, primary: false, status: "live" },
    ],
  });
  if (value === null) throw new Error("fixture must parse");
  const state$ = observable<Record<string, AgentProvidersState>>({
    server: { status: "ready", value },
  });
  const view = render(<AgentProviderMarks agentProviders={{ state$ }} connectionId="server" />);
  expect(view.getByLabelText("Claude · not signed in — run `claude` on the server to sign in")).toBeOnTheScreen();
  expect(view.getByLabelText("Codex · connected")).toBeOnTheScreen();
  expect(view.getByTestId("agent-provider-claude")).toBeOnTheScreen();
  expect(view.getByTestId("agent-provider-codex")).toBeOnTheScreen();
  const old = render(<AgentProviderMarks agentProviders={{ state$ }} connectionId="other" />);
  expect(old.queryByTestId("agent-provider-status")).toBeNull();
});

const claudeLimits = {
  updatedAt: 1_800_000_000,
  windows: [
    { id: "five_hour", kind: "session", label: "Session", resetsAt: 1_800_010_000, status: "allowed", usedPercent: 25, windowDurationMins: 300 },
    { id: "seven_day", kind: "weekly", label: "Weekly", resetsAt: 1_800_300_000, status: "allowed", usedPercent: 60, windowDurationMins: 10_080 },
  ],
};

function providerState(claude: Record<string, unknown>) {
  const value = parseAgentProvidersResult({
    hostCapabilities: {},
    providers: [
      { auth: "unknown", capabilities: { "accounts.pool": true }, id: "codex", name: "Codex", planLabel: null, primary: true, status: "live" },
      { auth: "authenticated", capabilities: { "accounts.pool": false }, id: "claude", name: "Claude", planLabel: "max", primary: false, status: "live", ...claude },
    ],
  });
  if (value === null) throw new Error("fixture must parse");
  return observable<Record<string, AgentProvidersState>>({ server: { status: "ready", value } });
}

it("lists the Claude sign-in as a read-only account with its limits", () => {
  const state$ = providerState({ accountLabel: "dev@example.com", rateLimits: claudeLimits });
  const view = render(<ProviderAccounts agentProviders={{ state$ }} connectionId="server" serverName="Studio" />);
  expect(view.getByText("Claude")).toBeOnTheScreen();
  expect(view.queryByText("Codex")).toBeNull();
  expect(view.getByText("dev@example.com")).toBeOnTheScreen();
  expect(view.getByText("Max · Signed in via Claude Code on Studio")).toBeOnTheScreen();
  expect(view.getByLabelText("Weekly 40% left. Five-hour 75% left")).toBeOnTheScreen();
  // No pool actions: no switching, login or removal.
  expect(view.queryByLabelText(/Actions for/u)).toBeNull();
  expect(view.queryByText(/Add .* account/u)).toBeNull();
  fireEvent.press(view.getByTestId("provider-account-claude"));
  expect(view.getByTestId("account-reset-window-remaining-five_hour")).toHaveTextContent("75% left");
  expect(view.getByTestId("account-reset-window-remaining-seven_day")).toHaveTextContent("40% left");
});

it("tells how to sign in when Claude is signed out on the server", () => {
  const state$ = providerState({ auth: "unauthenticated", planLabel: null, rateLimits: null });
  const view = render(<ProviderAccounts agentProviders={{ state$ }} connectionId="server" serverName="Studio" />);
  expect(view.getByText("Claude account")).toBeOnTheScreen();
  expect(view.getByText("Not signed in — run `claude` on the server")).toBeOnTheScreen();
  expect(view.queryByTestId("provider-limit-rings-claude")).toBeNull();
});

it("shows a Claude thread's subscription limits in its header usage menu", () => {
  const known = render(
    <WorkspaceAccountUsageMenu
      database={null}
      providerLimits={{ agentProviders: { state$: providerState({ rateLimits: claudeLimits }) }, connectionId: "server", provider: "claude" }}
      currentUsage={null}
      servers={[{ id: "server", name: "Server" }]}
      // WHY: the menu reads only the agent descriptor; usage comes from `currentUsage`.
      thread={claudeThread as never}
    >
      <Pressable accessibilityLabel="Menu">
        <Text>Menu</Text>
      </Pressable>
    </WorkspaceAccountUsageMenu>,
  );
  const body = openMenuBody(known);
  expect(body.getByText("Claude usage")).toBeOnTheScreen();
  expect(body.getByTestId("account-reset-window-remaining-seven_day")).toHaveTextContent("40% left");
  expect(body.queryByTestId("usage-accounts-section")).toBeNull();

  const pending = render(
    <WorkspaceAccountUsageMenu
      database={null}
      providerLimits={{ agentProviders: { state$: providerState({ rateLimits: null }) }, connectionId: "server", provider: "claude" }}
      currentUsage={null}
      servers={[{ id: "server", name: "Server" }]}
      // WHY: the menu reads only the agent descriptor; usage comes from `currentUsage`.
      thread={claudeThread as never}
    >
      <Pressable accessibilityLabel="Menu">
        <Text>Menu</Text>
      </Pressable>
    </WorkspaceAccountUsageMenu>,
  );
  expect(openMenuBody(pending).getByText("Usage unknown")).toBeOnTheScreen();
});
