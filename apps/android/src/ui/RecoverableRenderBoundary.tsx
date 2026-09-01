import { Component, createContext, type ErrorInfo, type ReactNode, useContext, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { colors, radii, spacing } from "../theme";
import { AppText as Text } from "./Typography";
import type { RecoverableRenderFailure, RecoverableRenderScope } from "./render-recovery-prompt";

type RecoveryHandler = (failure: RecoverableRenderFailure) => Promise<void>;

const RenderRecoveryContext = createContext<RecoveryHandler | null>(null);

export class RenderRecoveryProvider extends Component<{ children: ReactNode; onFix: RecoveryHandler }> {
  private fix: RecoveryHandler = async (failure) => await this.props.onFix(failure);

  override render(): ReactNode {
    return <RenderRecoveryContext.Provider value={this.fix}>{this.props.children}</RenderRecoveryContext.Provider>;
  }
}

type BoundaryProps = {
  children: ReactNode;
  scope: RecoverableRenderScope;
  label: string;
  context?: string;
  resetKey?: string;
  onDismiss?(): void;
};

type BoundaryState = {
  error: Error | null;
  componentStack: string;
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

class RecoverableRenderBoundaryImpl extends Component<BoundaryProps & { onFix: RecoveryHandler | null }, BoundaryState> {
  override state: BoundaryState = { error: null, componentStack: "" };

  static getDerivedStateFromError(value: unknown): Partial<BoundaryState> {
    return { error: normalizeError(value) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`CodeWide ${this.props.scope} render failed: ${this.props.label}`, error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  override componentDidUpdate(previous: BoundaryProps & { onFix: RecoveryHandler | null }): void {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null, componentStack: "" });
    }
  }

  private retry = (): void => {
    this.setState({ error: null, componentStack: "" });
  };

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    const failure: RecoverableRenderFailure = {
      scope: this.props.scope,
      label: this.props.label,
      error: this.state.error,
      componentStack: this.state.componentStack,
      ...(this.props.context === undefined ? {} : { context: this.props.context }),
    };
    return (
      <RenderFailureFallback
        failure={failure}
        onRetry={this.retry}
        onFix={this.props.onFix}
        {...(this.props.onDismiss === undefined ? {} : { onDismiss: this.props.onDismiss })}
      />
    );
  }
}

export function RecoverableRenderBoundary(props: BoundaryProps) {
  const onFix = useContext(RenderRecoveryContext);
  return <RecoverableRenderBoundaryImpl {...props} onFix={onFix} />;
}

function RenderFailureFallback({
  failure,
  onRetry,
  onFix,
  onDismiss,
}: {
  failure: RecoverableRenderFailure;
  onRetry(): void;
  onFix: RecoveryHandler | null;
  onDismiss?(): void;
}) {
  const [fixing, setFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const fix = async () => {
    if (onFix === null || fixing) return;
    setFixing(true);
    setFixError(null);
    let completed = false;
    try {
      await onFix(failure);
      completed = true;
    } catch (cause) {
      setFixError(cause instanceof Error ? cause.message : "Could not create a repair chat");
    }
    setFixing(false);
    if (completed) onDismiss?.();
  };
  return (
    <View accessibilityRole="alert" style={[styles.failure, failure.scope === "dialog" && styles.dialogFailure]} testID={`render-error-${failure.scope}`}>
      <Text style={styles.title}>{failure.scope === "bubble" ? "This message could not be rendered" : "This view could not be opened"}</Text>
      <Text numberOfLines={3} selectable style={styles.message}>{failure.error.message || "Unknown React render error"}</Text>
      {fixError !== null && <Text accessibilityLiveRegion="polite" style={styles.fixError}>{fixError}</Text>}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.secondaryButton}>
          <Text style={styles.secondaryLabel}>Retry</Text>
        </Pressable>
        {onFix !== null && (
          <Pressable accessibilityRole="button" disabled={fixing} onPress={() => void fix()} style={styles.primaryButton}>
            {fixing ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <Text style={styles.primaryLabel}>Fix this in chat</Text>}
          </Pressable>
        )}
        {onDismiss !== undefined && (
          <Pressable accessibilityRole="button" onPress={onDismiss} style={styles.closeButton}>
            <Text style={styles.secondaryLabel}>Close</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  failure: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.large,
    gap: spacing.xs,
    minWidth: 0,
    padding: spacing.md,
  },
  dialogFailure: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.lg,
  },
  title: {
    color: colors.text,
    fontFamily: "RobotoFlex-SemiBold",
    fontSize: 14,
    lineHeight: 19,
  },
  message: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  fixError: {
    color: colors.red,
    fontSize: 12,
    lineHeight: 17,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: 38,
    minWidth: 126,
    paddingHorizontal: spacing.md,
  },
  primaryLabel: {
    color: colors.onPrimary,
    fontFamily: "RobotoFlex-SemiBold",
    fontSize: 13,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  closeButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  secondaryLabel: {
    color: colors.text,
    fontFamily: "RobotoFlex-Medium",
    fontSize: 13,
  },
});
