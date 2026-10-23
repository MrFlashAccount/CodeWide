import { Ionicons } from "@expo/vector-icons";
import { type AccessibilityActionEvent, StyleSheet, View } from "react-native";

import { useEvent } from "../../react/useEvent";
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
  reviewRequestedCount,
}: {
  readonly mode: CatalogMode;
  readonly onSelect: (mode: CatalogMode) => void;
  readonly reviewRequestedCount: number;
}): React.JSX.Element {
  const selectMode = useEvent((value: string) => {
    const nextMode = parseCatalogMode(value);
    if (nextMode !== null && nextMode !== mode) {
      onSelect(nextMode);
    }
  });
  const pullRequestsLabel =
    reviewRequestedCount > 0 ? `Pull requests ${String(reviewRequestedCount)}` : "Pull requests";

  return (
    <View accessibilityRole="tablist" style={styles.shell} testID="catalog-mode-bar">
      <CatalogMaskedTabs
        mode={mode}
        onValueChange={selectMode}
        pullRequestsLabel={pullRequestsLabel}
      />
      <AccessibilityTabs mode={mode} onSelect={onSelect} pullRequestsLabel={pullRequestsLabel} />
    </View>
  );
}

function CatalogMaskedTabs({
  mode,
  onValueChange,
  pullRequestsLabel,
}: {
  readonly mode: CatalogMode;
  readonly onValueChange: (value: string) => void;
  readonly pullRequestsLabel: string;
}): React.JSX.Element {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <MaskedTabBar
        fontSize={typeScale.label.fontSize}
        height={catalogModeBarHeight}
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
    if (!selected) {
      onSelect(mode);
    }
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
