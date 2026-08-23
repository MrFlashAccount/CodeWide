import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { type ComponentProps, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { serializeNavigationSpeedscopeProfile } from "../data/navigation-speedscope-profile";
import {
  getThreadNavigationProfileSnapshot,
  subscribeThreadNavigationProfiles,
  type ThreadNavigationProfile,
} from "../data/thread-navigation-metrics";
import {
  captureHermesHeapSnapshot,
  usePerformanceMetrics,
  type HermesHeapSnapshot,
} from "../native/performance-metrics";
import { colors } from "../theme";
import { useAppFullscreenOverlay } from "./AppFullscreenOverlay";
import { SpeedscopeProfileViewer } from "./SpeedscopeProfileViewer";
import { AppText as Text } from "./Typography";

export function NavigationPerformanceHud() {
  const metrics = usePerformanceMetrics();
  const profiles = useSyncExternalStore(
    subscribeThreadNavigationProfiles,
    getThreadNavigationProfileSnapshot,
    getThreadNavigationProfileSnapshot,
  );
  const insets = useSafeAreaInsets();
  const fullscreenOverlay = useAppFullscreenOverlay({ scope: "navigation-performance", lifecycle: null });
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [heapCaptureRunning, setHeapCaptureRunning] = useState(false);
  const [heapSnapshot, setHeapSnapshot] = useState<HermesHeapSnapshot | null>(null);
  const [heapError, setHeapError] = useState<string | null>(null);
  if (!metrics.enabled) return null;

  const current = metrics.current;
  const profile = profiles.active ?? profiles.last;
  const profileText = formatProfile(profile);
  const frameText = current === null
    ? "collecting frames"
    : `${integer(current.renderedFps)} fps · p95 ${decimal(current.p95FrameMs)} ms · ${decimal(current.jankPercent)}% jank · ${bytes(current.pssBytes)}`;
  const copyReport = async () => {
    if (profile === null) return;
    await Clipboard.setStringAsync(serializeNavigationProfile(profile, current));
    setCopied(true);
    setTimeout(() => setCopied(false), 2_000);
  };
  const openViewer = (title: string, fileName: string, content: string) => {
    setMenuOpen(false);
    fullscreenOverlay.present(({ close }) => (
      <SpeedscopeProfileViewer title={title} fileName={fileName} content={content} onClose={close} />
    ), { dismissOnScopeUnmount: false });
  };
  const hermesProfile = profile?.frames?.hermesProfile?.content ?? null;
  const captureHeap = async () => {
    if (heapCaptureRunning) return;
    setHeapCaptureRunning(true);
    setHeapSnapshot(null);
    setHeapError(null);
    try {
      setHeapSnapshot(await captureHermesHeapSnapshot());
    } catch (cause) {
      setHeapError(cause instanceof Error ? cause.message : "Could not capture the Hermes heap");
    }
    setHeapCaptureRunning(false);
  };
  const heapSubtitle = heapCaptureRunning
    ? "Running full GC and writing retained object graph…"
    : heapSnapshot !== null
      ? `Saved ${bytes(heapSnapshot.sizeBytes)} · attach from the chat composer`
      : heapError ?? "Full retained object graph · saves to Downloads/CodeWide";

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open navigation performance tools"
        accessibilityState={{ expanded: menuOpen }}
        onPress={() => setMenuOpen((open) => !open)}
        onLongPress={() => void copyReport()}
        testID="navigation-performance-hud"
        style={[styles.root, { top: insets.top, left: insets.left, right: insets.right }]}
      >
        <View style={[styles.status, profile?.status === "active" ? styles.statusActive : styles.statusReady]} />
        <Text numberOfLines={1} style={styles.text}>{copied ? "Full profile copied" : `${frameText}${profileText === "" ? "" : `  ·  ${profileText}`}`}</Text>
        <Ionicons name={menuOpen ? "chevron-up" : "chevron-down"} size={12} color={colors.textMuted} />
      </Pressable>
      {menuOpen && (
        <View testID="navigation-performance-menu" style={[styles.menu, { top: insets.top + 28, right: insets.right + 8 }]}>
          {profile === null ? (
            <Text style={styles.menuEmpty}>A completed navigation profile has not been captured yet.</Text>
          ) : (
            <>
              <MenuAction
                icon="git-compare-outline"
                title="Navigation timeline"
                subtitle={`${profile.stages.length} stages · ${profile.measures.length} measures · ${profile.visualEvents.length} UI events`}
                onPress={() => openViewer(
                  "Navigation timeline",
                  `${profile.id}.speedscope.json`,
                  serializeNavigationSpeedscopeProfile(profile),
                )}
              />
              {hermesProfile !== null && (
                <MenuAction
                  icon="flame-outline"
                  title="Hermes CPU profile"
                  subtitle={`${bytes(profile.frames?.hermesProfile?.sizeBytes ?? 0)} · sampled stacks`}
                  onPress={() => openViewer("Hermes CPU profile", `${profile.id}.cpuprofile`, hermesProfile)}
                />
              )}
            </>
          )}
          <MenuAction
            icon="layers-outline"
            title="Hermes heap snapshot"
            subtitle={heapSubtitle}
            busy={heapCaptureRunning}
            disabled={heapCaptureRunning}
            onPress={() => void captureHeap()}
          />
          {profile !== null && (
            <MenuAction
              icon="copy-outline"
              title="Copy full JSON"
              subtitle="Stages, measures, frames, and Hermes"
              onPress={() => {
                setMenuOpen(false);
                void copyReport();
              }}
            />
          )}
        </View>
      )}
    </>
  );
}

