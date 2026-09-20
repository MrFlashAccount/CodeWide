import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as Updates from "expo-updates";
import { type ComponentProps, useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { serializeNavigationSpeedscopeProfile } from "../data/navigation-speedscope-profile";
import {
  armNextThreadNavigationProfile,
  getThreadNavigationProfileSnapshot,
  subscribeThreadNavigationProfiles,
  type ThreadNavigationProfile,
} from "../data/thread-navigation-metrics";
import {
  armNextNavigationHermesProfile,
  captureHermesHeapSnapshot,
  saveNavigationProfile,
  usePerformanceMetrics,
  type HermesHeapSnapshot,
  type SavedNavigationProfile,
} from "../native/performance-metrics";
import { useEvent } from "../react/useEvent";
import {
  colors,
  spacing,
  typeScale,
  typeWeight,
  iconSize,
  radii,
  layoutSize,
  controlSize,
} from "../theme";
import { useAppFullscreenOverlay } from "./AppFullscreenOverlay";
import { useAppDialog } from "./AppDialog";
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
  const fullscreenOverlay = useAppFullscreenOverlay({
    lifecycle: null,
    scope: "navigation-performance",
  });
  const dialog = useAppDialog();
  const profileExportRunning = useRef(false);
  const [profileExport, setProfileExport] = useState<ProfileExportState>({ status: "idle" });
  const [menuOpen, setMenuOpen] = useState(false);
  const [heapCaptureRunning, setHeapCaptureRunning] = useState(false);
  const [heapSnapshot, setHeapSnapshot] = useState<HermesHeapSnapshot | null>(null);
  const [heapError, setHeapError] = useState<string | null>(null);
  const current = metrics.current;
  const profile = profiles.active ?? profiles.last;
  const frameText =
    current === null
      ? "collecting frames"
      : `${integer(current.renderedFps)} fps · CPU ${decimal(current.cpuPercent)}% · RSS ${bytes(current.rssBytes)}`;
  const saveReport = useEvent(async () => {
    if (profile === null) {
      return;
    }
    if (profileExportRunning.current) {
      return;
    }
    profileExportRunning.current = true;
    setProfileExport({ status: "saving" });
    try {
      const saved = await saveNavigationProfile(serializeNavigationProfile(profile, current));
      setProfileExport({ artifact: saved, status: "saved" });
      setTimeout(() => {
        setProfileExport({ status: "idle" });
      }, 2000);
      profileExportRunning.current = false;
    } catch (error) {
      setProfileExport({ status: "idle" });
      profileExportRunning.current = false;
      throw error;
    }
  });
  const requestSaveReport = useEvent(() => {
    setMenuOpen(false);
    void saveReport().catch((error: unknown) => {
      dialog.alert(
        "Save failed",
        error instanceof Error ? error.message : "Could not save navigation profile",
      );
    });
  });
  const requestHermesProfile = useEvent(() => {
    setMenuOpen(false);
    void armNextNavigationHermesProfile()
      .then(() => {
        armNextThreadNavigationProfile();
      })
      .catch((error: unknown) => {
        dialog.alert(
          "Profiler unavailable",
          error instanceof Error ? error.message : "Could not arm the navigation profiler",
        );
      });
  });
  if (!metrics.enabled) {
    return null;
  }
  const openViewer = (title: string, fileName: string, content: string) => {
    setMenuOpen(false);
    fullscreenOverlay.present(
      ({ close }) => (
        <SpeedscopeProfileViewer
          content={content}
          fileName={fileName}
          onClose={close}
          title={title}
        />
      ),
      { dismissOnScopeUnmount: false },
    );
  };
  const hermesProfile = profile?.frames?.hermesProfile?.content ?? null;
  const captureHeap = async () => {
    if (heapCaptureRunning) {
      return;
    }
    setHeapCaptureRunning(true);
    setHeapSnapshot(null);
    setHeapError(null);
    try {
      setHeapSnapshot(await captureHermesHeapSnapshot());
    } catch (error) {
      setHeapError(error instanceof Error ? error.message : "Could not capture the Hermes heap");
    }
    setHeapCaptureRunning(false);
  };
  const heapSubtitle = heapCaptureRunning
    ? "Running full GC and writing retained object graph…"
    : heapSnapshot !== null
      ? `Saved ${bytes(heapSnapshot.sizeBytes)} · attach from the chat composer`
      : (heapError ?? "Full retained object graph · saves to Downloads/CodeWide");

  return (
    <>
      <Pressable
        accessibilityLabel="Open navigation performance tools"
        accessibilityRole="button"
        accessibilityState={{ expanded: menuOpen }}
        onLongPress={requestSaveReport}
        onPress={() => {
          setMenuOpen((open) => !open);
        }}
        style={[styles.root, { left: insets.left, right: insets.right, top: insets.top }]}
        testID="navigation-performance-hud"
      >
        <View
          style={[
            styles.status,
            profile?.status === "active" ? styles.statusActive : styles.statusReady,
          ]}
        />
        <Text numberOfLines={1} style={styles.text}>
          {profileExport.status === "saved"
            ? `Full profile saved · ${profileExport.artifact.location}`
            : frameText}
        </Text>
        <Ionicons
          color={colors.textMuted}
          name={menuOpen ? "chevron-up" : "chevron-down"}
          size={iconSize.indicator}
        />
      </Pressable>
      {menuOpen && (
        <View
          style={[styles.menu, { right: insets.right + 8, top: insets.top + 28 }]}
          testID="navigation-performance-menu"
        >
          {profile === null ? (
            <Text style={styles.menuEmpty}>
              A completed navigation profile has not been captured yet.
            </Text>
          ) : (
            <>
              <MenuAction
                icon="git-compare-outline"
                onPress={() => {
                  openViewer(
                    "Navigation timeline",
                    `${profile.id}.speedscope.json`,
                    serializeNavigationSpeedscopeProfile(profile),
                  );
                }}
                subtitle={`${String(profile.stages.length)} stages · ${String(profile.measures.length)} measures · ${String(profile.visualEvents.length)} UI events`}
                title="Navigation timeline"
              />
              {hermesProfile !== null && (
                <MenuAction
                  icon="flame-outline"
                  onPress={() => {
                    openViewer("Hermes CPU profile", `${profile.id}.cpuprofile`, hermesProfile);
                  }}
                  subtitle={`${bytes(profile.frames?.hermesProfile?.sizeBytes ?? 0)} · sampled stacks`}
                  title="Hermes CPU profile"
                />
              )}
            </>
          )}
          <MenuAction
            icon="flame-outline"
            onPress={requestHermesProfile}
            subtitle="Samples JavaScript only during the next chat switch"
            title="Profile next navigation"
          />
          <MenuAction
            busy={heapCaptureRunning}
            disabled={heapCaptureRunning}
            icon="layers-outline"
            onPress={() => void captureHeap()}
            subtitle={heapSubtitle}
            title="Hermes heap snapshot"
          />
          {profile !== null && (
            <MenuAction
              busy={profileExport.status === "saving"}
              disabled={profileExport.status === "saving"}
              icon="download-outline"
              onPress={requestSaveReport}
              subtitle="Full JSON · Downloads/CodeWide"
              title="Save full JSON"
            />
          )}
        </View>
      )}
    </>
  );
}

