import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, iconSize, radii, touchTarget } from "../theme";
import { useThreePanels, type ThreePanelsChrome } from "./threePanels";

/**
 * The back intent the pane content supplies. `exit` leaves the content's root (a phone thread back
 * to its list, PR Details back to the catalog) and gives way to the pane's `×` wherever the pane
 * declares close; `nested` steps back inside the pane (Files changed back to Details) and always
 * shows.
 */
export type ThreePanelsBack = {
  readonly kind: "exit" | "nested";
  readonly label: string;
  readonly run: () => void;
};

/**
 * The standard header of whatever a workspace pane shows: `[←] title [trailing] [⤢] [⋯] [×]`. The
 * pane decides the controls it owns from `ThreePanelsContext`: the fullscreen toggle and the close
 * come from the pane's declared chrome, and the content's back intent shows only when it is nested
 * or the pane cannot close. The content supplies only its title, trailing actions and menu, so
 * back, fullscreen and close look and behave the same in every pane.
 */
export function ThreePanelsHeader({
  back,
  menu,
  style,
  testID,
  title,
  trailing,
  withoutBackStyle,
}: {
  readonly back: ThreePanelsBack | null;
  /** The content's ⋯ menu, after the fullscreen toggle. */
  readonly menu?: ReactNode;
  /** The content's row metrics (height, insets). */
  readonly style?: StyleProp<ViewStyle>;
  readonly testID: string;
  /**
   * Laid out as an item of the header row, vertically centred on the controls: content that fills
   * the remaining width or truncates sets `flex: 1` or `flexShrink: 1` with `minWidth: 0`.
   */
  readonly title: ReactNode;
  /** Content actions before the pane controls, such as Search or Submit review. */
  readonly trailing?: ReactNode;
  /** Applied while no back arrow leads the row, so the title keeps the content inset. */
  readonly withoutBackStyle?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { chrome } = useThreePanels();
  const shownBack = paneBack(back, chrome);
  return (
    <View style={[styles.row, style, shownBack === null && withoutBackStyle]} testID={testID}>
      {shownBack === null ? null : (
        <HeaderControl
          icon="arrow-back"
          iconSize={iconSize.navigation}
          label={shownBack.label}
          onPress={shownBack.run}
        />
      )}
      <View style={styles.title}>{title}</View>
      {trailing}
      <FullscreenControl chrome={chrome} />
      {menu}
      {chrome.close === null ? null : (
        <HeaderControl
          icon="close"
          iconSize={iconSize.action}
          label={`Close ${chrome.label}`}
          onPress={chrome.close}
        />
      )}
    </View>
  );
}

/** A nested Back always shows; an exit Back gives way to the `×` of a pane that declares close. */
function paneBack(back: ThreePanelsBack | null, chrome: ThreePanelsChrome): ThreePanelsBack | null {
  return back !== null && (back.kind === "nested" || chrome.close === null) ? back : null;
}

/** The pane's fullscreen toggle, where the pane can be shown alone now. */
function FullscreenControl({
  chrome,
}: {
  readonly chrome: ThreePanelsChrome;
}): React.JSX.Element | null {
  if (chrome.toggleFullscreen === null) {
    return null;
  }
  return chrome.fullscreen ? (
    <HeaderControl
      icon="contract-outline"
      iconSize={iconSize.action}
      label={`Exit ${chrome.label} fullscreen`}
      onPress={chrome.toggleFullscreen}
    />
  ) : (
    <HeaderControl
      icon="expand-outline"
      iconSize={iconSize.action}
      label={`Open ${chrome.label} fullscreen`}
      onPress={chrome.toggleFullscreen}
    />
  );
}

/** One pane control; every pane header draws its controls with this one shape. */
function HeaderControl({
  icon,
  iconSize: size,
  label,
  onPress,
}: {
  readonly icon: "arrow-back" | "close" | "contract-outline" | "expand-outline";
  readonly iconSize: number;
  readonly label: string;
  readonly onPress: () => void;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.control}
    >
      <Ionicons color={colors.text} name={icon} size={size} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
  },
  // A centring row: the title lays out exactly as a direct child of the header row did. In a
  // column slot, React Native's legacy Yoga errata (`YGErrataAll`) let a `flex: 1` title grow to
  // the row's full height, top-anchoring a two-line title instead of centring it on the controls.
  title: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    minWidth: 0,
  },
});
