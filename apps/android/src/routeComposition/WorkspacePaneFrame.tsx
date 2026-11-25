import { FULL_PERCENT, HALF_PERCENT, MIN_PANE_PERCENT, type PanePair } from "../ui/paneSplitSizes";
import { useSelector } from "@legendapp/state/react";
import { paneSplitPreferences$ } from "../data/paneSplitPreferences";
import { sidebarWidth } from "../ui/sidebarDimensions";
import { PaneDivider } from "./PaneDivider";
import { useContext, useEffect, type ReactElement } from "react";
import type { LayoutChangeEvent, View } from "react-native";
import { useAnimatedRef } from "react-native-reanimated";

import { WorkspaceTabLayerContext } from "./workspaceTabSceneNavigation";
import { workspaceCatalogDiagnostics } from "../data/workspaceCatalogDiagnostics";
import { useConstant } from "../react/useConstant";
import { useEvent } from "../react/useEvent";
import { useAndroidBackHandler } from "../ui/use-android-back-handler";
import { PaneMotionProvider } from "./PaneMotionProvider";
import { usePaneMotionState, usePaneRearrangement } from "./paneMotion";
import { paneGeometry } from "./paneGeometry";
import {
  createWorkspacePaneOwner,
  placeFramePresentation,
  resolvePaneArrangement,
  resolveWorkspacePaneVisibility,
  useWorkspacePaneOwnerState,
  WorkspacePanesContext,
  type WorkspaceFramePresentation,
  type WorkspacePaneCapabilities,
  type WorkspacePaneOwner,
  type WorkspacePaneVisibility,
} from "./workspacePanes";
import { ThreePanelsPane } from "./ThreePanelsPane";
import { usePaneMotionFrameProbe } from "./usePaneMotionFrameProbe";
import { v1WorkspaceShellStyles } from "./WorkspaceShell.styles";
import {
  WorkspaceTwoPaneLayout,
  type WorkspaceTwoPanePresentation,
} from "./WorkspaceTwoPaneLayout";

type WorkspacePaneFrameProps = {
  readonly catalog: ReactElement | null;
  readonly catalogFocused: boolean;
  readonly catalogStatus: "missing-descriptor" | "missing-route" | "present";
  readonly desktop: boolean;
  readonly detail: ReactElement;
  /** Actions the left (catalog) pane supports; none by default. */
  readonly leftCapabilities?: WorkspacePaneCapabilities;
  readonly presentation: WorkspaceFramePresentation;
  /** Window width for diagnostics and verifying a display handoff; Yoga sizes the panes. */
  readonly viewportWidth: number;
};

const NO_CAPABILITIES: WorkspacePaneCapabilities = {};

/**
 * One workspace frame of the three-pane model: it owns the pane rearrangement window, the
 * fullscreen request, the resolved pane visibility (a right pane covers the left one) and
 * Back-exits-fullscreen. It places the left
 * pane and the center destination; a destination that opens a right pane places it through
 * `WorkspaceCenterLayout`, which feeds the same owner.
 */
export function WorkspacePaneFrame(props: WorkspacePaneFrameProps): React.JSX.Element {
  return (
    <PaneMotionProvider>
      <WorkspacePaneFrameContent {...props} />
    </PaneMotionProvider>
  );
}

function WorkspacePaneFrameContent({
  catalog,
  catalogFocused,
  catalogStatus,
  desktop,
  detail,
  leftCapabilities,
  presentation,
  viewportWidth,
}: WorkspacePaneFrameProps): React.JSX.Element {
  const { owner, rightPresent, split, visibility } = useWorkspacePaneModel(desktop, presentation);
  const onCatalogLayout = useEvent((event: LayoutChangeEvent): void => {
    const { height, width } = event.nativeEvent.layout;
    workspaceCatalogDiagnostics.record({ height, surface: "pane", type: "layout", width });
  });
  useEffect(() => {
    workspaceCatalogDiagnostics.record({
      catalog: catalogStatus,
      desktop,
      focused: catalogFocused,
      type: "navigation",
      viewportWidth,
    });
  }, [catalogFocused, catalogStatus, desktop, viewportWidth]);
  const placed = placeFramePresentation(presentation, visibility);
  const tabSwitchLayer = useContext(WorkspaceTabLayerContext);
  const frameRef = useAnimatedRef<View>();
  const { catalogPercent, centerPercent } = usePaneShares(viewportWidth);
  const arrangement = {
    ...resolvePaneArrangement({ presentation: placed, rightPresent, visibility }),
    catalogPercent,
    centerPercent,
  };
  const geometry = usePaneMotionState(arrangement, frameRef);
  const target = paneGeometry(arrangement, viewportWidth);
  usePaneMotionFrameProbe(geometry.moving);
  const catalogAccessible = isCatalogAccessible(placed, desktop, catalogFocused);
  const centerHidden = placed.kind === "wideCatalogExpanded";
  const renderFrame = (divider: ReactElement | null) => (
    <WorkspaceTwoPaneLayout
      cacheDetailDuring={tabSwitchLayer}
      catalog={
        <ThreePanelsPane
          box="catalog"
          capabilities={leftCapabilities ?? NO_CAPABILITIES}
          label="catalog"
          neighbour={null}
          pane="left"
        >
          {catalog}
        </ThreePanelsPane>
      }
      catalogViewProps={{
        accessibilityElementsHidden: !catalogAccessible,
        "aria-hidden": !catalogAccessible,
        importantForAccessibility: catalogAccessible ? "auto" : "no-hide-descendants",
        onLayout: onCatalogLayout,
        pointerEvents: catalogAccessible ? "auto" : "none",
        testID: "workspace-catalog-pane",
      }}
      detail={
        // A destination that declares its own panes publishes them through WorkspaceCenterLayout.
        <ThreePanelsPane
          box="destination"
          capabilities={NO_CAPABILITIES}
          label="destination"
          neighbour={null}
          pane="center"
        >
          {detail}
        </ThreePanelsPane>
      }
      detailStyle={desktop ? v1WorkspaceShellStyles.destination : undefined}
      detailViewProps={destinationViewProps(desktop, catalogFocused, centerHidden)}
      divider={divider}
      frameRef={frameRef}
      frameStyle={v1WorkspaceShellStyles.paneFrame}
      geometry={geometry}
      insetDetail={visibility.kind === "split"}
      presentation={placed}
      resizeTarget={{
        catalog: placed.kind === "detailOnly" ? 0 : target.catalogWidth,
        destination: placed.kind === "catalogOnly" ? 0 : target.detailWidth,
        left: target.detailX,
        window: viewportWidth,
      }}
      testID="v1-workspace-pane-frame"
    />
  );
  return (
    <WorkspacePanesContext.Provider value={{ geometry, owner, visibility }}>
      <FrameDivider
        catalogPercent={catalogPercent}
        centerPercent={centerPercent}
        geometry={geometry}
        owner={owner}
        pair={split}
        renderFrame={renderFrame}
        rightPresent={rightPresent}
        visibility={visibility}
        width={viewportWidth}
      />
    </WorkspacePanesContext.Provider>
  );
}

