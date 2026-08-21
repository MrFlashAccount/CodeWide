import { Component, type ErrorInfo, type ReactNode, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { colors, radii, spacing, typeScale } from "../theme";
import { AppText as Text } from "./Typography";

export type DevToolsFailureKind = "react" | "renderer" | "load" | "health" | "bridge";

export type DevToolsFailure = {
  kind: DevToolsFailureKind;
  message: string;
  occurredAt: number;
  stack?: string;
  componentStack?: string;
  context?: string;
};

export function createDevToolsFailure(
  kind: DevToolsFailureKind,
  message: string,
  options: { stack?: string; componentStack?: string; context?: string } = {},
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
  resetKey: string;
  context?: string;
  onFailure?(failure: DevToolsFailure): void;
  onRetry(): void;
  onClose(): void;
};

type BoundaryState = { failure: DevToolsFailure | null };

export class DevToolsErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failure: null };

  static getDerivedStateFromError(value: unknown): Partial<BoundaryState> {
    const error = normalizeError(value);
    return {
      failure: createDevToolsFailure("react", error.message, {
        ...(error.stack === undefined ? {} : { stack: error.stack }),
      }),
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const failure = createDevToolsFailure("react", error.message, {
      ...(error.stack === undefined ? {} : { stack: error.stack }),
      ...(info.componentStack === null ? {} : { componentStack: info.componentStack }),
      ...(this.props.context === undefined ? {} : { context: this.props.context }),
    });
    console.error("Chromium DevTools pane crashed", error, info.componentStack);
    this.setState({ failure });
    this.props.onFailure?.(failure);
  }

  componentDidUpdate(previous: BoundaryProps): void {
    if (this.state.failure !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ failure: null });
    }
  }

  render(): ReactNode {
    if (this.state.failure === null) return this.props.children;
    return (
      <DevToolsFailurePanel
        failure={this.state.failure}
        onRetry={this.props.onRetry}
        onClose={this.props.onClose}
      />
    );
  }
}

export function DevToolsFailurePanel({
  failure,
  onRetry,
  onClose,
}: {
  failure: DevToolsFailure;
  onRetry(): void;
  onClose(): void;
}) {
  const [copying, setCopying] = useState(false);
  const report = devToolsFailureReport(failure);
  const copy = async () => {
    if (copying) return;
    setCopying(true);
    try {
      const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
      await Clipboard.setStringAsync(report);
    } catch (error) {
      console.error("Could not copy the DevTools failure report", error);
    }
    setCopying(false);
  };
  return (
    <View accessibilityRole="alert" style={styles.root} testID="chromium-devtools-error-boundary">
      <Text style={styles.title}>Chromium DevTools crashed</Text>
      <Text selectable style={styles.message}>{failure.message}</Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.primaryButton}>
          <Text style={styles.primaryLabel}>Retry DevTools</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={copying} onPress={() => void copy()} style={styles.secondaryButton}>
          <Text style={styles.secondaryLabel}>{copying ? "Copying…" : "Copy error"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.secondaryButton}>
          <Text style={styles.secondaryLabel}>Close DevTools</Text>
        </Pressable>
      </View>
      <ScrollView style={styles.details} contentContainerStyle={styles.detailsContent}>
        <Text selectable style={styles.detailsText}>{report}</Text>
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
    failure.stack === undefined ? "No JavaScript stack available" : `JavaScript stack:\n${failure.stack}`,
    failure.componentStack === undefined ? "No React component stack available" : `React component stack:\n${failure.componentStack}`,
  ].filter((line): line is string => line !== null).join("\n\n");
}

function normalizeError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error("Unknown DevTools render error");
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, gap: spacing.sm, padding: spacing.md, backgroundColor: "#202124" },
  title: { color: colors.text, ...typeScale.titleMedium },
  message: { color: colors.red, ...typeScale.bodyMedium },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  primaryButton: { minHeight: 38, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.large, backgroundColor: colors.primary },
  primaryLabel: { color: colors.onPrimary, ...typeScale.labelMedium },
  secondaryButton: { minHeight: 38, justifyContent: "center", paddingHorizontal: spacing.md, borderRadius: radii.large, backgroundColor: colors.surfaceRaised },
  secondaryLabel: { color: colors.text, ...typeScale.labelMedium },
  details: { flex: 1, minHeight: 80, borderRadius: radii.medium, backgroundColor: colors.background },
  detailsContent: { padding: spacing.sm },
  detailsText: { color: colors.textMuted, fontFamily: "monospace", fontSize: 10, lineHeight: 14 },
});
