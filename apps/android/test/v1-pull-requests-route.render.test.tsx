import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";
import {
  PullRequestsCatalogPane,
  PullRequestsCatalogRoute,
} from "../src/routeComposition/PullRequestsCatalogRoute";

let mockDesktop = true;

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
    switchCatalog: jest.fn(),
  }),
}));
jest.mock("../src/services/workspace/workspaceRouteResources", () => ({
  useWorkspaceRouteResources: () => ({
    desktop: mockDesktop,
    list: { serverScope: null, servers: [] },
  }),
}));

it("projects the Pull requests catalog without owning workspace split geometry", () => {
  mockDesktop = true;
  const view = render(<PullRequestsCatalogPane />);

  expect(view.getByTestId("pull-requests-catalog-pane")).toBeVisible();
  expect(view.getByTestId("pull-requests-header")).toBeVisible();
  expect(view.getByTestId("pull-requests-catalog-content")).toBeVisible();
  expect(view.queryByTestId("pull-requests-preview-pane")).toBeNull();
  expect(
    StyleSheet.flatten(view.getByTestId("pull-requests-catalog-pane").props.style),
  ).not.toHaveProperty("borderRightWidth");
});

it("leaves only the decorative preview in the desktop destination pane", () => {
  mockDesktop = true;
  const view = render(<PullRequestsCatalogRoute />);

  expect(view.getByTestId("pull-requests-preview-pane")).toBeVisible();
  expect(view.getByTestId("review-inbox-illustration")).toBeVisible();
  expect(view.queryByTestId("pull-requests-catalog-pane")).toBeNull();
});

it("omits the decorative preview on compact viewports", () => {
  mockDesktop = false;
  const view = render(<PullRequestsCatalogRoute />);

  expect(view.queryByTestId("pull-requests-preview-pane")).toBeNull();
});
