import { expect, it, vi } from "vitest";

import { v1MobileRouteMotion } from "../src/ui/v1MobileRouteMotion";

import {
  v1MobileRouteScreenOptions,
  v1ProjectListScreenOptions,
} from "../src/routeComposition/WorkspaceShell.styles";

vi.mock("react-native", () => ({
  StyleSheet: { create: <T extends Record<string, unknown>>(styles: T): T => styles },
}));

it("uses a symmetric 250 ms Android crossfade with short horizontal travel", () => {
  expect(v1MobileRouteScreenOptions.animation).toBe("fade_from_bottom");
  expect(v1MobileRouteMotion.durationMs).toBe(250);
  expect(v1MobileRouteScreenOptions.animationDuration).toBe(v1MobileRouteMotion.durationMs);
});

it("uses the app fade and short slide for the shared project stack", () => {
  expect(v1ProjectListScreenOptions.animation).toBe(v1MobileRouteScreenOptions.animation);
  expect(v1ProjectListScreenOptions.animationDuration).toBe(v1MobileRouteMotion.durationMs);
  expect(v1ProjectListScreenOptions.headerShown).toBe(false);
});