function MenuAction({ icon, title, subtitle, busy = false, disabled = false, onPress }: {
  icon: ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  busy?: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.menuAction, disabled && styles.menuActionDisabled, pressed && styles.menuActionPressed]}
    >
      {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Ionicons name={icon} size={19} color={colors.textMuted} />}
      <View style={styles.menuActionText}>
        <Text style={styles.menuActionTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.menuActionSubtitle}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

function serializeNavigationProfile(
  profile: ThreadNavigationProfile,
  current: ReturnType<typeof usePerformanceMetrics>["current"],
): string {
  const hermes = profile.frames?.hermesProfile ?? null;
  let samplingProfile: unknown = null;
  if (hermes?.content !== null && hermes?.content !== undefined) {
    try {
      samplingProfile = JSON.parse(hermes.content) as unknown;
    } catch {
      samplingProfile = hermes.content;
    }
  }
  return JSON.stringify({
    version: 2,
    kind: "codewide-navigation-profile",
    collectedAt: new Date().toISOString(),
    app: {
      version: Constants.expoConfig?.version ?? null,
      runtimeVersion: Updates.runtimeVersion ?? null,
      updateId: Updates.updateId ?? null,
    },
    navigation: {
      ...profile,
      frames: profile.frames === null ? null : {
        ...profile.frames,
        hermesProfile: hermes === null ? null : {
          format: hermes.format,
          sizeBytes: hermes.sizeBytes,
          error: hermes.error,
          included: samplingProfile !== null,
        },
      },
    },
    nativeSample: current,
    hermesSamplingProfile: samplingProfile,
  }, null, 2);
}

function formatProfile(profile: ThreadNavigationProfile | null): string {
  if (profile === null) return "chat profile waiting";
  const prefix = profile.status === "active" ? "chat profiling" : `chat ${integer(profile.totalMs)} ms`;
  const stage = profile.bottleneckStage === null
    ? profile.currentStage
    : `${shortStage(profile.bottleneckStage)} ${integer(profile.bottleneckMs)} ms`;
  const rows = `${profile.uniqueRowsCommitted} rows/${profile.rowCommits} commits`;
  const slowest = profile.measures.reduce<(typeof profile.measures)[number] | null>((current, measure) => (
    current === null || measure.durationMs > current.durationMs ? measure : current
  ), null);
  const hotPath = slowest === null ? "" : ` · hot ${slowest.name} ${integer(slowest.durationMs)} ms`;
  const frames = profile.frames === null
    ? ""
    : ` · ${profile.frames.jankFrames} jank/${profile.frames.droppedFrameEstimate} missed`;
  return `${prefix} · ${stage} · ${rows}${hotPath}${frames}`;
}

function shortStage(stage: ThreadNavigationProfile["currentStage"]): string {
  if (stage === "hydration_result") return "hydrate";
  if (stage === "timeline_model_ready") return "model";
  if (stage === "timeline_first_draw") return "draw";
  if (stage === "timeline_positioned") return "position";
  if (stage === "visible_commit") return "commit";
  if (stage === "selection_next_frame") return "select frame";
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
  menu: {
    position: "absolute",
    zIndex: 20_001,
    elevation: 21,
    width: 280,
    overflow: "hidden",
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  menuAction: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  menuActionPressed: { backgroundColor: colors.surfaceHover },
  menuActionDisabled: { opacity: 0.68 },
  menuActionText: { flex: 1, minWidth: 0 },
  menuActionTitle: { color: colors.text, fontSize: 13, lineHeight: 18, fontWeight: "500" },
  menuActionSubtitle: { color: colors.textMuted, fontSize: 10, lineHeight: 14 },
  menuEmpty: { color: colors.textMuted, fontSize: 12, lineHeight: 17, padding: 14 },
});
