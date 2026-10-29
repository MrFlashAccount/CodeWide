import { useContext, useLayoutEffect, useState, type ReactElement } from "react";
import { StyleSheet, View } from "react-native";
import Reanimated, { useAnimatedStyle } from "react-native-reanimated";

import { useConstant } from "../react/useConstant";
import { colors } from "../theme";
import { SurfaceToneProvider } from "../ui/surfaceTone";
import { threadListLayout } from "../ui/thread-list-layout";
import { currentPaneGeometry, usePaneMotionArmed, type PaneMotionState } from "./paneMotion";
import {
  createRightPaneKey,
  rightPanePlacement,
  WorkspacePaneContext,
  WorkspacePanesContext,
  type RightPanePlacement,
  type WorkspacePaneCapabilities,
  type WorkspacePaneVisibility,
} from "./workspacePanes";
import { v1WorkspaceShellStyles } from "./WorkspaceShell.styles";

/** A pane a destination places: its content and the actions its owner declares for it. */
type WorkspacePaneDeclaration = {
  readonly capabilities: WorkspacePaneCapabilities;
  readonly content: ReactElement;
  readonly testID: string;
};

type CenterLayoutProps = {
  readonly center: WorkspacePaneDeclaration;
  readonly right: WorkspacePaneDeclaration | null;
  readonly testID: string;
};

/**
 * The center destination and its optional right pane, placed inside the center destination so
 * route-owned content stays in its route tree. It feeds the right pane's presence into the frame's
 * three-pane owner and places both panes from the frame's one pane motion: beside, the center and
 * right panes split the width equally and the center rounds its right corners; a fullscreen right
 * pane covers the retained center; a fullscreen center keeps the right pane mounted past the
 * trailing edge; the phone layout covers the center. The right pane sits on the frame's surface,
 * like the left.
 */
export function WorkspaceCenterLayout({
  active,
  ...props
}: CenterLayoutProps & {
  /** Only the frame's active destination feeds right-pane presence into the frame. */
  readonly active: boolean;
}): React.JSX.Element {
  const layout = useContext(WorkspacePanesContext);
  useRightPanePresence(active, props.right !== null);
  // WHY: outside a pane frame no motion exists; that boundary delegates to the static layout.
  return layout === null ? (
    <StandaloneCenterLayout {...props} />
  ) : (
    <FramedCenterLayout {...props} geometry={layout.geometry} visibility={layout.visibility} />
  );
}

/**
 * Feeds this destination's right-pane presence into the frame owner while its route is active.
 * A center or right fullscreen belongs to this destination and ends with it.
 */
function useRightPanePresence(active: boolean, rightMounted: boolean): void {
  const owner = useContext(WorkspacePanesContext)?.owner ?? null;
  const key = useConstant(createRightPaneKey);
  useLayoutEffect(() => {
    if (owner === null || !active || !rightMounted) {
      return undefined;
    }
    owner.right$.set(key);
    return () => {
      if (owner.right$.peek() === key) {
        owner.right$.set(null);
      }
    };
  }, [active, key, owner, rightMounted]);
  useLayoutEffect(
    () => () => {
      const fullscreen = owner?.fullscreen$.peek() ?? null;
      if (fullscreen === "center" || fullscreen === "right") {
        owner?.fullscreen$.set(null);
      }
    },
    [owner],
  );
}

/** Both panes inside a frame, framed by the frame's pane geometry on the UI thread. */
function FramedCenterLayout({
  center,
  geometry,
  right,
  testID,
  visibility,
}: CenterLayoutProps & {
  readonly geometry: PaneMotionState;
  readonly visibility: WorkspacePaneVisibility;
}): React.JSX.Element {
  const shown = useLeavingRightPane(right);
  // A closed right pane that is still sliding out is hidden like a stashed one.
  const placement = right === null ? "stashed" : rightPanePlacement(visibility);
  return (
    <View style={[styles.layout, v1WorkspaceShellStyles.paneFrame]} testID={testID}>
      <FramedCenterPane covered={placement === "cover"} declaration={center} geometry={geometry} />
      {shown === null ? null : (
        <FramedRightPane
          declaration={shown}
          geometry={geometry}
          gutter={visibility.kind !== "stacked"}
          placement={placement}
        />
      )}
    </View>
  );
}

