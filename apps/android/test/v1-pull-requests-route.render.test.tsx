import { render } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import { desktopThreadSidebarWidth } from "../src/presentation/layouts/windowLayout";
import { PullRequestsCatalogRoute } from "../src/routeComposition/PullRequestsCatalogRoute";

let mockDesktop = true;
const mockViewportWidth = 1_000;

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock("../src/data/forgeRuntime", () => ({ forgeResources: {} }));
jest.mock("../src/features/pullRequests/PullRequestsFeature", () => {
  const { Text: NativeText } = jest.requireActual("react-native");
  return {
    PullRequestsCatalog: () => (
      <NativeText testID="pull-requests-catalog-content">Catalog</NativeText>
    ),
  };
});
jest.mock("../src/features/pullRequests/PullRequestsHeader", () => {
  const { Text: NativeText } = jest.requireActual("react-native");
  return {
    PullRequestsHeader: () => <NativeText testID="pull-requests-header">Pull requests</NativeText>,
  };
});
jest.mock("../src/features/pullRequests/onboarding/ReviewInboxIllustration", () => {
  const { Text: NativeText } = jest.requireActual("react-native");
  return {
    ReviewInboxIllustration: () => (
      <NativeText testID="review-inbox-illustration">Preview</NativeText>
    ),
  };
});
jest.mock("../src/features/workspace/createWorkspaceFeatures", () => ({
  workspaceFeatures: { pullRequests: {} },
}));
jest.mock("../src/routeComposition/pullRequestCatalogConnection", () => ({
  pullRequestCatalogConnection: () => "server",
}));
jest.mock("../src/routeComposition/pullRequestNavigation", () => ({
  usePullRequestNavigation: () => ({
    openPullRequest: jest.fn(),
    openingKey: null,
    switchCatalog: jest.fn(),
  }),
}));
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    desktop: mockDesktop,
    list: { serverScope: null, servers: [] },
    viewportWidth: mockViewportWidth,
  }),
}));

it("keeps the Pull requests catalog in the sidebar and previews review UI beside it", () => {
  mockDesktop = true;
  const view = render(<PullRequestsCatalogRoute />);

  expect(StyleSheet.flatten(view.getByTestId("pull-requests-catalog-pane").props.style).width).toBe(
    desktopThreadSidebarWidth(mockViewportWidth),
  );
  expect(view.getByTestId("pull-requests-preview-pane")).toBeVisible();
  expect(view.getByTestId("review-inbox-illustration")).toBeVisible();
});

it("keeps compact Pull requests single-pane and omits the decorative preview", () => {
  mockDesktop = false;
  const view = render(<PullRequestsCatalogRoute />);

  expect(view.getByTestId("pull-requests-catalog-pane")).toHaveStyle({ flex: 1 });
  expect(view.queryByTestId("pull-requests-preview-pane")).toBeNull();
});
