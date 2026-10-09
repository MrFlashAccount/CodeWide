import { fireEvent, render } from "@testing-library/react-native";
import { observable } from "@legendapp/state";
import { Pressable, Text } from "react-native";

import type { AgentProvidersState } from "../src/data/agentProviders";
import { parseAgentProvidersResult } from "../src/data/agentProviders";
import { UsageMenu } from "../src/features/accounts/UsageMenu";
import { WorkspaceAccountUsageMenu } from "../src/features/accounts/WorkspaceAccountUsageMenu";
import { AgentProviderStatusList } from "../src/features/connections/AgentProviderStatusList";
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

it("shows provider sign-in in the server detail, not as an account", () => {
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
  const view = render(<AgentProviderStatusList agentProviders={{ state$ }} connectionId="server" />);
  expect(view.getByText("Claude · not signed in — run `claude` on the server to sign in")).toBeOnTheScreen();
  expect(view.getByText("Codex · connected")).toBeOnTheScreen();
  const old = render(<AgentProviderStatusList agentProviders={{ state$ }} connectionId="other" />);
  expect(old.queryByTestId("agent-provider-status")).toBeNull();
});
