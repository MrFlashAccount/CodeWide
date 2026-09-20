import { useSelector } from "@legendapp/state/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Reanimated, { Easing, Keyframe, LinearTransition } from "react-native-reanimated";

import { globalVoiceOrbStyle$ } from "../../data/globalVoiceOrbStyleState";
import {
  clearGlobalVoiceOrbLaunchOrigin,
  type GlobalVoiceOrbLaunchOrigin,
  stageGlobalVoiceOrbLaunchOrigin,
} from "../../native/globalVoiceOverlayPermission";
import { supportsGlobalVoiceFloatingOverlay } from "../../native/globalVoiceOverlayPresentation";
import type { GlobalVoiceOrbState } from "../../native/globalVoiceOverlayActions";
import { useEvent } from "../../react/useEvent";
import { useReducedMotionPreference } from "../../rendering/reduced-motion-store";
import { radii, touchTarget } from "../../theme";
import { VoiceAssistantOrb, type VoiceAssistantOrbProps } from "../../ui/VoiceAssistantOrb";

const PRESSED_OPACITY = 0.68;
const HEADER_ORB_SIZE = 34;
const CENTER_DIVISOR = 2;
const ERROR_INDICATOR_DURATION_MS = 3000;
const MOTION_START = 0;
const MOTION_END = 100;
const VISIBLE_OPACITY = 1;
const HIDDEN_OPACITY = 0;
const RESTING_SCALE = 1;
const ENTERING_SCALE = 0.82;
const EXITING_SCALE = 0.78;
const COLLAPSED_SLOT_WIDTH = 0;
const HEADER_SLOT_DURATION_MS = 220;
const HEADER_ORB_ENTER_DURATION_MS = 180;
const HEADER_ORB_EXIT_DURATION_MS = 120;
const HEADER_SLOT_TRANSITION = LinearTransition.duration(HEADER_SLOT_DURATION_MS).easing(
  Easing.out(Easing.cubic),
);
const HEADER_ORB_ENTERING = new Keyframe({
  [MOTION_END]: { opacity: VISIBLE_OPACITY, transform: [{ scale: RESTING_SCALE }] },
  [MOTION_START]: { opacity: HIDDEN_OPACITY, transform: [{ scale: ENTERING_SCALE }] },
}).duration(HEADER_ORB_ENTER_DURATION_MS);
const HEADER_ORB_EXITING = new Keyframe({
  [MOTION_END]: { opacity: HIDDEN_OPACITY, transform: [{ scale: EXITING_SCALE }] },
  [MOTION_START]: { opacity: VISIBLE_OPACITY, transform: [{ scale: RESTING_SCALE }] },
}).duration(HEADER_ORB_EXIT_DURATION_MS);

export type GlobalVoiceControl = {
  readonly onToggle: (origin: GlobalVoiceOrbLaunchOrigin | null) => void;
  readonly orbState: GlobalVoiceOrbState;
  readonly state: "idle" | "starting" | "active" | "reconnecting" | "stopping";
};

function HeaderMotionSlot({
  children,
  hidden,
  onLayout,
  reducedMotion,
}: {
  readonly children: ReactNode;
  readonly hidden: boolean;
  readonly onLayout: () => void;
  readonly reducedMotion: boolean;
}): React.JSX.Element {
  return (
    <Reanimated.View
      {...(reducedMotion ? {} : { layout: HEADER_SLOT_TRANSITION })}
      onLayout={onLayout}
      style={[styles.slot, hidden && styles.slotHidden]}
      testID="global-voice-slot"
    >
      {children}
    </Reanimated.View>
  );
}

function HeaderOrbMotion({
  orbState,
  orbStyle,
  reducedMotion,
}: {
  readonly orbState: VoiceAssistantOrbProps["orbState"];
  readonly orbStyle: VoiceAssistantOrbProps["orbStyle"];
  readonly reducedMotion: boolean;
}): React.JSX.Element {
  return (
    <Reanimated.View
      {...(reducedMotion ? {} : { entering: HEADER_ORB_ENTERING, exiting: HEADER_ORB_EXITING })}
      style={styles.orbFill}
      testID="global-voice-orb-motion"
    >
      <VoiceAssistantOrb
        accessibilityElementsHidden
        orbState={orbState}
        orbStyle={orbStyle}
        pointerEvents="none"
        style={styles.orbFill}
        testID="global-voice-orb"
      />
    </Reanimated.View>
  );
}

