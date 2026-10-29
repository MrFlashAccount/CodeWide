import { useEffect, type ReactElement } from "react";
import type { LayoutChangeEvent } from "react-native";

import { workspaceCatalogDiagnostics } from "../data/workspaceCatalogDiagnostics";
import { useConstant } from "../react/useConstant";
import { useEvent } from "../react/useEvent";
import { useAndroidBackHandler } from "../ui/use-android-back-handler";
import { PaneMotionProvider } from "./PaneMotionProvider";
import { usePaneMotionState, usePaneRearrangement } from "./paneMotion";
import {
  createWorkspacePaneOwner,
  resolvePaneArrangement,
  resolveWorkspacePaneVisibility,
  useWorkspacePaneOwnerState,
  WorkspacePaneContext,
  WorkspacePanesContext,
  type WorkspacePaneCapabilities,
  type WorkspacePaneOwner,
  type WorkspacePaneVisibility,
} from "./workspacePanes";
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
  readonly presentation: WorkspaceTwoPanePresentation;
  readonly viewportWidth: number;
};

const NO_CAPABILITIES: WorkspacePaneCapabilities = {};

/**
 * One workspace frame of the three-pane model: it owns the pane rearrangement window, the
 * fullscreen request, the resolved pane visibility and Back-exits-fullscreen. It places the left
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
  const { owner, rightPresent, visibility } = useWorkspacePaneModel(desktop, presentation);
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
  const placed = placedPresentation(presentation, visibility);
  const geometry = usePaneMotionState(
    resolvePaneArrangement({ presentation: placed, rightPresent, visibility }),
    viewportWidth,
  );
  const catalogAccessible = isCatalogAccessible(placed, desktop, catalogFocused);
  const centerHidden = placed.kind === "wideCatalogExpanded";
  return (
    <WorkspacePanesContext.Provider value={{ geometry, owner, visibility }}>
      <WorkspaceTwoPaneLayout
        catalog={
          <WorkspacePaneContext.Provider
            value={{ capabilities: leftCapabilities ?? NO_CAPABILITIES, pane: "left" }}
          >
            {catalog}
          </WorkspacePaneContext.Provider>
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
          <WorkspacePaneContext.Provider value={{ capabilities: NO_CAPABILITIES, pane: "center" }}>
            {detail}
          </WorkspacePaneContext.Provider>
        }
        detailStyle={desktop ? v1WorkspaceShellStyles.destination : undefined}
        detailViewProps={destinationViewProps(desktop, catalogFocused, centerHidden)}
        frameStyle={v1WorkspaceShellStyles.paneFrame}
        geometry={geometry}
        presentation={placed}
        testID="v1-workspace-pane-frame"
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
  presentation: WorkspaceTwoPanePresentation,
): {
  readonly owner: WorkspacePaneOwner;
  readonly rightPresent: boolean;
  readonly visibility: WorkspacePaneVisibility;
} {
  const owner = useConstant(createWorkspacePaneOwner);
  const ownerState = useWorkspacePaneOwnerState(owner);
  const rearrange = usePaneRearrangement();
  const wide = presentation.kind === "wide" || presentation.kind === "wideDetailExpanded";
  const visibility = resolveWorkspacePaneVisibility({
    fullscreen: ownerState.fullscreen,
    leftPresent: presentation.kind === "wide",
    multiPane: desktop && wide,
    rightPresent: ownerState.rightPresent,
  });
  const exitFullscreen = useEvent((): void => {
    rearrange(() => {
      owner.fullscreen$.set(null);
    });
  });
  useAndroidBackHandler(visibility.kind === "fullscreen", exitFullscreen);
  return { owner, rightPresent: ownerState.rightPresent, visibility };
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

/** A fullscreen pane collapses the frame's other side while keeping it mounted. */
function placedPresentation(
  presentation: WorkspaceTwoPanePresentation,
  visibility: WorkspacePaneVisibility,
): WorkspaceTwoPanePresentation {
  if (
    visibility.kind !== "fullscreen" ||
    (presentation.kind !== "wide" && presentation.kind !== "wideDetailExpanded")
  ) {
    return presentation;
  }
  return visibility.pane === "left"
    ? { kind: "wideCatalogExpanded", viewportWidth: presentation.viewportWidth }
    : { kind: "wideDetailExpanded", viewportWidth: presentation.viewportWidth };
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
