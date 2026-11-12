import type { AuthFlow, AuthMethod } from "../../../data/forgeContract";
import { FailedFlowPanel } from "./FailedFlowPanel";
import { HostLoginPanel } from "./HostLoginPanel";

/** The provider's host-login flow: its one-time code while awaiting the user, or why it failed. */
export function FlowPanel({
  busy,
  cancelling,
  flow,
  methods,
  onCancel,
  onStart,
}: {
  readonly busy: boolean;
  readonly cancelling: boolean;
  readonly flow: AuthFlow;
  readonly methods: readonly AuthMethod[];
  readonly onCancel: () => void;
  readonly onStart: (method: AuthMethod, login: string | null) => void;
}): React.JSX.Element {
  if (flow.state === "awaitingUser") {
    return <HostLoginPanel cancelling={cancelling} flow={flow} onCancel={onCancel} />;
  }
  return (
    <FailedFlowPanel
      busy={busy}
      flow={flow}
      onDismiss={onCancel}
      onRetry={() => {
        const method = methods.find((candidate) => candidate.methodId === flow.methodId);
        if (method !== undefined) {
          onStart(method, null);
        }
      }}
    />
  );
}
