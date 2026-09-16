import {
  Component,
  createContext,
  type ErrorInfo,
  type ReactNode,
  useContext,
  useState,
} from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";

import { appLogger } from "../observability/logger";
import { useEvent } from "../react/useEvent";
import { colors, radii, spacing, typeScale, controlSize } from "../theme";
import { AppText as Text } from "./AppText";
import type { RecoverableRenderFailure, RecoverableRenderScope } from "./render-recovery-prompt";

type RecoveryHandler = (failure: RecoverableRenderFailure) => Promise<void>;

const RenderRecoveryContext = createContext<RecoveryHandler | null>(null);

export function RenderRecoveryProvider({
  children,
  onFix,
}: {
  children: ReactNode;
  onFix: RecoveryHandler;
}): ReactNode {
  const fix = useEvent(async (failure: RecoverableRenderFailure) => {
    await onFix(failure);
  });
  return <RenderRecoveryContext.Provider value={fix}>{children}</RenderRecoveryContext.Provider>;
}

type BoundaryProps = {
  children: ReactNode;
  context?: string;
  label: string;
  onDismiss?: () => void;
  resetKey?: string;
  scope: RecoverableRenderScope;
};

type BoundaryState = {
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

class RecoverableRenderBoundaryImpl extends Component<
  BoundaryProps & { onFix: RecoveryHandler | null },
  BoundaryState
> {
  override state: BoundaryState = { componentStack: "", error: null };

  static getDerivedStateFromError(value: unknown): Partial<BoundaryState> {
    return { error: normalizeError(value) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    appLogger.error({
      err: error,
      event: "render.recoverable.failed",
      fields: {
        componentStack: info.componentStack ?? "",
        scope: this.props.scope,
      },
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
    if (this.state.error === null) {
      return this.props.children;
    }
    const failure: RecoverableRenderFailure = {
      componentStack: this.state.componentStack,
      error: this.state.error,
      label: this.props.label,
      scope: this.props.scope,
      ...(this.props.context === undefined ? {} : { context: this.props.context }),
    };
    return (
      <RenderFailureFallback
        failure={failure}
        onFix={this.props.onFix}
        onRetry={this.retry}
        {...(this.props.onDismiss === undefined ? {} : { onDismiss: this.props.onDismiss })}
      />
    );
  }
}

/** Catches a local render failure and delegates recovery to the nearest owner. */
export function RecoverableRenderBoundary(props: BoundaryProps) {
  const onFix = useContext(RenderRecoveryContext);
  return <RecoverableRenderBoundaryImpl key={props.resetKey} {...props} onFix={onFix} />;
}

function RenderFailureFallback({
  failure,
  onDismiss,
  onFix,
  onRetry,
}: {
  failure: RecoverableRenderFailure;
  onDismiss?: () => void;
  onFix: RecoveryHandler | null;
  onRetry: () => void;
}) {
  const [fixing, setFixing] = useState(false);
  const [fixError, setFixError] = useState<string | null>(null);
  const fix = async () => {
    if (onFix === null || fixing) {
      return;
    }
    setFixing(true);
    setFixError(null);
    let completed = false;
    try {
      await onFix(failure);
      completed = true;
    } catch (error) {
      setFixError(error instanceof Error ? error.message : "Could not create a repair chat");
    }
    setFixing(false);
    if (completed) {
      onDismiss?.();
    }
  };
  return (
    <View
      accessibilityRole="alert"
      style={[styles.failure, failure.scope === "dialog" && styles.dialogFailure]}
      testID={`render-error-${failure.scope}`}
    >
      <Text style={styles.title}>
        {failure.scope === "bubble"
          ? "This message could not be rendered"
          : "This view could not be opened"}
      </Text>
      <Text numberOfLines={3} selectable style={styles.message}>
        {failure.error.message === "" ? "Unknown React render error" : failure.error.message}
      </Text>
      {fixError !== null && (
        <Text accessibilityLiveRegion="polite" style={styles.fixError}>
          {fixError}
        </Text>
      )}
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.secondaryButton}>
          <Text style={styles.secondaryLabel}>Retry</Text>
        </Pressable>
        {onFix !== null && (
          <Pressable
            accessibilityRole="button"
            disabled={fixing}
            onPress={() => void fix()}
            style={styles.primaryButton}
          >
            {fixing ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Text style={styles.primaryLabel}>Fix this in chat</Text>
            )}
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
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  closeButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.sm,
  },
  dialogFailure: {
    marginHorizontal: spacing.md,
    marginVertical: spacing.lg,
  },
  failure: {
    alignSelf: "stretch",
    backgroundColor: colors.surfaceContainerHigh,
    borderRadius: radii.large,
    gap: spacing.xs,
    minWidth: 0,
    padding: spacing.md,
  },
  fixError: {
    color: colors.red,
    ...typeScale.label,
  },
  message: {
    color: colors.textMuted,
    ...typeScale.label,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: controlSize.touch,
    minWidth: controlSize.touch,
    paddingHorizontal: spacing.md,
  },
  primaryLabel: {
    color: colors.onPrimary,
    fontFamily: "RobotoFlex-SemiBold",
    ...typeScale.body,
  },
  secondaryButton: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHighest,
    borderRadius: radii.large,
    justifyContent: "center",
    minHeight: controlSize.regular,
    paddingHorizontal: spacing.md,
  },
  secondaryLabel: {
    color: colors.text,
    fontFamily: "RobotoFlex-Medium",
    ...typeScale.body,
  },
  title: {
    color: colors.text,
    fontFamily: "RobotoFlex-SemiBold",
    ...typeScale.body,
  },
});
