import { fireEvent, render } from "@testing-library/react-native";
import { HeroUINativeProviderRaw } from "heroui-native/provider-raw";
import { PortalHost } from "heroui-native/portal";
import { Pressable, StyleSheet, Text } from "react-native";

import type { AccountPoolProfile } from "../src/data/account-pool";
import type { AccountUsageSource } from "../src/data/account-usage-presentation";
import { UsagePopover } from "../src/features/accounts/UsagePopover";
import { AppPopover } from "../src/ui/AppPopover";

function profile(id: string): AccountPoolProfile {
  return { id, email: null, planType: null, priority: 0, enabled: true, active: false,
    exhaustedUntil: null, exhaustedIndefinitely: false, rateLimits: null,
    rateLimitsUpdatedAt: null, rateLimitsError: null, lastUsedAt: null };
}

function setup(withAccounts: boolean) {
  const onProjects = jest.fn();
  const sources: readonly AccountUsageSource[] = [{ id: "server", name: "Buddy", rateLimits: {
    id: "limits", connectionId: "server", status: "ready", snapshot: null, error: null, updatedAt: 0,
    accountPool: { activeProfileId: null, profiles: [profile("first"), profile("second")], nextResetAt: null, allExhausted: false },
  } }];
  const view = render(<HeroUINativeProviderRaw config={{ animation: "disable-all", devInfo: { stylingPrinciples: false } }}>
    <UsagePopover {...(withAccounts ? { accountSources: sources } : {})} actions={[
      { id: "projects", label: "Manage Projects", icon: "folder-outline", onPress: onProjects },
      { id: "settings", label: "Settings", icon: "settings-outline", onPress: jest.fn() },
    ]}>
      <Pressable accessibilityLabel="Thread list menu"><Text>Menu</Text></Pressable>
    </UsagePopover><PortalHost />
  </HeroUINativeProviderRaw>);
  // The shell's native trigger is tested separately; exercise its open-state contract here.
  fireEvent(view.UNSAFE_getByType(AppPopover), "openChange", true);
  // Native popup placement is unavailable in Jest; render the actual supplied menu body.
  const body = render(view.UNSAFE_getByType(AppPopover).props.children);
  return { view: body, shell: view, onProjects };
}

it("keeps only the account-to-actions divider and removes action arrows", () => {
  const test = setup(true);
  expect(test.view.queryByText("chevron-forward")).toBeNull();
  for (const id of ["first", "second"]) {
    expect(StyleSheet.flatten(test.view.getByTestId(`usage-account-${id}`).props.style).borderTopWidth ?? 0).toBe(0);
  }
  expect(test.view.getByLabelText("Manage Projects")).toHaveStyle({ borderTopWidth: StyleSheet.hairlineWidth });
  expect(StyleSheet.flatten(test.view.getByLabelText("Settings").props.style).borderTopWidth ?? 0).toBe(0);
  fireEvent.press(test.view.getByLabelText("Manage Projects"));
  expect(test.onProjects).toHaveBeenCalledTimes(1);
  expect(test.shell.UNSAFE_getByType(AppPopover).props.open).toBe(false);
});

it("does not add a leading divider when there is no account or usage section", () => {
  const test = setup(false);
  expect(StyleSheet.flatten(test.view.getByLabelText("Manage Projects").props.style).borderTopWidth ?? 0).toBe(0);
});
