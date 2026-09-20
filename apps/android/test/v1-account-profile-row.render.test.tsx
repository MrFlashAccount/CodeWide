import { afterEach, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import type { AccountPoolProfile } from "../src/data/account-pool";
import { AccountPoolEditor } from "../src/features/accounts/AccountPoolFeature";
import { AccountProfileRow } from "../src/features/accounts/AccountProfileRow";
import { accountLimitProgressColor } from "../src/features/accounts/accountResetPresentation";
import { colors } from "../src/theme";
import { getAppDialogRequest, invokeAppDialogAction, resetAppDialog } from "./mocks/AppDialog";

const NOW = new Date("2026-09-20T12:00:00Z").getTime();

function profile(resetsAt: number): AccountPoolProfile {
  return {
    active: false,
    email: "account@example.com",
    enabled: true,
    exhaustedIndefinitely: false,
    exhaustedUntil: resetsAt,
    id: "account",
    lastUsedAt: null,
    planType: "pro",
    priority: 0,
    rateLimits: {
      rateLimitResetCredits: {
        availableCount: 3n,
        credits: [
          {
            description: "Saved for later",
            expiresAt: Math.floor(NOW / 1_000) + 3_600,
            grantedAt: Math.floor(NOW / 1_000) - 300,
            id: "later",
            resetType: "codexRateLimits",
            status: "available",
            title: "Later reset",
          },
          {
            description: null,
            expiresAt: null,
            grantedAt: Math.floor(NOW / 1_000) - 100,
            id: "no-expiry",
            resetType: "codexRateLimits",
            status: "available",
            title: null,
          },
          {
            description: "Use this first",
            expiresAt: Math.floor(NOW / 1_000) + 60,
            grantedAt: Math.floor(NOW / 1_000) - 600,
            id: "earlier",
            resetType: "codexRateLimits",
            status: "available",
            title: "Earlier reset",
          },
        ],
      },
      rateLimits: {
        credits: null,
        individualLimit: null,
        limitId: "codex",
        limitName: "Codex",
        planType: null,
        primary: {
          resetsAt: Math.floor(NOW / 1_000) + 4 * 60 * 60,
          usedPercent: 25,
          windowDurationMins: 300,
        },
        rateLimitReachedType: "rate_limit_reached",
        secondary: { resetsAt, usedPercent: 100, windowDurationMins: 10_080 },
        spendControlReached: null,
      },
      rateLimitsByLimitId: null,
    },
    rateLimitsError: null,
    rateLimitsUpdatedAt: Math.floor(NOW / 1_000),
  };
}

function renderRow(
  account: AccountPoolProfile,
  onConsumeResetCredit = jest.fn(() =>
    Promise.resolve({ accountPool: snapshot(account), outcome: "reset" as const }),
  ),
) {
  const run = jest.fn((operation: () => Promise<unknown>) => {
    operation().then(
      () => undefined,
      () => undefined,
    );
  });
  const view = render(
    <AccountProfileRow
      busy={false}
      connectionId="server"
      count={1}
      index={0}
      onActivate={jest.fn(() => Promise.resolve(snapshot(account)))}
      onConsumeResetCredit={onConsumeResetCredit}
      onRemove={jest.fn(() => Promise.resolve(snapshot(account)))}
      onUpdate={jest.fn(() => Promise.resolve(snapshot(account)))}
      profile={account}
      run={run}
    />,
  );
  return { onConsumeResetCredit, run, view };
}

function snapshot(account: AccountPoolProfile) {
  return {
    activeProfileId: account.id,
    allExhausted: false,
    nextResetAt: account.exhaustedUntil,
    profiles: [account],
  };
}

afterEach(() => {
  jest.useRealTimers();
  resetAppDialog();
});

it("uses the warning color only below fifteen percent remaining", () => {
  expect(accountLimitProgressColor(14)).toBe(colors.amber);
  expect(accountLimitProgressColor(15)).toBe(colors.text);
  expect(accountLimitProgressColor(null)).toBe(colors.text);
});

it("expands reset windows inline and exposes the disclosure state", () => {
  jest.useFakeTimers().setSystemTime(NOW);
  const { view } = renderRow(profile(Math.floor(NOW / 1_000) + 7 * 24 * 60 * 60));
  const disclosure = view.getByTestId("account-profile-account");
  expect(disclosure.props.accessibilityState).toMatchObject({ expanded: false });
  expect(view.queryByText(/resets in/u)).toBeNull();
  expect(view.getByText(/Reset ×3/u)).toBeTruthy();
  expect(view.getByLabelText("Weekly 0% left. Five-hour 75% left")).toBeTruthy();
  expect(view.getByTestId("account-limit-rings-account")).toHaveStyle({ height: 36, width: 36 });
  const weeklyRing = view.getByTestId("account-limit-rings-account-weekly");
  const fiveHourRing = view.getByTestId("account-limit-rings-account-five-hour");
  expect(weeklyRing.props.r).toBeGreaterThan(fiveHourRing.props.r);
  for (const progressRing of [
    view.getByTestId("account-limit-rings-account-weekly-progress"),
    view.getByTestId("account-limit-rings-account-five-hour-progress"),
  ]) {
    expect(progressRing.props.strokeWidth).toBe(2);
  }
  expect(view.queryByText("chevron-down")).toBeNull();
  expect(view.queryByTestId("account-reset-details-account")).toBeNull();

  fireEvent.press(disclosure);

  expect(view.getByTestId("account-profile-account").props.accessibilityState).toMatchObject({
    expanded: true,
  });
  expect(view.getByTestId("account-reset-details-account")).toBeTruthy();
  expect(view.getByText("Weekly window")).toBeTruthy();
  expect(view.getByText("5-hour window")).toBeTruthy();
  expect(view.getByLabelText("Weekly window remaining").props.accessibilityValue).toEqual({
    max: 100,
    min: 0,
    now: 0,
  });
  expect(view.getByLabelText("5-hour window remaining").props.accessibilityValue).toEqual({
    max: 100,
    min: 0,
    now: 75,
  });
  expect(view.getByText("Resets in 7d")).toBeTruthy();
  expect(view.getByText("Resets in 4h")).toBeTruthy();
  expect(view.getByText("75% left")).toBeTruthy();
  expect(view.getByText("0% left")).toBeTruthy();
  expect(view.getByText("Banked resets · 3")).toBeTruthy();
  expect(view.queryByText("Use this first")).toBeNull();
  expect(view.queryByText("Saved for later")).toBeNull();
  expect(view.queryByText("refresh")).toBeNull();
  expect(view.queryByText("Use")).toBeNull();
  const usableReset = view.getByLabelText("Use Earlier reset for account@example.com");
  expect(usableReset.props.accessibilityRole).toBe("button");
  expect(StyleSheet.flatten(usableReset.props.style)).toMatchObject({ minHeight: 48 });
  expect(view.getByTestId("account-reset-details-surface-account")).toHaveStyle({
    paddingHorizontal: 16,
    paddingTop: 12,
  });
  for (const slot of ["secondary", "primary"]) {
    const meter = view.getByTestId(`account-reset-window-meter-${slot}`);
    const descendants = meter
      .findAll((node) => typeof node.props.testID === "string")
      .map((node) => node.props.testID);
    expect(descendants.indexOf(`account-reset-window-progress-${slot}`)).toBeLessThan(
      descendants.indexOf(`account-reset-window-remaining-${slot}`),
    );
  }
  expect(view.getByText(/Expires in 1m/u)).toBeTruthy();
  expect(view.getByText("Does not expire")).toBeTruthy();
  expect(view.getAllByTestId(/account-banked-reset-/u).map((row) => row.props.testID)).toEqual([
    "account-banked-reset-earlier",
    "account-banked-reset-later",
    "account-banked-reset-no-expiry",
  ]);
});

it.each([
  [true, colors.green],
  [false, colors.textDim],
] as const)("shows active=%s beside the account name", (active, color) => {
  jest.useFakeTimers().setSystemTime(NOW);
  const account = profile(Math.floor(NOW / 1_000) + 7 * 24 * 60 * 60);
  account.active = active;
  account.exhaustedUntil = null;
  if (account.rateLimits === null || account.rateLimits.rateLimits.secondary === null) {
    throw new Error("weekly rate-limit fixture is missing");
  }
  account.rateLimits.rateLimits.secondary.usedPercent = 20;
  const { view } = renderRow(account);

  expect(view.getByTestId("account-status-account")).toHaveStyle({
    backgroundColor: color,
    height: 12,
    width: 12,
  });
  expect(view.queryByTestId("account-limit-rings-account-status")).toBeNull();
});

it("prefers the exact metered Pro tier over the coarse account summary", () => {
  jest.useFakeTimers().setSystemTime(NOW);
  const account = profile(Math.floor(NOW / 1_000) + 7 * 24 * 60 * 60);
  if (account.rateLimits === null) {
    throw new Error("rate-limit fixture is missing");
  }
  account.rateLimits.rateLimits.planType = "pro_x_20";

  const { view } = renderRow(account);

  expect(view.getByText(/Pro X20 · Primary/u)).toBeTruthy();
  expect(view.queryByText(/Pro · Primary/u)).toBeNull();
});

it("renders Add Codex account as the final compact list row", () => {
  jest.useFakeTimers().setSystemTime(NOW);
  const account = profile(Math.floor(NOW / 1_000) + 7 * 24 * 60 * 60);
  const accountPool = snapshot(account);
  const view = render(
    <AccountPoolEditor
      accountPool={accountPool}
      connectionId="server"
      onActivate={jest.fn(() => Promise.resolve(accountPool))}
      onCancelLogin={jest.fn(() => Promise.resolve())}
      onConsumeResetCredit={jest.fn(() =>
        Promise.resolve({ accountPool, outcome: "reset" as const }),
      )}
      onRefresh={jest.fn(() => Promise.resolve(accountPool))}
      onRemove={jest.fn(() => Promise.resolve(accountPool))}
      onStartLogin={jest.fn(() =>
        Promise.resolve({
          loginId: "login",
          userCode: "CODE",
          verificationUrl: "https://example.com",
        }),
      )}
      onUpdate={jest.fn(() => Promise.resolve(accountPool))}
    />,
  );

  const buttons = view.getAllByRole("button");
  expect(buttons.at(-1)?.props.testID).toBe("add-codex-account");
  expect(view.getByTestId("add-codex-account")).toHaveStyle({ height: 56 });
  expect(view.getByText("Add Codex account")).toBeTruthy();
});

it("omits the inner ring and five-hour detail when that limit is unavailable", () => {
  jest.useFakeTimers().setSystemTime(NOW);
  const account = profile(Math.floor(NOW / 1_000) + 7 * 24 * 60 * 60);
  if (account.rateLimits === null) {
    throw new Error("rate-limit fixture is missing");
  }
  account.rateLimits.rateLimits.primary = null;
  const { view } = renderRow(account);

  expect(view.getByLabelText("Weekly 0% left. No five-hour limit")).toBeTruthy();
  expect(view.queryByTestId("account-limit-rings-account-five-hour")).toBeNull();
  fireEvent.press(view.getByTestId("account-profile-account"));
  expect(view.queryByText("5-hour window")).toBeNull();
  expect(view.getByText("Weekly window")).toBeTruthy();
});

it("uses the selected banked reset through the account-pool capability", () => {
  jest.useFakeTimers().setSystemTime(NOW);
  const account = profile(Math.floor(NOW / 1_000) + 7 * 24 * 60 * 60);
  const onConsumeResetCredit = jest.fn(() =>
    Promise.resolve({ accountPool: snapshot(account), outcome: "reset" as const }),
  );
  const { run, view } = renderRow(account, onConsumeResetCredit);
  fireEvent.press(view.getByTestId("account-profile-account"));
  const use = view.getByLabelText("Use Earlier reset for account@example.com");

  fireEvent.press(use);

  expect(run).not.toHaveBeenCalled();
  expect(onConsumeResetCredit).not.toHaveBeenCalled();
  expect(getAppDialogRequest()).toMatchObject({
    actions: [{ style: "cancel", text: "Cancel" }, { text: "Use" }],
    message:
      "Apply this reset to account@example.com? It will be consumed immediately and cannot be undone.",
    title: "Use Earlier reset?",
  });

  invokeAppDialogAction("Cancel");
  expect(run).not.toHaveBeenCalled();
  expect(onConsumeResetCredit).not.toHaveBeenCalled();

  fireEvent.press(use);
  invokeAppDialogAction("Use");

  expect(run).toHaveBeenCalledTimes(1);
  expect(onConsumeResetCredit).toHaveBeenCalledWith("server", "account", "earlier");
});

it("does not offer Use for an expired banked reset", () => {
  jest.useFakeTimers().setSystemTime(NOW);
  const account = profile(Math.floor(NOW / 1_000) + 7 * 24 * 60 * 60);
  const credits = account.rateLimits?.rateLimitResetCredits?.credits;
  if (credits === null || credits === undefined || credits[2] === undefined) {
    throw new Error("banked reset fixture is missing");
  }
  credits[2].expiresAt = Math.floor(NOW / 1_000) - 1;
  const { view } = renderRow(account);

  fireEvent.press(view.getByTestId("account-profile-account"));

  expect(view.getByText(/Expired/u)).toBeTruthy();
  expect(view.queryByLabelText("Use Earlier reset for account@example.com")).toBeNull();
  expect(view.getByLabelText("Use Later reset for account@example.com")).toBeTruthy();
});
