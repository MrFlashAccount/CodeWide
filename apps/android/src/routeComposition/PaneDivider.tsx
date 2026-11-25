import { observablePrimitive } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useContext, useEffect, type ReactElement } from "react";
import { StyleSheet, type AccessibilityActionEvent } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";

import { rememberPaneSplit } from "../data/paneSplitPreferences";
import { useConstant } from "../react/useConstant";
import { useReducedMotionPreference } from "../rendering/reduced-motion-store";
import { useEvent } from "../react/useEvent";
import { colors, radii, spacing, touchTarget } from "../theme";
import { useAndroidBackHandler } from "../ui/use-android-back-handler";
import { PaneDividerMenu } from "./PaneDividerMenu";
import {
  cancelDividerDrag,
  dividerAnchor,
  preparePresetTranscript,
  startPresetMotion,
  usePaneDividerGesture,
  type DividerLanding,
} from "./paneDividerGesture";
import { PaneMotionContext, type PaneMotionState } from "./paneMotion";
import {
  selectWorkspaceSplit,
  type WorkspacePane,
  type WorkspacePaneOwner,
} from "./workspacePanes";

import { DIVIDER_HIT_SHARE } from "./paneDividerGeometry";
import { FULL_PERCENT, yogaPercent, type PanePair } from "../ui/paneSplitSizes";

const HIT_WIDTH = touchTarget;
const HALF = 0.5;
const GRIP_GROWTH = 0.35;
const GRIP_HEIGHT = 30;
const DIVIDER_LAYER = 2;
const HIT_INSET = yogaPercent(FULL_PERCENT * (1 - DIVIDER_HIT_SHARE) * HALF);
const HINT_DURATION_MS = 1100;
let showedDividerHint = false;

function useDividerHint(enabled: boolean) {
  const hint = useSharedValue(0);
  useEffect(() => {
    if (!enabled || showedDividerHint) {
      return undefined;
    }
    showedDividerHint = true;
    hint.set(1);
    const timer = setTimeout(() => {
      hint.set(withTiming(0));
    }, HINT_DURATION_MS);
    return () => {
      clearTimeout(timer);
      hint.set(0);
    };
  }, [enabled, hint]);
  return hint;
}

function leadingPercent(
  fullscreen: WorkspacePane | null,
  leading: WorkspacePane,
  percent: number,
): number {
  if (fullscreen === null) {
    return percent;
  }
  return fullscreen === leading ? FULL_PERCENT : 0;
}

function actionsFor(pair: PanePair, fullscreen: WorkspacePane | null) {
  if (fullscreen !== null) {
    return [{ label: "Restore panel split", name: "show-split" }];
  }
  return pair === "left+center"
    ? [{ label: "Hide catalog", name: "hide-leading" }]
    : [
        { label: "Hide center pane", name: "hide-leading" },
        { label: "Hide right pane", name: "hide-trailing" },
      ];
}
function splitLabel(percent: number): string {
  const leading = Math.round(percent);
  return [leading, FULL_PERCENT - leading].join("/");
}
/** The preset menu remembers its originating edge through its closing animation. */
function useDividerMenu(pair: PanePair, bothEdges: boolean) {
  const menu$ = useConstant(() => observablePrimitive({ edge: pair, open: false }));
  const menu = useSelector(() => menu$.get());
  const open = menu.open;
  const menuPair = open ? menu.edge : null;
  const selected = bothEdges ? menu.edge : pair;
  const close = useEvent(() => {
    const current = menu$.peek();
    if (current.open) {
      menu$.set({ edge: current.edge, open: false });
    }
  });
  const toggle = useEvent((edge: PanePair) => {
    const current = menu$.peek();
    menu$.set({ edge, open: current.edge !== edge || !current.open });
  });
  useAndroidBackHandler(open, close);
  return { close, menu$, menuPair, open, selected, toggle };
}

