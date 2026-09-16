import { appLogger } from "../observability/logger";
import { spacing, typeScale, typeWeight, radii, controlSize, layoutSize } from "../theme";
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
import { errorDiagnostic } from "./error-diagnostic";
import { copyCrashReport, reloadPublishedApp } from "./crashRecovery";

type Props = {
  children: ReactNode;
};

type State = {
  componentStack: string;
  error: Error | null;
};

function normalizeError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === "string") {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error("Unknown React render error");
  }
}

function errorReport(error: Error, componentStack: string): string {
  return [
    errorDiagnostic("UI failure", error),
    componentStack.length > 0
      ? `React component stack:${componentStack}`
      : "No React component stack available",
  ].join("\n\n");
}

/** Catches failures at the application shell and exposes a recoverable error surface. */
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
    appLogger.error({
      err: error,
      event: "render.root.failed",
      fields: { componentStack: info.componentStack ?? "" },
    });
    // WHY: React exposes the component stack only through componentDidCatch, after derived state.
    // oxlint-disable-next-line react/no-set-state
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  private readonly retry = (): void => {
    // WHY: a class error boundary must clear its captured error to retry the owned subtree.
    // oxlint-disable-next-line react/no-set-state
    this.setState({ componentStack: "", error: null });
  };

  override render(): ReactNode {
    const { componentStack, error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    return <RootFailure componentStack={componentStack} error={error} onRetry={this.retry} />;
  }
}

export function GlobalErrorBoundaryHost({ children }: Props): ReactNode {
  const failure = useSyncExternalStore(
    subscribeGlobalError,
    getGlobalErrorSnapshot,
    getGlobalErrorSnapshot,
  );

  if (failure === null) {
    return children;
  }

  const context = [
    `Global JavaScript failure (${failure.source})`,
    `Fatal: ${String(failure.isFatal)}`,
    `Occurred at: ${new Date(failure.occurredAt).toISOString()}`,
  ].join("\n");

  return <RootFailure componentStack={context} error={failure.error} onRetry={clearGlobalError} />;
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
    if (copying) {
      return;
    }
    setCopying(true);
    try {
      await copyCrashReport(report);
    } catch (copyError) {
      appLogger.warnCaught({ error: copyError, event: "render.crash_report_copy.failed" });
    }
    setCopying(false);
  };

  const restart = async () => {
    if (restarting) {
      return;
    }
    setRestarting(true);
    if (__DEV__) {
      DevSettings.reload();
      return;
    }
    try {
      if (await reloadPublishedApp()) {
        return;
      }
    } catch (reloadError) {
      appLogger.errorCaught({ error: reloadError, event: "render.crash_reload.failed" });
    }
    DevSettings.reload();
  };

  return (
    <View style={styles.root} testID="root-error-boundary">
      <View style={styles.badge}>
        <Text style={styles.badgeText}>!</Text>
      </View>
      <Text style={styles.title}>Interface crashed</Text>
      <Text style={styles.message}>
        {error.message === "" ? "Unknown React render error" : error.message}
      </Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.primaryButton}>
          <Text style={styles.primaryLabel}>Try again</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={restarting}
          onPress={() => void restart()}
          style={styles.secondaryButton}
        >
          {restarting ? (
            <ActivityIndicator color="#f4f4f5" size="small" />
          ) : (
            <Text style={styles.secondaryLabel}>Restart UI</Text>
          )}
        </Pressable>
      </View>
      <Pressable
        accessibilityRole="button"
        disabled={copying}
        onPress={() => void copy()}
        style={styles.copyButton}
      >
        <Text style={styles.copyLabel}>{copying ? "Copying…" : "Copy error details"}</Text>
      </Pressable>
      <ScrollView contentContainerStyle={styles.detailsContent} style={styles.details}>
        <Text selectable style={styles.detailsText}>
          {report}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    gap: spacing.inputInset,
    marginTop: spacing.lg,
  },
  badge: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#3b2024",
    borderRadius: radii.selected,
    justifyContent: "center",
    marginBottom: spacing.md,
    minHeight: controlSize.regular,
    paddingVertical: spacing.compact,
    width: 36,
  },
  badgeText: {
    color: "#ff8a96",
    ...typeScale.heading,
    fontWeight: typeWeight.semibold,
  },
  copyButton: {
    alignSelf: "flex-start",
    justifyContent: "center",
    marginTop: spacing.xxs,
    minHeight: controlSize.touch,
  },
  copyLabel: {
    color: "#8bb8ff",
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  details: {
    backgroundColor: "#19191b",
    borderRadius: radii.medium,
    flexGrow: 0,
    marginTop: spacing.xs,
    maxHeight: 220,
  },
  detailsContent: { padding: spacing.md },
  detailsText: {
    color: "#8f8f96",
    ...typeScale.code,
    fontFamily: "monospace",
  },
  message: {
    color: "#b7b7bc",
    ...typeScale.body,
    marginTop: spacing.xs,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: "#f4f4f5",
    borderRadius: radii.selected,
    flex: 1,
    justifyContent: "center",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.md,
  },
  primaryLabel: {
    color: "#111113",
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  root: {
    alignItems: "stretch",
    backgroundColor: "#101011",
    flex: 1,
    justifyContent: "center",
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: layoutSize.header,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: "#27272a",
    borderRadius: radii.selected,
    flex: 1,
    justifyContent: "center",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.md,
  },
  secondaryLabel: {
    color: "#f4f4f5",
    ...typeScale.body,
    fontWeight: typeWeight.semibold,
  },
  title: {
    color: "#f4f4f5",
    ...typeScale.heading,
    fontWeight: typeWeight.semibold,
  },
});
