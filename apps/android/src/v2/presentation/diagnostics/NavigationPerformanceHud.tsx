import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useEvent } from "../../../react/useEvent";
import { navigationHudSummary } from "../../features/diagnostics/navigationProfile";
import type { NavigationProfile } from "../../features/diagnostics/diagnosticsTypes";
import { colors, radii, spacing, touchTarget, typeScale } from "../../theme";
import { PresentationIcon, type PresentationIconName } from "../icons/PresentationIcon";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

export interface NavigationPerformanceHudProps {
  frameSummary: string;
  heapBusy: boolean;
  heapMessage: string;
  onCaptureHeap(): void;
  onCopy(): void;
  onOpenHermes(): void;
  onOpenTimeline(): void;
  profile: NavigationProfile | null;
}

interface HudActionProps {
  busy?: boolean;
  icon: PresentationIconName;
  label: string;
  onPress(): void;
  subtitle: string;
}

const HUD_LAYER = 20_000;
const HUD_MENU_LAYER = HUD_LAYER + 1;
const HUD_MENU_WIDTH = 280;

export function NavigationPerformanceHud(props: NavigationPerformanceHudProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const profileSummary = navigationHudSummary(props.profile);
  const toggle = useEvent(() => setOpen((current) => !current));
  return (
    <>
      <Pressable
        accessibilityLabel="Open navigation performance tools"
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onLongPress={props.onCopy}
        onPress={toggle}
        style={[styles.root, { left: insets.left, right: insets.right, top: insets.top }]}
        testID="navigation-performance-hud"
      >
        <View
          style={[styles.status, props.profile?.status === "active" ? styles.active : styles.ready]}
        />
        <ProductText numberOfLines={1} style={styles.summary} tone="muted">
          {props.frameSummary} · {profileSummary}
        </ProductText>
        <PresentationIcon
          color={colors.textMuted}
          name={open ? "chevronUp" : "chevronDown"}
          size={typeScale.label.fontSize}
        />
      </Pressable>
      {open ? (
        <View
          style={[styles.menu, { right: insets.right + spacing.xs, top: insets.top + touchTarget }]}
          testID="navigation-performance-menu"
        >
          {props.profile === null ? (
            <ProductText style={styles.empty} tone="muted">
              A completed navigation profile has not been captured yet.
            </ProductText>
          ) : (
            <>
              <HudAction
                icon="list"
                label="Navigation timeline"
                onPress={props.onOpenTimeline}
                subtitle={`${String(props.profile.stages.length)} stages · ${String(props.profile.measures.length)} measures`}
              />
              {props.profile.frames?.hermesProfile?.content === null ||
              props.profile.frames?.hermesProfile?.content === undefined ? null : (
                <HudAction
                  icon="flash"
                  label="Hermes CPU profile"
                  onPress={props.onOpenHermes}
                  subtitle="Sampled JavaScript stacks"
                />
              )}
              <HudAction
                icon="create"
                label="Copy full JSON"
                onPress={props.onCopy}
                subtitle="Stages, measures, frames, and Hermes"
              />
            </>
          )}
          <HudAction
            busy={props.heapBusy}
            icon="layers"
            label="Hermes heap snapshot"
            onPress={props.onCaptureHeap}
            subtitle={props.heapMessage}
          />
        </View>
      ) : null}
    </>
  );
}

function HudAction(props: HudActionProps): React.JSX.Element {
  return (
    <Pressable
      accessibilityLabel={props.label}
      accessibilityRole="button"
      accessibilityState={{ busy: props.busy ?? false, disabled: props.busy ?? false }}
      disabled={props.busy}
      onPress={props.onPress}
      style={styles.action}
    >
      <PresentationIcon
        color={colors.textMuted}
        name={props.icon}
        size={typeScale.title.fontSize}
      />
      <View style={styles.actionCopy}>
        {props.busy === true ? (
          <ShimmerText text={props.label} />
        ) : (
          <ProductText weight="semibold">{props.label}</ProductText>
        )}
        <ProductText numberOfLines={1} style={styles.subtitle} tone="muted">
          {props.subtitle}
        </ProductText>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  actionCopy: { flex: 1, minWidth: 0 },
  active: { backgroundColor: colors.amber },
  empty: { padding: spacing.sm },
  menu: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.small,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    position: "absolute",
    width: HUD_MENU_WIDTH,
    zIndex: HUD_MENU_LAYER,
  },
  ready: { backgroundColor: colors.green },
  root: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    height: spacing.lg,
    paddingHorizontal: spacing.sm,
    position: "absolute",
    zIndex: HUD_LAYER,
  },
  status: { borderRadius: radii.pill, flexShrink: 0, height: spacing.xxs, width: spacing.xxs },
  subtitle: { ...typeScale.caption },
  summary: { flexShrink: 1, ...typeScale.caption },
});
