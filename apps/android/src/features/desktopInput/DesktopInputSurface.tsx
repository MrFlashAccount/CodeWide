import { desktopInputAvailable } from "../../native/desktopInputAvailability";
import { desktopMouseButtons, desktopPrecisionGain } from "../../native/desktopInputCodes";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useSelector } from "@legendapp/state/react";
import { Pressable, ScrollView, View } from "react-native";
import { DesktopInputTarget } from "../../native/DesktopInputTarget";
import type { DesktopInputTargetHandle } from "../../native/desktopInputContract";
import { useEvent } from "../../react/useEvent";
import { AppText } from "../../ui/Typography";
import { DesktopInputModel, desktopModifiers } from "./desktopInputModel";
import {
  desktopInputProfiles,
  nextDesktopProfile,
  type DesktopProfileId,
  type DesktopShortcut,
} from "./desktopInputProfiles";
import { styles } from "./DesktopInputSurface.styles";

type SurfaceProps = {
  readonly active: boolean;
  readonly children: ReactNode;
  readonly defaultProfile: DesktopProfileId;
  readonly label: string;
  readonly sessionKey: string;
};

/** Opt-in desktop controls attached to exactly one browser surface, independent of its tabs. */
export function DesktopInputSurface(props: SurfaceProps): React.JSX.Element {
  const [owner, setOwner] = useState(() => ({
    model: new DesktopInputModel(props.defaultProfile),
    sessionKey: props.sessionKey,
  }));
  if (owner.sessionKey !== props.sessionKey) {
    setOwner({ model: new DesktopInputModel(props.defaultProfile), sessionKey: props.sessionKey });
  }
  const model = owner.model;
  const target = useRef<DesktopInputTargetHandle | null>(null);
  const state = useSelector(model.state$);
  const enabled = props.active && state.kind === "desktop";
  const reset = useEvent((): void => {
    model.reset();
  });
  useEffect(() => {
    // Visibility is synchronization with the native target, not render-data loading.
    if (!props.active) {
      model.reset();
    }
  }, [model, props.active]);
  return (
    <View style={styles.root}>
      <DesktopInputTarget
        {...nativeInputState(state)}
        enabled={enabled}
        onReset={reset}
        ref={target}
        sessionKey={props.sessionKey}
      >
        {props.children}
      </DesktopInputTarget>
      {desktopInputAvailable && props.active && (
        <Controls label={props.label} model={model} target={target} />
      )}
    </View>
  );
}

function nativeInputState(state: ReturnType<DesktopInputModel["state$"]["get"]>): {
  readonly heldButton: number;
  readonly modifiers: number;
  readonly sensitivity: number;
} {
  if (state.kind === "touch") {
    return { heldButton: 0, modifiers: 0, sensitivity: 1 };
  }
  return {
    heldButton: state.dragging ? desktopMouseButtons.left : 0,
    modifiers: desktopModifiers(state),
    sensitivity: state.precision ? desktopPrecisionGain : 1,
  };
}

type ControlOwnerProps = {
  readonly label: string;
  readonly model: DesktopInputModel;
  readonly target: React.RefObject<DesktopInputTargetHandle | null>;
};

function Controls(props: ControlOwnerProps): React.JSX.Element {
  const state = useSelector(props.model.state$);
  const enabled = state.kind === "desktop";
  const toggle = useEvent((): void => {
    props.model.toggle();
  });
  return (
    <View>
      <ScrollView
        contentContainerStyle={styles.controls}
        horizontal
        keyboardShouldPersistTaps="always"
        style={styles.row}
      >
        <Control label={`${props.label}: mouse`} onPress={toggle} selected={enabled} text="Mouse" />
        {enabled && <MouseControls {...props} />}
      </ScrollView>
      {enabled && (
        <AppText style={styles.hint}>
          1 finger: cursor · hold: drag · 2 fingers: scroll · tap: click
        </AppText>
      )}
      {enabled && <Shortcuts {...props} />}
    </View>
  );
}

function MouseControls({ model, target }: ControlOwnerProps): React.JSX.Element | null {
  const state = useSelector(model.state$);
  const enabled = state.kind === "desktop";
  const release = useEvent((): void => {
    model.release();
  });
  const profile = useEvent((): void => {
    model.setProfile(nextDesktopProfile(state.profile));
  });
  const ctrl = useEvent((): void => {
    model.toggleModifier("ctrl");
  });
  const shift = useEvent((): void => {
    model.toggleModifier("shift");
  });
  const alt = useEvent((): void => {
    model.toggleModifier("alt");
  });
  const drag = useEvent((): void => {
    model.toggleDrag();
  });
  const precision = useEvent((): void => {
    model.togglePrecision();
  });
  const left = useEvent((): void => {
    if (enabled) {
      target.current?.click(desktopMouseButtons.left);
    }
  });
  const right = useEvent((): void => {
    if (enabled) {
      target.current?.click(desktopMouseButtons.right);
    }
  });
  const middle = useEvent((): void => {
    if (enabled) {
      target.current?.click(desktopMouseButtons.middle);
    }
  });
  const keyboard = useEvent((): void => {
    if (enabled) {
      target.current?.keyboard();
    }
  });
  if (state.kind === "touch") {
    return null;
  }
  return (
    <>
      <Control
        label="Change desktop control profile"
        onPress={profile}
        text={desktopInputProfiles[state.profile].label}
      />
      <Control label="Hold Control" onPress={ctrl} selected={state.ctrl} text="Ctrl" />
      <Control label="Hold Shift" onPress={shift} selected={state.shift} text="Shift" />
      <Control label="Hold Alt" onPress={alt} selected={state.alt} text="Alt" />
      <Control label="Left mouse click" onPress={left} text="LMB" />
      <Control label="Right mouse click" onPress={right} text="RMB" />
      <Control label="Middle mouse click" onPress={middle} text="MMB" />
      <Control
        label="Hold left mouse button"
        onPress={drag}
        selected={state.dragging}
        text="Drag"
      />
      <Control
        label="Precise cursor movement"
        onPress={precision}
        selected={state.precision}
        text="Precise"
      />
      <Control label="Show keyboard for focused editor" onPress={keyboard} text="Keyboard" />
      <Control label="Release all held buttons and modifiers" onPress={release} text="Release" />
    </>
  );
}

function Shortcuts({ model, target }: ControlOwnerProps): React.JSX.Element {
  const state = useSelector(model.state$);
  return (
    <ScrollView
      contentContainerStyle={styles.controls}
      horizontal
      keyboardShouldPersistTaps="always"
      style={styles.row}
    >
      {desktopInputProfiles[state.profile].shortcuts.map((shortcut) => (
        <Shortcut key={shortcut.label} model={model} shortcut={shortcut} target={target} />
      ))}
    </ScrollView>
  );
}

function Shortcut(props: {
  readonly model: DesktopInputModel;
  readonly shortcut: DesktopShortcut;
  readonly target: React.RefObject<DesktopInputTargetHandle | null>;
}): React.JSX.Element {
  const press = useEvent((): void => {
    const chord = props.model.chord(props.shortcut);
    if (chord !== null) {
      props.target.current?.sendKey(chord);
    }
  });
  return <Control label={props.shortcut.label} onPress={press} text={props.shortcut.label} />;
}

function Control(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly selected?: boolean;
  readonly text: string;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={props.label}
      accessibilityRole="button"
      accessibilityState={{ selected: props.selected ?? false }}
      focusable={false}
      onPress={props.onPress}
      style={[styles.button, props.selected === true && styles.selected]}
    >
      <AppText style={styles.label}>{props.text}</AppText>
    </Pressable>
  );
}