function HeaderActionSurface({
  children,
  hidden,
  measureOrigin,
  onPress,
  registerOrigin,
  state,
}: {
  readonly children: ReactNode;
  readonly hidden: boolean;
  readonly measureOrigin: () => void;
  readonly onPress: () => void;
  readonly registerOrigin: (node: View | null) => void;
  readonly state: GlobalVoiceControl["state"];
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityElementsHidden={hidden}
      accessibilityLabel={labels[state]}
      accessibilityRole="button"
      accessibilityState={{ selected: state === "active" }}
      accessible={!hidden}
      disabled={hidden}
      importantForAccessibility={hidden ? "no-hide-descendants" : "auto"}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.pressed]}
    >
      <View
        collapsable={false}
        onLayout={measureOrigin}
        pointerEvents="none"
        ref={registerOrigin}
        style={styles.orb}
        testID="global-voice-orb-anchor"
      >
        {children}
      </View>
    </Pressable>
  );
}

/** Header launch affordance that hands its screen origin to the single floating orb. */
export function GlobalVoiceEntryAction(props: GlobalVoiceControl): React.JSX.Element | null {
  const orbOriginRef = useRef<View>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const orbStyle = useSelector(globalVoiceOrbStyle$);
  const reducedMotion = useReducedMotionPreference();
  useEffect(() => {
    if (props.orbState !== "error" || errorDismissed) {
      return undefined;
    }
    const timeout = setTimeout(() => {
      setErrorDismissed(true);
    }, ERROR_INDICATOR_DURATION_MS);
    return () => {
      clearTimeout(timeout);
    };
  }, [errorDismissed, props.orbState]);
  const publishMeasuredOrigin = useEvent(
    // WHY: React Native defines this as a four-argument callback; a rest tuple crashes React Compiler 1.0.0.
    // eslint-disable-next-line max-params
    (x: number, y: number, width: number, height: number): void => {
      stageGlobalVoiceOrbLaunchOrigin({
        centerX: x + width / CENTER_DIVISOR,
        centerY: y + height / CENTER_DIVISOR,
        diameter: Math.min(width, height),
      });
    },
  );
  const startFromMeasuredOrigin = useEvent(
    // WHY: React Native defines this as a four-argument callback; a rest tuple crashes React Compiler 1.0.0.
    // eslint-disable-next-line max-params
    (x: number, y: number, width: number, height: number): void => {
      const origin = {
        centerX: x + width / CENTER_DIVISOR,
        centerY: y + height / CENTER_DIVISOR,
        diameter: Math.min(width, height),
      };
      stageGlobalVoiceOrbLaunchOrigin(origin);
      props.onToggle(origin);
    },
  );
  const measureOrigin = useEvent((): void => {
    orbOriginRef.current?.measureInWindow(publishMeasuredOrigin);
  });
  const registerOrigin = useEvent((node: View | null): void => {
    const previous = orbOriginRef.current;
    orbOriginRef.current = node;
    if (node === null && previous !== null) {
      clearGlobalVoiceOrbLaunchOrigin();
    }
  });
  const toggle = useEvent((): void => {
    if (props.state === "idle") {
      setErrorDismissed(false);
    }
    if (!supportsGlobalVoiceFloatingOverlay() || props.state !== "idle") {
      props.onToggle(null);
      return;
    }
    const orbOrigin = orbOriginRef.current;
    if (orbOrigin === null) {
      props.onToggle(null);
      return;
    }
    orbOrigin.measureInWindow(startFromMeasuredOrigin);
  });

  const hideHeaderOrb = supportsGlobalVoiceFloatingOverlay() && props.state !== "idle";
  const visibleOrbState =
    props.orbState === "error" && !errorDismissed
      ? "error"
      : props.state === "idle"
        ? "disabled"
        : props.orbState;
  return (
    <HeaderMotionSlot hidden={hideHeaderOrb} onLayout={measureOrigin} reducedMotion={reducedMotion}>
      <HeaderActionSurface
        hidden={hideHeaderOrb}
        measureOrigin={measureOrigin}
        onPress={toggle}
        registerOrigin={registerOrigin}
        state={props.state}
      >
        {hideHeaderOrb ? null : (
          <HeaderOrbMotion
            orbState={visibleOrbState}
            orbStyle={orbStyle}
            reducedMotion={reducedMotion}
          />
        )}
      </HeaderActionSurface>
    </HeaderMotionSlot>
  );
}

const labels = {
  active: "Stop Global Voice Mode",
  idle: "Start Global Voice Mode",
  reconnecting: "Reconnecting Global Voice Mode",
  starting: "Starting Global Voice Mode",
  stopping: "Stopping Global Voice Mode",
};

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    overflow: "hidden",
    position: "absolute",
    right: 0,
    width: touchTarget,
  },
  orb: {
    height: HEADER_ORB_SIZE,
    width: HEADER_ORB_SIZE,
  },
  orbFill: {
    height: "100%",
    width: "100%",
  },
  pressed: {
    opacity: PRESSED_OPACITY,
  },
  slot: {
    height: touchTarget,
    overflow: "hidden",
    width: touchTarget,
  },
  slotHidden: {
    width: COLLAPSED_SLOT_WIDTH,
  },
});