/** The frame's dividers share one touch detector and one preset menu. */
export function PaneDivider({
  bothEdges,
  enabled,
  fullscreen,
  geometry,
  owner,
  pair,
  renderFrame,
  shares,
  width,
}: {
  readonly bothEdges: boolean;
  readonly enabled: boolean;
  readonly fullscreen: WorkspacePane | null;
  readonly geometry: PaneMotionState;
  readonly owner: WorkspacePaneOwner;
  readonly pair: PanePair;
  readonly renderFrame: (divider: ReactElement | null) => ReactElement;
  readonly shares: Readonly<Record<PanePair, number>>;
  readonly width: number;
}): React.JSX.Element {
  const { close, menu$, menuPair, open, selected, toggle } = useDividerMenu(pair, bothEdges);
  const alternatePair = pair === "left+center" ? "center+right" : "left+center";
  const motion = useContext(PaneMotionContext);
  const { rearrange, resize } = motion;
  const reducedMotion = useReducedMotionPreference();
  const hint = useDividerHint(enabled);
  const setSplit = useEvent((edge: PanePair, value: number, transition: typeof rearrange) => {
    close();
    if (value === shares[edge] && edge === pair && fullscreen === null) {
      scheduleOnUI(cancelDividerDrag, geometry);
      return;
    }
    transition(() => {
      rememberPaneSplit(edge, value);
      selectWorkspaceSplit(owner, edge);
      owner.fullscreen$.set(null);
    });
  });
  const setCover = useEvent(
    (edge: PanePair, side: "leading" | "trailing", transition: typeof rearrange) => {
      const leading = edge === "left+center" ? "left" : "center";
      const trailing = edge === "left+center" ? "center" : "right";
      const pane = side === "leading" ? trailing : leading;
      if (fullscreen === pane) {
        scheduleOnUI(cancelDividerDrag, geometry);
        return;
      }
      transition(() => {
        selectWorkspaceSplit(owner, edge);
        owner.fullscreen$.set(pane);
      });
    },
  );
  const select = useEvent((edge: PanePair, value: number) => {
    setSplit(edge, value, (apply) => {
      rearrange(() => {
        if (fullscreen === null && !reducedMotion) {
          const generation = motion.claim();
          if (generation !== null) {
            motion.captureBodies();
            scheduleOnUI(
              startPresetMotion,
              geometry,
              { pair: edge, percent: value },
              {
                generation,
                onSettled: motion.settle,
              },
            );
          }
        }
        apply();
      });
    });
  });
  const selectFromMenu = useEvent((value: number) => {
    // Native touch and the accessible Pressable share one activation per opening.
    const current = menu$.peek();
    if (current.open) {
      select(current.edge, value);
    }
  });
  const prepareSelectedWidth = (value: number): void => {
    "worklet";
    if (fullscreen === null && !reducedMotion && value !== shares[selected]) {
      preparePresetTranscript(geometry, selected, value);
    }
  };
  const land = useEvent((landing: DividerLanding, source: PanePair, frameWidth: number) => {
    if ((!bothEdges && pair !== source) || Math.abs(frameWidth - width) > 1) {
      return;
    }
    if (landing.kind === "split") {
      setSplit(source, landing.percent, resize);
    } else {
      setCover(source, landing.side, resize);
    }
  });
  const action = useEvent((edge: PanePair, event: AccessibilityActionEvent) => {
    switch (event.nativeEvent.actionName) {
      case "activate":
        toggle(edge);
        break;
      case "show-split":
        select(edge, shares[edge]);
        break;
      case "hide-leading":
        setCover(edge, "leading", rearrange);
        break;
      case "hide-trailing":
        if (edge === "center+right") {
          setCover(edge, "trailing", rearrange);
        }
        break;
    }
  });
  function anchorFor(edge: PanePair): number {
    const current = leadingPercent(
      fullscreen,
      edge === "left+center" ? "left" : "center",
      shares[edge],
    );
    return Math.max(HIT_WIDTH, Math.min(width - HIT_WIDTH, (width * current) / FULL_PERCENT));
  }
  const { gesture, press, source } = usePaneDividerGesture({
    alternate: bothEdges ? { anchor: anchorFor(alternatePair), pair: alternatePair } : null,
    anchor: anchorFor(pair),
    enabled: enabled && !open,
    geometry,
    onLand: land,
    onTap: toggle,
    pair,
  });
  const cancel = useEvent(() => {
    scheduleOnUI(cancelDividerDrag, geometry);
  });
  useEffect(() => {
    close();
    return cancel;
  }, [cancel, close, enabled, pair, width]);
  const targets: readonly PanePair[] = bothEdges ? ["left+center", "center+right"] : [pair];
  const controls = (
    <>
      {targets.map((edge) => (
        <DividerHandle
          action={action}
          anchor={anchorFor(edge)}
          dual={bothEdges}
          fullscreen={fullscreen}
          geometry={geometry}
          hint={hint}
          key={edge}
          menuPair={menuPair}
          pair={edge}
          percent={shares[edge]}
          press={press}
          source={source}
          toggle={toggle}
        />
      ))}
      <PaneDividerMenu
        anchor={anchorFor(selected)}
        onDismiss={close}
        onSelect={selectFromMenu}
        open={open}
        pair={selected}
        percent={fullscreen === null ? shares[selected] : null}
        prepareSelectedWidth={prepareSelectedWidth}
        width={width}
      />
    </>
  );
  return (
    <GestureDetector gesture={gesture}>{renderFrame(enabled ? controls : null)}</GestureDetector>
  );
}
function DividerHandle({
  action,
  anchor,
  dual,
  fullscreen,
  geometry,
  hint,
  menuPair,
  pair,
  percent,
  press,
  source,
  toggle,
}: {
  readonly action: (edge: PanePair, event: AccessibilityActionEvent) => void;
  readonly anchor: number;
  readonly dual: boolean;
  readonly fullscreen: WorkspacePane | null;
  readonly geometry: PaneMotionState;
  readonly hint: SharedValue<number>;
  readonly menuPair: PanePair | null;
  readonly pair: PanePair;
  readonly percent: number;
  readonly press: SharedValue<number>;
  readonly source: SharedValue<PanePair>;
  readonly toggle: (edge: PanePair) => void;
}): React.JSX.Element {
  const placement = useAnimatedStyle(() => ({
    left: dividerAnchor(geometry, pair, anchor) - HIT_WIDTH * HALF,
  }));
  const grip = useAnimatedStyle(() => {
    const pressed = source.get() === pair ? press.get() : 0;
    return {
      opacity: menuPair !== null ? 0 : Math.max(pressed, hint.get()),
      transform: [{ scale: 1 + pressed * GRIP_GROWTH }],
    };
  });
  const onAction = useEvent((event: AccessibilityActionEvent) => {
    action(pair, event);
  });
  const onTap = useEvent(() => {
    toggle(pair);
  });
  const label =
    pair === "left+center" ? "Resize catalog and center panels" : "Resize center and right panels";
  return (
    <Animated.View
      accessibilityActions={[
        { label: "Choose panel layout", name: "activate" },
        ...actionsFor(pair, fullscreen),
      ]}
      accessibilityLabel={dual ? label : "Resize panels"}
      accessibilityRole="button"
      accessibilityState={{ expanded: menuPair === pair }}
      accessibilityValue={{ text: fullscreen === null ? splitLabel(percent) : "Fullscreen" }}
      accessible
      focusable
      onAccessibilityAction={onAction}
      onAccessibilityTap={onTap}
      pointerEvents="none"
      style={[styles.target, placement]}
      testID={dual ? `workspace-pane-divider-${pair}` : "workspace-pane-divider"}
    >
      <Animated.View pointerEvents="none" style={[styles.grip, grip]} />
    </Animated.View>
  );
}
const styles = StyleSheet.create({
  grip: {
    backgroundColor: colors.textMuted,
    borderRadius: radii.pill,
    height: GRIP_HEIGHT,
    width: spacing.xxs,
  },
  target: {
    alignItems: "center",
    bottom: HIT_INSET,
    justifyContent: "center",
    position: "absolute",
    top: HIT_INSET,
    width: HIT_WIDTH,
    zIndex: DIVIDER_LAYER,
  },
});
