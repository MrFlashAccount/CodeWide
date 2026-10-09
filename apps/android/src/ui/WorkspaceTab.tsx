import { Ionicons } from "@expo/vector-icons";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import type { ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, iconSize } from "../theme";
import { useConstant } from "../react/useConstant";
import { useEvent } from "../react/useEvent";
import { AppText } from "./Typography";
import { GRID_TITLE_LINES, styles } from "./WorkspaceTab.styles";

type WorkspaceTabProps = {
  readonly closable?: boolean;
  readonly closeLabel: string;
  readonly compact?: boolean;
  readonly detail: string | null;
  readonly label: string;
  readonly layout: "strip" | "grid" | "list";
  readonly leading: ReactNode;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onSelect: () => void;
  readonly renderDecoration?: ((pressed: boolean) => ReactNode) | undefined;
  readonly selected: boolean;
  readonly selectLabel: string;
  readonly surfaceStyle?: StyleProp<ViewStyle>;
};

/** Shared tab chrome; feature adapters own selection, close policy and all resource lifetimes. */
export function WorkspaceTab(props: WorkspaceTabProps): React.JSX.Element {
  const focus$ = useConstant(() => observable<"select" | "close" | null>(null));
  const focus = useSelector(focus$);
  const pressed$ = useConstant(() => observable(false));
  const pressed = useSelector(pressed$);
  const pressIn = useEvent((): void => {
    pressed$.set(true);
  });
  const pressOut = useEvent((): void => {
    pressed$.set(false);
  });
  const focusSelect = useEvent(() => {
    focus$.set("select");
  });
  const focusClose = useEvent(() => {
    focus$.set("close");
  });
  const blur = useEvent(() => {
    focus$.set(null);
  });
  return (
    <View style={tabSurfaceStyles(props, focus, pressed)} testID="workspace-tab-surface">
      {props.renderDecoration?.(pressed)}
      <Pressable
        accessibilityLabel={props.selectLabel}
        accessibilityRole="tab"
        accessibilityState={{ selected: props.selected }}
        onBlur={blur}
        onFocus={focusSelect}
        onPress={props.onSelect}
        onPressIn={pressIn}
        onPressOut={pressOut}
        style={({ pressed }) => [
          styles.select,
          props.compact === true && styles.compactSelect,
          props.layout === "grid" && styles.gridSelect,
          props.compact !== true && pressed && styles.pressed,
          props.compact !== true && focus === "select" && styles.focused,
        ]}
      >
        <View
          style={[
            props.layout === "grid" ? styles.gridLeading : styles.leading,
            props.compact === true && props.layout !== "grid" && styles.compactLeading,
          ]}
        >
          {props.leading}
        </View>
        <WorkspaceTabIdentity {...props} />
      </Pressable>
      {props.closable !== false && (
        <Pressable
          accessibilityLabel={props.closeLabel}
          accessibilityRole="button"
          onBlur={blur}
          onFocus={focusClose}
          onPress={props.onClose}
          onPressIn={pressIn}
          onPressOut={pressOut}
          style={({ pressed }) => [
            styles.close,
            props.compact === true && styles.compactClose,
            props.layout === "grid" && styles.gridClose,
            props.compact !== true && pressed && styles.pressed,
            props.compact !== true && focus === "close" && styles.focused,
          ]}
        >
          <Ionicons
            allowFontScaling={false}
            color={colors.textMuted}
            name="close"
            size={iconSize.action}
            style={styles.closeGlyph}
          />
        </Pressable>
      )}
      {props.selected && props.compact !== true && (
        <View pointerEvents="none" style={styles.selectionMark} />
      )}
    </View>
  );
}

function WorkspaceTabIdentity(props: WorkspaceTabProps): React.JSX.Element {
  return (
    <View style={styles.identity}>
      <View
        style={[
          props.layout === "grid" && styles.gridTitle,
          props.compact === true && props.layout === "grid" && styles.compactGridTitle,
        ]}
      >
        <AppText
          numberOfLines={props.layout === "grid" ? GRID_TITLE_LINES : 1}
          shimmering={props.loading}
          style={tabLabelStyles(props)}
        >
          {props.label}
        </AppText>
      </View>
      {props.detail !== null && (
        <AppText numberOfLines={1} style={styles.detail}>
          {props.detail}
        </AppText>
      )}
    </View>
  );
}

function tabSurfaceStyles(
  props: WorkspaceTabProps,
  focus: "select" | "close" | null,
  pressed: boolean,
) {
  return [
    styles.root,
    props.layout === "strip" ? styles.strip : styles.card,
    props.layout === "grid" && styles.grid,
    props.selected && styles.selected,
    props.compact === true && compactSurfaceStyles(props.layout, focus, pressed),
    props.surfaceStyle,
  ];
}

function compactSurfaceStyles(
  layout: WorkspaceTabProps["layout"],
  focus: "select" | "close" | null,
  pressed: boolean,
) {
  return [
    styles.compact,
    layout === "strip" && styles.compactStrip,
    layout === "grid" && styles.compactGrid,
    pressed && styles.pressed,
    focus !== null && styles.compactFocused,
  ];
}

function tabLabelStyles(props: WorkspaceTabProps) {
  return [
    props.layout === "strip" ? styles.stripLabel : styles.label,
    props.compact === true && styles.compactLabel,
    props.selected && styles.selectedLabel,
  ];
}
