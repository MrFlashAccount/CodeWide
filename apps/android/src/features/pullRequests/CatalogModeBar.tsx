import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { type AccessibilityActionEvent, AppState, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
import { useWindowLayout } from "../workspace/useWindowLayout";
import { catalogModeBarHeight } from "../../presentation/layouts/catalogModeBarGeometry";
import { spacing, typeScale } from "../../theme";
import { type IMaskedTabIconState, MaskedTabBar } from "../../vendor/reacticx/masked-tab-bar";

const ACTIVATE_ACTIONS = [{ name: "activate" }] as const;
const MASKED_TAB_PALETTE = {
  active: "#000000",
  inactive: "#7d7d7d",
  pill: "#f2f2f2",
} as const;
const FLOATING_BAR_ELEVATION = 8;

/** Which catalog the bottom bar shows. */
export type CatalogMode = "pullRequests" | "threads";

/**
 * Always-mounted bottom bar of the catalog pane (never inside the PR screen).
 * Reacticx owns its visuals and gestures; route composition owns the controlled
 * value. The separate invisible tabs expose the same control to screen readers.
 */
export function CatalogModeBar({
  mode,
  onSelect,
}: {
  readonly mode: CatalogMode;
  readonly onSelect: (mode: CatalogMode) => void;
}): React.JSX.Element {
  const selectMode = useEvent((value: string) => {
    const nextMode = parseCatalogMode(value);
    if (nextMode !== null && nextMode !== mode) {
      onSelect(nextMode);
    }
  });
  const activateSelectedMode = useEvent((value: string) => {
    const selectedMode = parseCatalogMode(value);
    if (selectedMode === mode) {
      onSelect(selectedMode);
    }
  });
  const pullRequestsLabel = "Pull requests";

  return (
    <View accessibilityRole="tablist" style={styles.shell} testID="catalog-mode-bar">
      <CatalogMaskedTabs
        mode={mode}
        onSelectedValueActivate={activateSelectedMode}
        onValueChange={selectMode}
        pullRequestsLabel={pullRequestsLabel}
      />
      <AccessibilityTabs mode={mode} onSelect={onSelect} pullRequestsLabel={pullRequestsLabel} />
    </View>
  );
}

function CatalogMaskedTabs({
  mode,
  onSelectedValueActivate,
  onValueChange,
  pullRequestsLabel,
}: {
  readonly mode: CatalogMode;
  readonly onSelectedValueActivate: (value: string) => void;
  readonly onValueChange: (value: string) => void;
  readonly pullRequestsLabel: string;
}): React.JSX.Element {
  const instance = useFreshTabBarKey();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <MaskedTabBar
        fontSize={typeScale.label.fontSize}
        height={catalogModeBarHeight}
        key={instance}
        onSelectedValueActivate={onSelectedValueActivate}
        onValueChange={onValueChange}
        palette={MASKED_TAB_PALETTE}
        radius={99}
        style={styles.bar}
        theme="dark"
        value={mode}
      >
        <CatalogTabList pullRequestsLabel={pullRequestsLabel} />
      </MaskedTabBar>
    </View>
  );
}

function CatalogTabList({
  pullRequestsLabel,
}: {
  readonly pullRequestsLabel: string;
}): React.JSX.Element {
  return (
    <MaskedTabBar.List>
      <VisualTab label="Threads" renderIcon={renderThreadsIcon} value="threads" />
      <VisualTab
        label={pullRequestsLabel}
        renderIcon={renderPullRequestsIcon}
        value="pullRequests"
      />
    </MaskedTabBar.List>
  );
}

function VisualTab({
  label,
  renderIcon,
  value,
}: {
  readonly label: string;
  readonly renderIcon: (state: IMaskedTabIconState) => React.JSX.Element;
  readonly value: CatalogMode;
}): React.JSX.Element {
  return (
    <MaskedTabBar.Trigger style={styles.trigger} value={value}>
      <MaskedTabBar.Icon>{renderIcon}</MaskedTabBar.Icon>
      <MaskedTabBar.Label>{label}</MaskedTabBar.Label>
    </MaskedTabBar.Trigger>
  );
}

function renderThreadsIcon({ active, color, size }: IMaskedTabIconState): React.JSX.Element {
  return (
    <Ionicons color={color} name={active ? "chatbubbles" : "chatbubbles-outline"} size={size} />
  );
}

function renderPullRequestsIcon({ active, color, size }: IMaskedTabIconState): React.JSX.Element {
  return (
    <Ionicons
      color={color}
      name={active ? "git-pull-request" : "git-pull-request-outline"}
      size={size}
    />
  );
}

function AccessibilityTabs({
  mode,
  onSelect,
  pullRequestsLabel,
}: {
  readonly mode: CatalogMode;
  readonly onSelect: (mode: CatalogMode) => void;
  readonly pullRequestsLabel: string;
}): React.JSX.Element {
  return (
    <View pointerEvents="box-none" style={styles.accessibilityTabs}>
      <AccessibleTab
        label="Threads"
        mode="threads"
        onSelect={onSelect}
        selected={mode === "threads"}
      />
      <AccessibleTab
        label={pullRequestsLabel}
        mode="pullRequests"
        onSelect={onSelect}
        selected={mode === "pullRequests"}
      />
    </View>
  );
}

function AccessibleTab({
  label,
  mode,
  onSelect,
  selected,
}: {
  readonly label: string;
  readonly mode: CatalogMode;
  readonly onSelect: (mode: CatalogMode) => void;
  readonly selected: boolean;
}): React.JSX.Element {
  const activate = useEvent(() => {
    onSelect(mode);
  });
  const handleAccessibilityAction = useEvent((event: AccessibilityActionEvent) => {
    if (event.nativeEvent.actionName === "activate") {
      activate();
    }
  });

  return (
    <View
      accessibilityActions={ACTIVATE_ACTIONS}
      accessibilityLabel={label}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      accessible
      onAccessibilityAction={handleAccessibilityAction}
      onAccessibilityTap={activate}
      pointerEvents="none"
      style={styles.accessibilityTab}
      testID={`catalog-mode-${mode}`}
    />
  );
}

/**
 * A key that gives the tab bar a fresh instance whenever the app returns to
 * the foreground or the window changes width (a fold opened or closed). The
 * bar's press gesture keeps its grab and press state on the UI thread and
 * places the pill only while nothing is grabbed; a touch that never finished
 * (the screen went off mid-press) would otherwise leave the pill unplaced at
 * the old screen's geometry and the stale gesture holding later touches.
 */
function useFreshTabBarKey(): string {
  const { width } = useWindowLayout();
  const [foregrounds, setForegrounds] = useState(0);
  const returnToForeground = useEvent((state: string) => {
    if (state === "active") {
      setForegrounds((count) => count + 1);
    }
  });
  // WHY: the app's foreground state is an external system this subscription follows.
  useEffect(() => {
    const subscription = AppState.addEventListener("change", returnToForeground);
    return () => {
      subscription.remove();
    };
  }, [returnToForeground]);
  return `${String(width)}:${String(foregrounds)}`;
}

function parseCatalogMode(value: string): CatalogMode | null {
  if (value === "pullRequests" || value === "threads") {
    return value;
  }
  return null;
}

const styles = StyleSheet.create({
  accessibilityTab: {
    flex: 1,
  },
  accessibilityTabs: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
  },
  bar: {
    backgroundColor: "#171717",
    elevation: FLOATING_BAR_ELEVATION,
  },
  shell: {
    position: "relative",
  },
  trigger: {
    paddingHorizontal: spacing.xxs,
  },
});
