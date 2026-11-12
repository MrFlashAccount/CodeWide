import { render, within } from "@testing-library/react-native";
import { StyleSheet, Text } from "react-native";

import { WorkspaceCatalogMaster } from "../src/routeComposition/WorkspaceCatalogMaster";
import { WorkspacePaneFrame } from "../src/routeComposition/WorkspacePaneFrame";
import type { WorkspaceTwoPanePresentation } from "../src/routeComposition/WorkspaceTwoPaneLayout";
import { colors } from "../src/theme";
import { RESTING_SIDEBAR } from "./fixtures/paneRestLayout";

jest.mock("react-native-reanimated/mock", () => {
  const mock = jest.requireActual("./mocks/Reanimated");
  return { __esModule: true, ...mock };
});
jest.mock("../src/routeComposition/CatalogModeBarHost", () => {
  const { Text: NativeText } = jest.requireActual("react-native");
  return {
    CatalogModeBarHost: () => <NativeText testID="master-catalog-mode-bar">Bar</NativeText>,
  };
});

function frame(
  presentation: WorkspaceTwoPanePresentation,
  { catalogFocused, desktop }: { readonly catalogFocused: boolean; readonly desktop: boolean },
): React.JSX.Element {
  return (
    <WorkspacePaneFrame
      catalog={
        <WorkspaceCatalogMaster mode="pullRequests">
          <Text testID="master-catalog">Catalog</Text>
        </WorkspaceCatalogMaster>
      }
      catalogFocused={catalogFocused}
      catalogStatus="present"
      desktop={desktop}
      detail={<Text testID="master-detail">Detail</Text>}
      presentation={presentation}
      viewportWidth={presentation.kind.startsWith("wide") ? 1200 : 400}
    />
  );
}

it("retains the whole compact master beneath an inaccessible detail", () => {
  const view = render(frame({ kind: "catalogOnly" }, { catalogFocused: true, desktop: false }));
  const master = view.getByTestId("workspace-catalog-master-pullRequests");
  expect(within(master).getByTestId("master-catalog-mode-bar")).toBeVisible();

  view.rerender(frame({ kind: "detailOnly" }, { catalogFocused: false, desktop: false }));

  const catalogPane = view.getByTestId("workspace-catalog-pane", {
    includeHiddenElements: true,
  });
  expect(view.queryByTestId("master-catalog-mode-bar")).toBeNull();
  expect(
    view.getByTestId("workspace-catalog-master-pullRequests", { includeHiddenElements: true }),
  ).toBe(master);
  expect(catalogPane).not.toBeVisible();
  expect(catalogPane.props).toMatchObject({
    accessibilityElementsHidden: true,
    "aria-hidden": true,
    importantForAccessibility: "no-hide-descendants",
    pointerEvents: "none",
  });
  expect(view.getByTestId("master-detail")).toBeVisible();
});

it("bounds the bar to the wide master and restores that master after expansion", () => {
  const wide = { kind: "wide" } as const;
  const view = render(frame(wide, { catalogFocused: false, desktop: true }));
  const master = view.getByTestId("workspace-catalog-master-pullRequests");
  const detail = view.getByTestId("master-detail");
  expect(within(master).getByTestId("master-catalog-mode-bar")).toBeVisible();
  expect(view.getByTestId("workspace-catalog-pane")).toHaveStyle(RESTING_SIDEBAR);

  view.rerender(frame({ kind: "wideDetailExpanded" }, { catalogFocused: false, desktop: true }));
  expect(view.queryByTestId("master-catalog-mode-bar")).toBeNull();
  // The detail slides over the catalog, which keeps its width and dims beneath it.
  expect(view.getByTestId("workspace-catalog-pane", { includeHiddenElements: true })).toHaveStyle({
    opacity: 0,
    ...RESTING_SIDEBAR,
  });

  view.rerender(frame(wide, { catalogFocused: false, desktop: true }));
  expect(view.getByTestId("workspace-catalog-master-pullRequests")).toBe(master);
  expect(view.getByTestId("master-detail")).toBe(detail);
});

it("paints the shared catalog surface beneath the rounded detail boundary", () => {
  const view = render(frame({ kind: "wide" }, { catalogFocused: false, desktop: true }));

  expect(StyleSheet.flatten(view.getByTestId("v1-workspace-pane-frame").props.style)).toEqual(
    expect.objectContaining({ backgroundColor: colors.threadListSurface }),
  );
});
