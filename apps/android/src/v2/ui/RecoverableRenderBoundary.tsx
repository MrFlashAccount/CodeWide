import { Component, createContext, useContext, type ErrorInfo, type ReactNode } from "react";

import { RenderFailureFallback, type RecoveryHandler } from "./RenderFailureFallback";
import type { RecoverableRenderFailure, RecoverableRenderScope } from "./renderRecoveryPrompt";

interface RenderRecoveryProviderProps {
  children: ReactNode;
  onFix: RecoveryHandler;
}

export interface RecoverableRenderBoundaryProps {
  children: ReactNode;
  context?: string;
  label: string;
  onDismiss?(): void;
  onError?(failure: RecoverableRenderFailure): void;
  resetKey?: string;
  scope: RecoverableRenderScope;
}

interface BoundaryImplementationProps extends RecoverableRenderBoundaryProps {
  onFix: RecoveryHandler | null;
}

interface BoundaryState {
  componentStack: string;
  error: Error | null;
}

const RenderRecoveryContext = createContext<RecoveryHandler | null>(null);

export type { RecoveryHandler } from "./RenderFailureFallback";

export function RenderRecoveryProvider(props: RenderRecoveryProviderProps): React.JSX.Element {
  const { children, onFix } = props;
  return <RenderRecoveryContext.Provider value={onFix}>{children}</RenderRecoveryContext.Provider>;
}

class RecoverableRenderBoundaryImplementation extends Component<
  BoundaryImplementationProps,
  BoundaryState
> {
  override state: BoundaryState = { componentStack: "", error: null };

  static getDerivedStateFromError(value: unknown): Partial<BoundaryState> {
    return { error: normalizeError(value) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.({
      componentStack: info.componentStack ?? "",
      ...(this.props.context === undefined ? {} : { context: this.props.context }),
      error,
      label: this.props.label,
      scope: this.props.scope,
    });
    // Error boundaries are class components; their recovery state must use setState.
    // oxlint-disable-next-line react/no-set-state
    this.setState({ componentStack: info.componentStack ?? "" });
  }

  override componentDidUpdate(previous: BoundaryImplementationProps): void {
    if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
      // oxlint-disable-next-line react/no-set-state -- Reset is driven by an explicit boundary key.
      this.setState({ componentStack: "", error: null });
    }
  }

  private readonly retry = (): void => {
    // oxlint-disable-next-line react/no-set-state -- Retry clears the captured render failure.
    this.setState({ componentStack: "", error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    const failure: RecoverableRenderFailure = {
      componentStack: this.state.componentStack,
      ...(this.props.context === undefined ? {} : { context: this.props.context }),
      error,
      label: this.props.label,
      scope: this.props.scope,
    };
    return (
      <RenderFailureFallback
        failure={failure}
        {...(this.props.onDismiss === undefined ? {} : { onDismiss: this.props.onDismiss })}
        onFix={this.props.onFix}
        onRetry={this.retry}
      />
    );
  }
}

export function RecoverableRenderBoundary(
  props: RecoverableRenderBoundaryProps,
): React.JSX.Element {
  const onFix = useContext(RenderRecoveryContext);
  return <RecoverableRenderBoundaryImplementation {...props} onFix={onFix} />;
}

function normalizeError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === "string") return new Error(value);
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error("Unknown React render error");
  }
}
