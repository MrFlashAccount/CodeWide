import { fireEvent } from "expo-router/testing-library";

import { renderWorkspaceTabs } from "./fixtures/WorkspaceTabsRouter";

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
  screensEnabled: () => false,
}));
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    desktop: false,
    runtime: { ready: false },
    viewportWidth: 400,
  }),
}));

it("keeps both plain-View fallback scenes mounted but pointer and accessibility inert", () => {
  const view = renderWorkspaceTabs("/pulls");
  const threads = view.getByTestId("workspace-tab-scene-(threads)", {
    includeHiddenElements: true,
  });
  const pulls = view.getByTestId("workspace-tab-scene-(pull-requests)");

  expect(threads.props).toMatchObject({
    accessibilityElementsHidden: true,
    "aria-hidden": true,
    importantForAccessibility: "no-hide-descendants",
    pointerEvents: "none",
  });
  expect(threads).toHaveStyle({ display: "none" });
  expect(view.getByTestId("workspace-tabs-threads", { includeHiddenElements: true })).toBeTruthy();
  expect(pulls.props).toMatchObject({
    accessibilityElementsHidden: false,
    "aria-hidden": false,
    importantForAccessibility: "auto",
    pointerEvents: "auto",
  });

  fireEvent(view.getByRole("tab", { name: "Threads" }), "accessibilityTap");
  expect(view.getByTestId("workspace-tab-scene-(threads)")).toHaveStyle({ flex: 1 });
  expect(view.getByTestId("workspace-tab-scene-(threads)")).not.toHaveStyle({ display: "none" });
  expect(
    view.getByTestId("workspace-tab-scene-(pull-requests)", { includeHiddenElements: true }),
  ).toHaveStyle({ display: "none" });
});

it("keeps the active plain-View scene visible beneath a transparent root route", () => {
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
