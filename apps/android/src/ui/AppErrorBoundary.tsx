import { Component, type ErrorInfo, type ReactNode, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  DevSettings,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  clearGlobalError,
  getGlobalErrorSnapshot,
  subscribeGlobalError,
} from "./global-error-store";

type Props = {
  children: ReactNode;
};

type State = {
  componentStack: string;
  error: Error | null;
};

function normalizeError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error("Unknown React render error");
  }
}

function errorReport(error: Error, componentStack: string): string {
  return [
    `CodeWide UI failure: ${error.message}`,
    error.stack ?? "No JavaScript stack available",
    componentStack.length > 0 ? `React component stack:${componentStack}` : "No React component stack available",
  ].join("\n\n");
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = {
    componentStack: "",
    error: null,
  };

  static getDerivedStateFromError(value: unknown): Partial<State> {
    return { error: normalizeError(value) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the complete stack in logcat/Metro and in the local recovery UI.
    // The boundary deliberately has no dependency on application databases:
    // a broken persistence layer must not be able to break crash recovery.
    console.error("CodeWide root render failed", error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  private retry = (): void => {
    this.setState({ componentStack: "", error: null });
  };

  override render(): ReactNode {
    const { error, componentStack } = this.state;
    if (error === null) return this.props.children;
    return <RootFailure error={error} componentStack={componentStack} onRetry={this.retry} />;
  }
}

export function GlobalErrorBoundaryHost({ children }: Props) {
  const failure = useSyncExternalStore(
    subscribeGlobalError,
    getGlobalErrorSnapshot,
    getGlobalErrorSnapshot,
  );

  if (failure === null) return children;

  const context = [
    `Global JavaScript failure (${failure.source})`,
    `Fatal: ${String(failure.isFatal)}`,
    `Occurred at: ${new Date(failure.occurredAt).toISOString()}`,
  ].join("\n");

  return (
    <RootFailure
      componentStack={context}
      error={failure.error}
      onRetry={clearGlobalError}
    />
  );
}

export function RootFailure({
  componentStack,
  error,
  onRetry,
}: {
  componentStack: string;
  error: Error;
  onRetry: () => void;
}) {
  const [copying, setCopying] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const report = errorReport(error, componentStack);

  const copy = async () => {
    if (copying) return;
    setCopying(true);
    try {
      const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
      await Clipboard.setStringAsync(report);
    } catch (copyError) {
      console.error("Could not copy the UI crash report", copyError);
    }
    setCopying(false);
  };

  const restart = async () => {
    if (restarting) return;
    setRestarting(true);
    if (__DEV__) {
      DevSettings.reload();
      return;
    }
    try {
      const Updates = require("expo-updates") as typeof import("expo-updates");
      if (Updates.isEnabled) {
        await Updates.reloadAsync();
        return;
      }
    } catch (reloadError) {
      console.error("Expo update reload failed after a UI crash", reloadError);
    }
    DevSettings.reload();
  };

  return (
    <View style={styles.root} testID="root-error-boundary">
      <View style={styles.badge}><Text style={styles.badgeText}>!</Text></View>
      <Text style={styles.title}>Interface crashed</Text>
      <Text style={styles.message}>{error.message || "Unknown React render error"}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.primaryButton}>
          <Text style={styles.primaryLabel}>Try again</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={restarting} onPress={() => void restart()} style={styles.secondaryButton}>
          {restarting ? <ActivityIndicator color="#f4f4f5" size="small" /> : <Text style={styles.secondaryLabel}>Restart UI</Text>}
        </Pressable>
      </View>
      <Pressable accessibilityRole="button" disabled={copying} onPress={() => void copy()} style={styles.copyButton}>
        <Text style={styles.copyLabel}>{copying ? "Copying…" : "Copy error details"}</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.detailsContent} style={styles.details}>
        <Text selectable style={styles.detailsText}>{report}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: "stretch",
    backgroundColor: "#101011",
    flex: 1,
    justifyContent: "center",
    paddingBottom: 32,
    paddingHorizontal: 24,
    paddingTop: 56,
  },
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#3b2024",
    borderRadius: 18,
    minHeight: 36,
    paddingVertical: 6,
    justifyContent: "center",
    marginBottom: 18,
    width: 36,
  },
  badgeText: { color: "#ff8a96", fontSize: 20, fontWeight: "700" },
  title: { color: "#f4f4f5", fontSize: 24, fontWeight: "700", lineHeight: 30 },
  message: { color: "#b7b7bc", fontSize: 15, lineHeight: 21, marginTop: 8 },
  actions: { flexDirection: "row", gap: 10, marginTop: 24 },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#f4f4f5",
    borderRadius: 18,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
  },
  primaryLabel: { color: "#111113", fontSize: 15, fontWeight: "700" },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#27272a",
    borderRadius: 18,
    flex: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
  },
  secondaryLabel: { color: "#f4f4f5", fontSize: 15, fontWeight: "700" },
  copyButton: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", marginTop: 4 },
  copyLabel: { color: "#8bb8ff", fontSize: 14, fontWeight: "600" },
  details: { backgroundColor: "#19191b", borderRadius: 16, flexGrow: 0, marginTop: 8, maxHeight: 220 },
  detailsContent: { padding: 14 },
  detailsText: { color: "#8f8f96", fontFamily: "monospace", fontSize: 11, lineHeight: 16 },
});
