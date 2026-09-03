import { StyleSheet, View } from "react-native";

import { colors, spacing, touchTarget, typeScale } from "../../theme";
import { AsyncActionFeedbackView } from "../actions/AsyncActionFeedbackView";
import { ProductText as Text } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";
import { BrowserToolbarButton as BrowserButton } from "./BrowserToolbarButton";
import { useBrowserToolbarActions } from "./useBrowserToolbarActions";
interface BrowserToolbarProps {
  canGoBack: boolean;
  canGoForward: boolean;
  closeDevTools(): void;
  devToolsLoading: boolean;
  devToolsOpen: boolean;
  goBack(): void;
  goForward(): void;
  location: string;
  onClose(): void | Promise<void>;
  openDevTools(): Promise<void>;
  reload(): void;
  status: string;
  title: string;
  toggleTrace(): Promise<void>;
  traceRunning: boolean;
  traceStatus: string | null;
  traceSupported: boolean;
}

export function BrowserToolbar(props: BrowserToolbarProps): React.JSX.Element {
  const {
    canGoBack,
    canGoForward,
    closeDevTools,
    devToolsLoading,
    devToolsOpen,
    goBack,
    goForward,
    location,
    onClose,
    openDevTools,
    reload,
    status,
    title,
    toggleTrace,
    traceRunning,
    traceStatus,
    traceSupported,
  } = props;
  const { close, closeAction, devToolsAction, inspect, trace, traceAction } =
    useBrowserToolbarActions({ onClose, openDevTools, toggleTrace, traceRunning });
  return (
    <>
      <View style={styles.toolbar}>
        <BrowserButton
          disabled={closeAction.pending}
          icon="close"
          label="Close browser"
          onPress={close}
          pending={closeAction.pending}
        />
        <BrowserButton disabled={!canGoBack} icon="chevron-back" label="Back" onPress={goBack} />
        <BrowserButton
          disabled={!canGoForward}
          icon="chevron-forward"
          label="Forward"
          onPress={goForward}
        />
        <BrowserButton icon="refresh" label="Reload" onPress={reload} />
        <View style={styles.location}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            <View style={styles.status}>
              <Text style={styles.statusText}>{status}</Text>
            </View>
          </View>
          <Text ellipsizeMode="middle" numberOfLines={1} style={styles.locationText}>
            {browserLocation(location)}
          </Text>
        </View>
        {!devToolsOpen || !traceSupported ? null : (
          <BrowserButton
            icon={traceRunning ? "stop-circle" : "pulse"}
            label={traceRunning ? "Stop browser trace" : "Start browser trace"}
            disabled={traceAction.pending}
            onPress={trace}
            pending={traceAction.pending}
            selected={traceRunning}
          />
        )}
        <BrowserButton
          disabled={devToolsLoading || devToolsAction.pending}
          icon={devToolsOpen ? "close-circle" : "code-slash"}
          label={devToolsOpen ? "Close Chromium DevTools" : "Open Chromium DevTools"}
          onPress={devToolsOpen ? closeDevTools : inspect}
          pending={!devToolsOpen && devToolsAction.pending}
          selected={devToolsOpen}
        />
      </View>
      {closeAction.pending || closeAction.error !== null ? (
        <AsyncActionFeedbackView
          error={closeAction.error}
          onRetry={closeAction.retry}
          pending={closeAction.pending}
          pendingLabel={closeAction.pendingLabel}
          style={styles.traceStatus}
        />
      ) : devToolsAction.pending || devToolsAction.error !== null ? (
        <AsyncActionFeedbackView
          error={devToolsAction.error}
          onRetry={devToolsAction.retry}
          pending={devToolsAction.pending}
          pendingLabel={devToolsAction.pendingLabel}
          style={styles.traceStatus}
        />
      ) : traceAction.pending || traceAction.error !== null ? (
        <AsyncActionFeedbackView
          error={traceAction.error}
          onRetry={traceAction.retry}
          pending={traceAction.pending}
          pendingLabel={traceAction.pendingLabel}
          style={styles.traceStatus}
        />
      ) : devToolsLoading ? (
        <ShimmerText containerStyle={styles.traceStatus} text="Opening Chromium DevTools…" />
      ) : traceStatus === null ? null : (
        <Text numberOfLines={1} style={styles.traceStatus}>
          {traceStatus}
        </Text>
      )}
    </>
  );
}

function browserLocation(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return value;
  }
}

const styles = StyleSheet.create({
  location: { flex: 1, minWidth: 0, paddingHorizontal: spacing.xs },
  locationText: { color: colors.textMuted, ...typeScale.caption },
  status: {
    backgroundColor: colors.successContainer,
    borderRadius: 999,
    flexShrink: 0,
    paddingHorizontal: spacing.xs,
  },
  statusText: { color: colors.green, ...typeScale.caption },
  title: { color: colors.text, ...typeScale.label, flexShrink: 1 },
  titleRow: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  toolbar: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    minHeight: touchTarget,
  },
  traceStatus: {
    backgroundColor: colors.surface,
    color: colors.textMuted,
    minHeight: 22,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.optical,
    ...typeScale.caption,
  },
});
