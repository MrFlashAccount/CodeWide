import { fireEvent, render } from "@testing-library/react-native";
import type { GetAccountRateLimitsResponse } from "@codewide/codex-protocol/v0.155.1/v2";
import { Pressable, StyleSheet, Text } from "react-native";

import type { AccountPoolProfile } from "../src/data/account-pool";
import type { AccountUsageSource } from "../src/data/account-usage-presentation";
import { UsageMenu } from "../src/features/accounts/UsageMenu";
import { ContentMenu } from "../src/ui/ContentMenu";

const LIMITS: GetAccountRateLimitsResponse = {
  accountId: null,
  ordinaryUsageAllowed: null,
  rateLimitResetCredits: { availableCount: 0, credits: [] },
  rateLimitUpsell: null,
  rateLimits: {
    credits: null,
    individualLimit: null,
    limitId: "codex",
    limitName: "Codex",
    normalModelSlug: null,
    planType: null,
    primary: { resetsAt: 4_000_000_000, usedPercent: 10, windowDurationMins: 300 },
    rateLimitReachedType: null,
    secondary: { resetsAt: 4_000_000_000, usedPercent: 20, windowDurationMins: 10_080 },
    spendControlReached: null,
  },
  rateLimitsByLimitId: null,
};

function profile(id: string): AccountPoolProfile {
  return {
    id,
    email: null,
    planType: null,
    priority: 0,
    enabled: true,
    active: false,
    exhaustedUntil: null,
    exhaustedIndefinitely: false,
    rateLimits: LIMITS,
    rateLimitsUpdatedAt: Math.floor(Date.now() / 1000),
    rateLimitsError: null,
    lastUsedAt: null,
  };
}

function setup(withAccounts: boolean) {
  const onProjects = jest.fn();
  const onRefresh = jest.fn(async () => undefined);
  const sources: readonly AccountUsageSource[] = [
    {
      id: "server",
      name: "Buddy",
      rateLimits: {
        id: "limits",
        connectionId: "server",
        status: "ready",
        snapshot: LIMITS,
        error: null,
        updatedAt: Date.now(),
        accountPool: {
          activeProfileId: null,
          profiles: [profile("first"), profile("second")],
          nextResetAt: null,
          allExhausted: false,
        },
      },
    },
  ];
  const view = render(
    <>
      <UsageMenu
        {...(withAccounts ? { accountSources: sources, onRefresh } : {})}
        actions={[
          { id: "projects", label: "Manage Projects", icon: "folder-outline", onPress: onProjects },
          { id: "settings", label: "Settings", icon: "settings-outline", onPress: jest.fn() },
        ]}
      >
        <Pressable accessibilityLabel="Thread list menu">
          <Text>Menu</Text>
        </Pressable>
      </UsageMenu>
    </>,
  );
  // The shell's native trigger is tested separately; exercise its open-state contract here.
  fireEvent(view.UNSAFE_getByType(ContentMenu), "openChange", true);
  // Native popup placement is unavailable in Jest; render the actual supplied menu body.
  const body = render(view.UNSAFE_getByType(ContentMenu).props.children);
  return { view: body, shell: view, onProjects, onRefresh };
}

it("refreshes even fresh account data when the menu opens", () => {
  const test = setup(true);
  expect(test.onRefresh).toHaveBeenCalledTimes(1);
});

it("keeps only the account-to-actions divider and removes action arrows", () => {
  const test = setup(true);
  expect(test.view.queryByText("chevron-forward")).toBeNull();
  for (const id of ["first", "second"]) {
    expect(
      StyleSheet.flatten(test.view.getByTestId(`usage-account-${id}`).props.style).borderTopWidth ??
        0,
    ).toBe(0);
  }
  expect(test.view.getByLabelText("Manage Projects")).toHaveStyle({
    borderTopWidth: StyleSheet.hairlineWidth,
  });
  expect(
    StyleSheet.flatten(test.view.getByLabelText("Settings").props.style).borderTopWidth ?? 0,
  ).toBe(0);
  fireEvent.press(test.view.getByLabelText("Manage Projects"));
  expect(test.onProjects).toHaveBeenCalledTimes(1);
  expect(test.shell.UNSAFE_getByType(ContentMenu).props.open).toBe(false);
});

it("does not add a leading divider when there is no account or usage section", () => {
  const test = setup(false);
  expect(
    StyleSheet.flatten(test.view.getByLabelText("Manage Projects").props.style).borderTopWidth ?? 0,
  ).toBe(0);
});
