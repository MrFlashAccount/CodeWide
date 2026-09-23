import { useSelector } from "@legendapp/state/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { globalVoiceOrbStyle$ } from "../../data/globalVoiceOrbStyleState";
import {
  clearGlobalVoiceOrbLaunchOrigin,
  type GlobalVoiceOrbLaunchOrigin,
  stageGlobalVoiceOrbLaunchOrigin,
} from "../../native/globalVoiceOverlayPermission";
import { supportsGlobalVoiceFloatingOverlay } from "../../native/globalVoiceOverlayPresentation";
import type { GlobalVoiceOrbState } from "../../native/globalVoiceOverlayActions";
import { useEvent } from "../../react/useEvent";
import { radii, touchTarget } from "../../theme";
import { VoiceAssistantOrb } from "../../ui/VoiceAssistantOrb";

const PRESSED_OPACITY = 0.68;
const HEADER_ORB_SIZE = 34;
const CENTER_DIVISOR = 2;
const ERROR_INDICATOR_DURATION_MS = 3000;

export type GlobalVoiceControl = {
  readonly onToggle: (origin: GlobalVoiceOrbLaunchOrigin | null) => void;
  readonly orbState: GlobalVoiceOrbState;
  readonly state: "idle" | "starting" | "active" | "reconnecting" | "stopping";
};

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

/** Stable header anchor; only the native activation handoff owns spatial orb animation. */
export function GlobalVoiceEntryAction(props: GlobalVoiceControl): React.JSX.Element | null {
  const orbOriginRef = useRef<View>(null);
  const [errorDismissed, setErrorDismissed] = useState(false);
  const orbStyle = useSelector(globalVoiceOrbStyle$);
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
    <View onLayout={measureOrigin} style={styles.slot} testID="global-voice-slot">
      <HeaderActionSurface
        hidden={hideHeaderOrb}
        measureOrigin={measureOrigin}
        onPress={toggle}
        registerOrigin={registerOrigin}
        state={props.state}
      >
        {hideHeaderOrb ? null : (
          <VoiceAssistantOrb
            accessibilityElementsHidden
            orbState={visibleOrbState}
            orbStyle={orbStyle}
            pointerEvents="none"
            style={styles.orbFill}
            testID="global-voice-orb"
          />
        )}
      </HeaderActionSurface>
    </View>
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
});
