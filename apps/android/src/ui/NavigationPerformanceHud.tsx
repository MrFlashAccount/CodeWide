import { useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  getThreadNavigationProfileSnapshot,
  subscribeThreadNavigationProfiles,
  type ThreadNavigationProfile,
} from "../data/thread-navigation-metrics";
import { usePerformanceMetrics } from "../native/performance-metrics";
import { colors } from "../theme";
import { AppText as Text } from "./Typography";

export function NavigationPerformanceHud() {
  const metrics = usePerformanceMetrics();
  const profiles = useSyncExternalStore(
    subscribeThreadNavigationProfiles,
    getThreadNavigationProfileSnapshot,
    getThreadNavigationProfileSnapshot,
  );
  const insets = useSafeAreaInsets();
  if (!metrics.enabled) return null;

  const current = metrics.current;
  const profile = profiles.active ?? profiles.last;
  const profileText = formatProfile(profile);
  const frameText = current === null
    ? "collecting frames"
    : `${integer(current.renderedFps)} fps · p95 ${decimal(current.p95FrameMs)} ms · ${decimal(current.jankPercent)}% jank · ${bytes(current.pssBytes)}`;

  return (
    <View
      pointerEvents="none"
      testID="navigation-performance-hud"
      style={[styles.root, { top: insets.top, left: insets.left, right: insets.right }]}
    >
      <View style={[styles.status, profile?.status === "active" ? styles.statusActive : styles.statusReady]} />
      <Text numberOfLines={1} style={styles.text}>{frameText}{profileText === "" ? "" : `  ·  ${profileText}`}</Text>
    </View>
  );
}

function formatProfile(profile: ThreadNavigationProfile | null): string {
  if (profile === null) return "chat profile waiting";
  const prefix = profile.status === "active" ? "chat profiling" : `chat ${integer(profile.totalMs)} ms`;
  const stage = profile.bottleneckStage === null
    ? profile.currentStage
    : `${shortStage(profile.bottleneckStage)} ${integer(profile.bottleneckMs)} ms`;
  const rows = `${profile.uniqueRowsCommitted} rows/${profile.rowCommits} commits`;
  const frames = profile.frames === null
    ? ""
    : ` · ${profile.frames.jankFrames} jank/${profile.frames.droppedFrameEstimate} missed`;
  return `${prefix} · ${stage} · ${rows}${frames}`;
}

function shortStage(stage: ThreadNavigationProfile["currentStage"]): string {
  if (stage === "hydration_result") return "hydrate";
  if (stage === "timeline_model_ready") return "model";
  if (stage === "timeline_first_draw") return "draw";
  if (stage === "timeline_positioned") return "position";
  if (stage === "visible_commit") return "commit";
  if (stage === "selection_commit") return "select";
  if (stage === "scope_commit") return "scope";
  if (stage === "next_frame") return "frame";
  return stage.replaceAll("_", " ");
}

function integer(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function decimal(value: number): string {
  return value.toFixed(value >= 100 ? 0 : 1);
}

function bytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "n/a";
  return `${decimal(value / (1024 * 1024))} MB`;
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    zIndex: 20_000,
    elevation: 20,
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    backgroundColor: "rgba(10, 10, 10, 0.92)",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  status: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  statusActive: { backgroundColor: colors.amber },
  statusReady: { backgroundColor: colors.green },
  text: { color: colors.textMuted, fontSize: 10, lineHeight: 13, flexShrink: 1 },
});