/** The center surface clips its content while the frame's pane geometry moves its edge. */
function FramedCenterPane({
  covered,
  declaration,
  geometry,
}: {
  readonly covered: boolean;
  readonly declaration: WorkspacePaneDeclaration;
  readonly geometry: PaneMotionState;
}): React.JSX.Element {
  const clip = useAnimatedStyle(() => {
    const pane = currentPaneGeometry(geometry);
    return {
      borderBottomRightRadius: pane.centerRightRadius,
      borderTopRightRadius: pane.centerRightRadius,
      width: pane.centerClipWidth,
    };
  });
  const content = useAnimatedStyle(() => ({
    width: currentPaneGeometry(geometry).centerWidth,
  }));
  return (
    <Reanimated.View
      accessibilityElementsHidden={covered}
      // The covering right pane already takes touches; only assistive technology must skip it.
      importantForAccessibility={covered ? "no-hide-descendants" : "auto"}
      style={[styles.pane, styles.center, clip]}
      testID={declaration.testID}
    >
      <Reanimated.View style={[styles.pane, content]}>
        <CenterPaneContent declaration={declaration} />
      </Reanimated.View>
    </Reanimated.View>
  );
}

function CenterPaneContent({
  declaration,
}: {
  readonly declaration: WorkspacePaneDeclaration;
}): React.JSX.Element {
  return (
    <WorkspacePaneContext.Provider
      value={{ capabilities: declaration.capabilities, pane: "center" }}
    >
      {declaration.content}
    </WorkspacePaneContext.Provider>
  );
}

/**
 * The declared right pane, or the last one while its closing rearrangement still moves it out,
 * so a closing pane slides away instead of vanishing.
 */
function useLeavingRightPane(
  right: WorkspacePaneDeclaration | null,
): WorkspacePaneDeclaration | null {
  const armed = usePaneMotionArmed();
  const [retained, setRetained] = useState(right);
  const shown = right ?? (armed ? retained : null);
  if (shown !== retained) {
    setRetained(shown);
  }
  return shown;
}

/** The right pane on the recessed frame surface, translated by the frame's pane geometry. */
function FramedRightPane({
  declaration,
  geometry,
  gutter,
  placement,
}: {
  readonly declaration: WorkspacePaneDeclaration;
  readonly geometry: PaneMotionState;
  /** Beside other panes the right pane keeps the left pane's edge inset. */
  readonly gutter: boolean;
  readonly placement: RightPanePlacement;
}): React.JSX.Element {
  const frame = useAnimatedStyle(() => {
    const pane = currentPaneGeometry(geometry);
    // The right pane lives inside the destination, so its frame position is destination-relative.
    return { transform: [{ translateX: pane.rightX - pane.detailX }], width: pane.rightWidth };
  });
  const hidden = placement === "stashed";
  return (
    <Reanimated.View
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      pointerEvents={hidden ? "none" : "auto"}
      style={[
        styles.pane,
        styles.right,
        v1WorkspaceShellStyles.paneFrame,
        gutter && styles.rightGutter,
        frame,
      ]}
      testID={declaration.testID}
    >
      <RightPaneContent declaration={declaration} />
    </Reanimated.View>
  );
}

function RightPaneContent({
  declaration,
}: {
  readonly declaration: WorkspacePaneDeclaration;
}): React.JSX.Element {
  return (
    <SurfaceToneProvider value="recessed">
      <WorkspacePaneContext.Provider
        value={{ capabilities: declaration.capabilities, pane: "right" }}
      >
        {declaration.content}
      </WorkspacePaneContext.Provider>
    </SurfaceToneProvider>
  );
}

/** Outside a pane frame the right pane covers the center, as on a phone, without motion. */
function StandaloneCenterLayout({ center, right, testID }: CenterLayoutProps): React.JSX.Element {
  const centerCovered = right !== null;
  return (
    <View style={[styles.layout, v1WorkspaceShellStyles.paneFrame]} testID={testID}>
      <View
        accessibilityElementsHidden={centerCovered}
        importantForAccessibility={centerCovered ? "no-hide-descendants" : "auto"}
        style={[StyleSheet.absoluteFill, styles.center]}
        testID={center.testID}
      >
        <CenterPaneContent declaration={center} />
      </View>
      {right === null ? null : (
        <View
          style={[StyleSheet.absoluteFill, styles.right, v1WorkspaceShellStyles.paneFrame]}
          testID={right.testID}
        >
          <RightPaneContent declaration={right} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Clips the center content to the center surface while the surface moves.
  center: {
    backgroundColor: colors.conversationSurface,
    overflow: "hidden",
  },
  layout: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
  },
  pane: {
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0,
  },
  right: {
    overflow: "hidden",
    zIndex: 1,
  },
  // The left pane's catalog edge inset, so the right pane's content sits off the center and the
  // screen edge exactly as the catalog's cards and controls do.
  rightGutter: {
    paddingHorizontal: threadListLayout.edgeInset,
  },
});
