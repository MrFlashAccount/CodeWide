import { useState } from "react";
import { useEvent } from "../../react/useEvent";
import type { PortForwardingCandidate, PortForwardingManagerProps } from "./portForwardingContract";
import { message } from "./portForwardingForm";
export function usePortActions(props: PortForwardingManagerProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingPort, setPendingPort] = useState<number | null>(null);
  const [webMenuId, setWebMenuId] = useState<string | null>(null);
  const runProfileAction = useEvent(async (id: string, action: () => Promise<void>) => {
    setPendingId(id);
    setActionError(null);
    setWebMenuId(null);
    try {
      await action();
    } catch (cause) {
      setActionError(message(cause, "Could not update port forwarding"));
    }
    setPendingId((current) => (current === id ? null : current));
  });
  const choosePort = useEvent(async (candidate: PortForwardingCandidate) => {
    setPendingPort(candidate.port);
    setActionError(null);
    try {
      await props.onSelectPort(candidate);
    } catch (cause) {
      setActionError(message(cause, "Could not forward this port"));
    }
    setPendingPort((current) => (current === candidate.port ? null : current));
  });
  const excludePort = useEvent(async (candidate: PortForwardingCandidate) => {
    setPendingPort(candidate.port);
    setActionError(null);
    try {
      await props.onExcludePort(candidate);
    } catch (cause) {
      setActionError(message(cause, "Could not exclude this port"));
    }
    setPendingPort((current) => (current === candidate.port ? null : current));
  });
  return {
    actionError,
    pendingId,
    pendingPort,
    webMenuId,
    setWebMenuId,
    runProfileAction,
    choosePort,
    excludePort,
  };
}