type ProfileExportState =
  | { status: "idle" }
  | { status: "saving" }
  | { artifact: SavedNavigationProfile; status: "saved" };

function MenuAction({
  busy = false,
  disabled = false,
  icon,
  onPress,
  subtitle,
  title,
}: {
  busy?: boolean;
  disabled?: boolean;
  icon: ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  subtitle: string;
  title: string;
}) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      accessibilityState={{ busy, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuAction,
        disabled && styles.menuActionDisabled,
        pressed && styles.menuActionPressed,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.textMuted} size="small" />
      ) : (
        <Ionicons color={colors.textMuted} name={icon} size={iconSize.action} />
      )}
      <View style={styles.menuActionText}>
        <Text style={styles.menuActionTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.menuActionSubtitle}>
          {subtitle}
        </Text>
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
      samplingProfile = JSON.parse(hermes.content);
    } catch {
      samplingProfile = hermes.content;
    }
  }
  return JSON.stringify(
    {
      app: {
        runtimeVersion: Updates.runtimeVersion ?? null,
        updateId: Updates.updateId ?? null,
        version: Constants.expoConfig?.version ?? null,
      },
      collectedAt: new Date().toISOString(),
      hermesSamplingProfile: samplingProfile,
      kind: "codewide-navigation-profile",
      nativeSample: current,
      navigation: {
        ...profile,
        frames:
          profile.frames === null
            ? null
            : {
                ...profile.frames,
                hermesProfile:
                  hermes === null
                    ? null
                    : {
                        error: hermes.error,
                        format: hermes.format,
                        included: samplingProfile !== null,
                        sizeBytes: hermes.sizeBytes,
                      },
              },
      },
      version: 2,
    },
    null,
    2,
  );
}

function integer(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function decimal(value: number): string {
  return value.toFixed(value >= 100 ? 0 : 1);
}

function bytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return "n/a";
  }
  return `${decimal(value / (1024 * 1024))} MB`;
}

const styles = StyleSheet.create({
  menu: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 21,
    overflow: "hidden",
    position: "absolute",
    width: 280,
    zIndex: 20_001,
  },
  menuAction: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.inputInset,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  menuActionDisabled: { opacity: 0.68 },
  menuActionPressed: { backgroundColor: colors.surfaceHover },
  menuActionSubtitle: {
    color: colors.textMuted,
    ...typeScale.caption,
  },
  menuActionText: {
    flex: 1,
    minWidth: 0,
  },
  menuActionTitle: {
    color: colors.text,
    ...typeScale.body,
    fontWeight: typeWeight.medium,
  },
  menuEmpty: {
    color: colors.textMuted,
    ...typeScale.label,
    padding: spacing.md,
  },
  root: {
    alignItems: "center",
    backgroundColor: "rgba(10, 10, 10, 0.92)",
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    elevation: 20,
    flexDirection: "row",
    gap: spacing.xs,
    height: layoutSize.metadataRow,
    paddingHorizontal: spacing.inputInset,
    position: "absolute",
    zIndex: 20_000,
  },
  status: {
    borderRadius: radii.pill,
    flexShrink: 0,
    height: 6,
    width: 6,
  },
  statusActive: { backgroundColor: colors.amber },
  statusReady: { backgroundColor: colors.green },
  text: {
    color: colors.textMuted,
    ...typeScale.caption,
    flexShrink: 1,
  },
});
