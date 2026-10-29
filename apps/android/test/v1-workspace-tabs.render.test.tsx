import { act, fireEvent, waitFor, within } from "expo-router/testing-library";
import { router } from "expo-router/build/imperative-api";

import {
  catalogModeBarBottomInset,
  catalogModeBarHorizontalInset,
} from "../src/presentation/layouts/catalogModeBarGeometry";
import { renderWorkspaceTabs } from "./fixtures/WorkspaceTabsRouter";

let mockDesktop = false;
let mockViewportWidth = 400;

jest.mock("react-native-reanimated/mock", () => {
  const mock = jest.requireActual("./mocks/Reanimated");
  return { __esModule: true, ...mock };
});
jest.mock("expo-symbols", () => ({}));
jest.mock("../src/routeComposition/PullRequestsCatalogRoute", () => ({
  PullRequestsPreviewRoute: () => null,
}));
jest.mock("../src/features/pullRequests/CatalogModeBar", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    CatalogModeBar: ({ onSelect }: { readonly onSelect: (mode: string) => void }) => (
      <MockView>
        <MockView
          accessible
          accessibilityLabel="Threads"
          accessibilityRole="tab"
          onAccessibilityTap={() => onSelect("threads")}
        />
        <MockView
          accessible
          accessibilityLabel="Pull requests"
          accessibilityRole="tab"
          onAccessibilityTap={() => onSelect("pullRequests")}
        />
      </MockView>
    ),
  };
});
jest.mock("react-native-screens", () => ({
  ...jest.requireActual("react-native-screens"),
  screensEnabled: () => true,
}));
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    desktop: mockDesktop,
    runtime: { ready: false },
    viewportWidth: mockViewportWidth,
  }),
}));

beforeEach(() => {
  mockDesktop = false;
  mockViewportWidth = 400;
});

it("keeps both native-screen tab descriptors mounted without collapsing retained layout", () => {
  const view = renderWorkspaceTabs();
  const threads = view.getByTestId("workspace-tab-scene-(threads)");
  const pulls = view.getByTestId("workspace-tab-scene-(pull-requests)", {
    includeHiddenElements: true,
  });

  expect(threads.props).toMatchObject({
    accessibilityElementsHidden: false,
    "aria-hidden": false,
    importantForAccessibility: "auto",
    pointerEvents: "auto",
  });
  expect(threads).toHaveStyle({ flex: 1 });
  expect(threads).not.toHaveStyle({ display: "none" });
  expect(pulls.props).toMatchObject({
    accessibilityElementsHidden: true,
    "aria-hidden": true,
    importantForAccessibility: "no-hide-descendants",
    pointerEvents: "none",
  });
  expect(pulls).toHaveStyle({ flex: 1 });
  expect(pulls).not.toHaveStyle({ display: "none" });
  expect(
    view.getByTestId("workspace-tabs-pull-requests", { includeHiddenElements: true }),
  ).toBeTruthy();

  fireEvent(view.getByRole("tab", { name: "Pull requests" }), "accessibilityTap");
  expect(
    view.getByTestId("workspace-tab-scene-(threads)", { includeHiddenElements: true }),
  ).not.toHaveStyle({ display: "none" });
  expect(view.getByTestId("workspace-tab-scene-(pull-requests)")).toHaveStyle({ flex: 1 });
});

it("keeps the active native-screen tab visible beneath a transparent root route", () => {
  const view = renderWorkspaceTabs();

  fireEvent.press(view.getByTestId("open-transparent-settings"));

  const threads = view.getByTestId("workspace-tab-scene-(threads)", {
    includeHiddenElements: true,
  });
  expect(view.getByTestId("transparent-settings")).toBeVisible();
  expect(threads.props).toMatchObject({
    accessibilityElementsHidden: false,
    "aria-hidden": false,
    importantForAccessibility: "auto",
    pointerEvents: "auto",
  });
  expect(threads).toHaveStyle({ flex: 1 });
  expect(threads).not.toHaveStyle({ display: "none" });
});

it.each([
  [false, 400],
  [true, 1200],
] as const)("keeps one active bar inside the catalog master bounds", (desktop, width) => {
  mockDesktop = desktop;
  mockViewportWidth = width;
  const view = renderWorkspaceTabs();
  const bar = view.getByTestId("floating-catalog-mode-bar");

  expect(view.getAllByTestId("floating-catalog-mode-bar")).toHaveLength(1);
  expect(
    within(view.getByTestId("workspace-catalog-master-threads")).getByTestId(
      "floating-catalog-mode-bar",
    ),
  ).toBe(bar);
  expect(bar).toHaveStyle({
    bottom: catalogModeBarBottomInset,
    left: catalogModeBarHorizontalInset,
    position: "absolute",
    right: catalogModeBarHorizontalInset,
    zIndex: 20,
  });
});

it("reselects through standard tabPress and pops the active Threads stack", async () => {
  mockDesktop = true;
  mockViewportWidth = 1200;
  const view = renderWorkspaceTabs();
  const threadsTab = view.getByRole("tab", { name: "Threads" });
  act(() => router.push("/threads/server/thread"));
  await waitFor(() => {
    expect(view.getByTestId("workspace-tabs-thread-detail")).toBeVisible();
  });

  fireEvent(threadsTab, "accessibilityTap");

  await waitFor(() => {
    expect(view.getPathname()).toBe("/");
    expect(view.getByTestId("workspace-tabs-threads")).toBeVisible();
  });
});