/**
 * The frame's three-pane owner and its resolved visibility. Back leaves fullscreen before anything
 * below the frame handles it.
 */
function useWorkspacePaneModel(
  desktop: boolean,
  presentation: WorkspaceFramePresentation,
): {
  readonly owner: WorkspacePaneOwner;
  readonly rightPresent: boolean;
  readonly split: PanePair;
  readonly visibility: WorkspacePaneVisibility;
} {
  const owner = useConstant(createWorkspacePaneOwner);
  const ownerState = useWorkspacePaneOwnerState(owner);
  const rearrange = usePaneRearrangement();
  const visibility = resolveWorkspacePaneVisibility({
    fullscreen: ownerState.fullscreen,
    multiPane: desktop && presentation.kind === "wide",
    rightSplit: ownerState.rightSplit,
  });
  const exitFullscreen = useEvent((): void => {
    rearrange(() => {
      owner.fullscreen$.set(null);
    });
  });
  useAndroidBackHandler(visibility.kind === "fullscreen", exitFullscreen);
  return {
    owner,
    rightPresent: ownerState.rightSplit !== null,
    split: ownerState.rightSplit ?? "left+center",
    visibility,
  };
}

function destinationViewProps(desktop: boolean, catalogFocused: boolean, centerHidden: boolean) {
  return {
    accessibilityElementsHidden: centerHidden,
    collapsable: false,
    importantForAccessibility: centerHidden ? ("no-hide-descendants" as const) : ("auto" as const),
    pointerEvents: isDetailInteractive(desktop, catalogFocused, centerHidden)
      ? ("auto" as const)
      : ("none" as const),
    testID: "v1-workspace-destination",
  };
}

function isCatalogAccessible(
  presentation: WorkspaceTwoPanePresentation,
  desktop: boolean,
  catalogFocused: boolean,
): boolean {
  if (presentation.kind === "detailOnly" || presentation.kind === "wideDetailExpanded") {
    return false;
  }
  return desktop || catalogFocused;
}

function isDetailInteractive(
  desktop: boolean,
  catalogFocused: boolean,
  centerHidden: boolean,
): boolean {
  return !centerHidden && (desktop || !catalogFocused);
}

function usePaneShares(viewportWidth: number) {
  const preferredCatalog = useSelector(() => paneSplitPreferences$["left+center"].get());
  const preferredCenter = useSelector(() => paneSplitPreferences$["center+right"].get());
  const catalogPercent =
    preferredCatalog ??
    Math.min(
      HALF_PERCENT,
      Math.max(
        MIN_PANE_PERCENT,
        (sidebarWidth(viewportWidth) / Math.max(1, viewportWidth)) * FULL_PERCENT,
      ),
    );
  const centerPercent = preferredCenter ?? HALF_PERCENT;
  return { catalogPercent, centerPercent };
}

function FrameDivider({
  catalogPercent,
  centerPercent,
  geometry,
  owner,
  pair,
  renderFrame,
  rightPresent,
  visibility,
  width,
}: {
  readonly catalogPercent: number;
  readonly centerPercent: number;
  readonly geometry: ReturnType<typeof usePaneMotionState>;
  readonly owner: WorkspacePaneOwner;
  readonly pair: PanePair;
  readonly renderFrame: (divider: ReactElement | null) => ReactElement;
  readonly rightPresent: boolean;
  readonly visibility: WorkspacePaneVisibility;
  readonly width: number;
}): React.JSX.Element | null {
  return (
    <PaneDivider
      bothEdges={rightPresent && visibility.kind === "fullscreen" && visibility.pane === "center"}
      enabled={visibility.kind !== "stacked"}
      fullscreen={visibility.kind === "fullscreen" ? visibility.pane : null}
      geometry={geometry}
      owner={owner}
      pair={pair}
      renderFrame={renderFrame}
      shares={{ "center+right": centerPercent, "left+center": catalogPercent }}
      width={width}
    />
  );
}
