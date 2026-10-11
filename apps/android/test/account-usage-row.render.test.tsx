import { describe, expect, it } from "@jest/globals";
import { render } from "@testing-library/react-native";

import { AccountProviderHeading, AccountUsageRow } from "../src/features/accounts/AccountUsageRow";
import type { UsageAccountRow } from "../src/features/accounts/usageAccounts";

function row(overrides: Partial<UsageAccountRow>): UsageAccountRow {
  return {
    active: true,
    key: "server/account",
    label: "account@example.com",
    plan: "Pro",
    provider: { id: "codex", name: "Codex" },
    resetsIn: "3d 8h",
    servers: [],
    value: { fiveHour: 78, kind: "remaining", weekly: 35 },
    ...overrides,
  };
}

describe("usage menu account row", () => {
  it("shows the shares left as rings and a percentage, and the reset as an icon and time", () => {
    const view = render(<AccountUsageRow row={row({})} />);
    expect(view.getByText("account@example.com")).toBeTruthy();
    expect(view.getByTestId("usage-account-rings-server/account")).toBeTruthy();
    expect(view.getByLabelText("Pro · resets in 3d 8h")).toBeTruthy();
    expect(view.getByText("3d 8h")).toBeTruthy();
    expect(view.queryByText(/reset/u)).toBeNull();
    expect(view.getByLabelText("Account in use")).toBeTruthy();
  });

  it("tones a refresh in amber and a problem with the account in red", () => {
    const stale = render(<AccountUsageRow row={row({ value: { kind: "note", text: "Refresh", tone: "attention" } })} />);
    expect(stale.getByTestId("usage-account-attention-server/account")).toBeTruthy();
    const broken = render(<AccountUsageRow row={row({ value: { kind: "note", text: "Signed out", tone: "problem" } })} />);
    expect(broken.getByTestId("usage-account-problem-server/account")).toBeTruthy();
    expect(broken.getByText("Signed out")).toBeTruthy();
  });

  it("marks servers by their icons, not by name", () => {
    const view = render(
      <AccountUsageRow
        row={row({ servers: [{ iconId: "laptop", id: "laptop", name: "Laptop" }] })}
      />,
    );
    expect(view.getByLabelText("On Laptop")).toBeTruthy();
    expect(view.queryByText("Laptop")).toBeNull();
  });

  it("heads a provider's accounts with its mark and name", () => {
    const view = render(<AccountProviderHeading provider={{ id: "claude", name: "Claude" }} />);
    expect(view.getByText("Claude")).toBeTruthy();
    expect(view.getByTestId("provider-icon-claude", { includeHiddenElements: true })).toBeTruthy();
  });
});
