import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react-native";

import type { V2Query, V2QueryResult } from "@codewide/sync-client/v2";
import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import { ObservableResource } from "../src/v2/application/resources/resource";
import type { V2Runtime } from "../src/v2/application/v2Runtime";
import type { QueryResource } from "../src/v2/application/resources/queryResource";
import { savedServerId } from "../src/v2/domain/ids";
import { AccountSettingsScreen } from "../src/v2/features/settings/AccountSettingsScreen";

const SERVER_ID = savedServerId("server-a");

describe("V2 account settings", () => {
  it("hides account login when the live server does not advertise both login commands", () => {
    renderAccountSettings(["account.login.start"]);

    expect(screen.queryByLabelText("Add Codex account")).toBeNull();
    expect(screen.getByText("Adding Codex accounts is unavailable on this server.")).toBeTruthy();
  });

  it("offers account login when the live server advertises start and cancel", () => {
    renderAccountSettings(["account.login.start", "account.login.cancel"]);

    expect(screen.getByLabelText("Add Codex account").props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it("keeps retained login capabilities visible but non-actionable", () => {
    renderAccountSettings(["account.login.start", "account.login.cancel"], "retained");

    expect(screen.getByLabelText("Add Codex account").props.accessibilityState.disabled).toBe(true);
  });
});

function renderAccountSettings(
  commands: string[],
  capabilityAuthority: "live" | "retained" = "live",
): void {
  const runtime = {
    commandActivations: { execute: async () => undefined },
    query: (_savedServerId: string, query: V2Query) =>
      readyQuery(
        queryResult(query, commands),
        query.kind === "capabilities.read" ? capabilityAuthority : "live",
      ),
  } as unknown as V2Runtime;
  render(
    <V2RuntimeProvider runtime={runtime}>
      <AccountSettingsScreen
        copyLoginCode={async () => undefined}
        openLoginUrl={async () => undefined}
        savedServerId={SERVER_ID}
      />
    </V2RuntimeProvider>,
  );
}

function readyQuery(
  result: V2QueryResult,
  authority: "live" | "retained",
): ObservableResource<unknown> {
  const snapshot = {
    authority,
    status: authority === "live" ? ("ready" as const) : ("loading" as const),
    value: result,
  };
  const inner = {
    actionable: () => authority === "live",
    refresh: async () => undefined,
    snapshot: () => snapshot,
    subscribe: () => () => undefined,
  };
  const outer = new ObservableResource<QueryResource | null>(null);
  // WHY: the fake exposes the exact QueryResource surface and authority state consumed by the screen.
  outer.publish({ status: "ready", value: inner as unknown as QueryResource });
  return outer;
}

function queryResult(query: V2Query, commands: string[]): V2QueryResult {
  if (query.kind === "capabilities.read") {
    return {
      commands,
      kind: "capabilities.read",
      limits: {
        catalogPerPartitionMax: 100,
        historyPageMax: 100,
        queueMaxBytes: 4_194_304,
        queueMaxEvents: 2_048,
        turnWindowMax: 36,
      },
      queries: [],
    };
  }
  return { activeProfileId: null, allExhausted: false, kind: "accounts.list", profiles: [] };
}
