import { Component, type ErrorInfo, type ReactNode, useState } from "react";
import { setStringAsync } from "expo-clipboard";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { appLogger } from "../observability/logger";
import { colors, radii, spacing, typeScale, controlSize } from "../theme";
import { AppText as Text } from "./Typography";

export type DevToolsFailureKind = "react" | "renderer" | "load" | "health" | "bridge";

export type DevToolsFailure = {
  componentStack?: string;
  context?: string;
  kind: DevToolsFailureKind;
  message: string;
  occurredAt: number;
  stack?: string;
};

export function createDevToolsFailure(
  kind: DevToolsFailureKind,
  message: string,
  options: { componentStack?: string; context?: string; stack?: string } = {},
): DevToolsFailure {
  return {
    kind,
    message,
    occurredAt: Date.now(),
    ...options,
  };
}

type BoundaryProps = {
  children: ReactNode;
  context?: string;
  onClose: () => void;
  onFailure?: (failure: DevToolsFailure) => void;
  onRetry: () => void;
  resetKey: string;
};

type BoundaryState = { failure: DevToolsFailure | null };

class DevToolsErrorBoundaryImpl extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { failure: null };

  static getDerivedStateFromError(value: unknown): Partial<BoundaryState> {
    const error = normalizeError(value);
    return {
      failure: createDevToolsFailure(
        "react",
        error.message,
        error.stack === undefined ? {} : { stack: error.stack },
      ),
    };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const failure = createDevToolsFailure("react", error.message, {
      ...(error.stack === undefined ? {} : { stack: error.stack }),
      ...(info.componentStack === null ? {} : { componentStack: info.componentStack }),
      ...(this.props.context === undefined ? {} : { context: this.props.context }),
    });
    appLogger.error({
      err: error,
      event: "browser_devtools.render.failed",
      fields: { componentStack: info.componentStack ?? "" },
    });
    // WHY: React exposes the component stack only through componentDidCatch, after derived state.
    // oxlint-disable-next-line react/no-set-state
    this.setState({ failure });
    this.props.onFailure?.(failure);
  }

  override render(): ReactNode {
    if (this.state.failure === null) {
      return this.props.children;
    }
    return (
      <DevToolsFailurePanel
        failure={this.state.failure}
        onClose={this.props.onClose}
        onRetry={this.props.onRetry}
      />
    );
  }
}

/** Isolates embedded DevTools failures from the surrounding conversation UI. */
export function DevToolsErrorBoundary(props: BoundaryProps): ReactNode {
  return <DevToolsErrorBoundaryImpl key={props.resetKey} {...props} />;
}

export function DevToolsFailurePanel({
  failure,
  onClose,
  onRetry,
}: {
  failure: DevToolsFailure;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [copying, setCopying] = useState(false);
  const report = devToolsFailureReport(failure);
  const copy = async () => {
    if (copying) {
      return;
    }
    setCopying(true);
    try {
      await setStringAsync(report);
    } catch (error) {
      appLogger.warnCaught({ error, event: "browser_devtools.report_copy.failed" });
    }
    setCopying(false);
  };
  return (
    <View accessibilityRole="alert" style={styles.root} testID="chromium-devtools-error-boundary">
      <Text style={styles.title}>Chromium DevTools crashed</Text>
      <Text selectable style={styles.message}>
        {failure.message}
      </Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.primaryButton}>
          <Text style={styles.primaryLabel}>Retry DevTools</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={copying}
          onPress={() => void copy()}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryLabel}>{copying ? "Copying…" : "Copy error"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondaryButton}>
          <Text style={styles.secondaryLabel}>Close DevTools</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.detailsContent} style={styles.details}>
        <Text selectable style={styles.detailsText}>
          {report}
        </Text>
      </ScrollView>
    </View>
  );
}

function devToolsFailureReport(failure: DevToolsFailure): string {
  return [
    "CodeWide Chromium DevTools failure",
    `Kind: ${failure.kind}`,
    `Occurred at: ${new Date(failure.occurredAt).toISOString()}`,
    `Message: ${failure.message}`,
    failure.context === undefined ? null : `Context:\n${failure.context}`,
    failure.stack === undefined
      ? "No JavaScript stack available"
      : `JavaScript stack:\n${failure.stack}`,
    failure.componentStack === undefined
      ? "No React component stack available"
      : `React component stack:\n${failure.componentStack}`,
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
}

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
    return new Error("Unknown DevTools render error");
  }
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  details: {
    backgroundColor: colors.background,
    borderRadius: radii.medium,
    flex: 1,
    minHeight: 80,
  },
  detailsContent: { padding: spacing.sm },
  detailsText: {
    color: colors.textMuted,
    ...typeScale.code,
    fontFamily: "monospace",
  },
  message: {
    color: colors.red,
    ...typeScale.body,
  },
  primaryButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.md,
  },
  primaryLabel: {
    color: colors.onPrimary,
    ...typeScale.label,
  },
  root: {
    backgroundColor: "#202124",
    flex: 1,
    gap: spacing.sm,
    minHeight: 0,
    padding: spacing.md,
  },
  secondaryButton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  secondaryLabel: {
    color: colors.text,
    ...typeScale.label,
  },
  title: {
    color: colors.text,
    ...typeScale.title,
  },
});
