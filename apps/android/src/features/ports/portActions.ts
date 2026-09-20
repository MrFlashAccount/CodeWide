import { useState } from "react";
import { useEvent } from "../../react/useEvent";
import type { PortForwardingCandidate, PortForwardingManagerProps } from "./portForwardingContract";
import { message } from "./portForwardingForm";

export function usePortActions(props: PortForwardingManagerProps) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pendingPort, setPendingPort] = useState<number | null>(null);
  const [actionMenuProfileId, setActionMenuProfileId] = useState<string | null>(null);
  const runProfileAction = useEvent(async (id: string, action: () => Promise<void>) => {
    setPendingId(id);
    setActionError(null);
    setActionMenuProfileId(null);
    try {
      await action();
    } catch (error) {
      setActionError(message(error, "Could not update port forwarding"));
    }
    setPendingId((current) => (current === id ? null : current));
  });
  const activateProfileAction = useEvent((id: string, action: () => Promise<void>): void => {
    runProfileAction(id, action).catch((error: unknown) => {
      setPendingId((current) => (current === id ? null : current));
      setActionError(message(error, "Could not update port forwarding"));
    });
  });
  const choosePort = useEvent(async (candidate: PortForwardingCandidate) => {
    setPendingPort(candidate.port);
    setActionError(null);
    try {
      await props.onSelectPort(candidate);
    } catch (error) {
      setActionError(message(error, "Could not forward this port"));
    }
    setPendingPort((current) => (current === candidate.port ? null : current));
  });
  const excludePort = useEvent(async (candidate: PortForwardingCandidate) => {
    setPendingPort(candidate.port);
    setActionError(null);
    try {
      await props.onExcludePort(candidate);
    } catch (error) {
      setActionError(message(error, "Could not exclude this port"));
    }
    setPendingPort((current) => (current === candidate.port ? null : current));
  });
  return {
    actionError,
    actionMenuProfileId,
    activateProfileAction,
    choosePort,
    excludePort,
    pendingId,
    pendingPort,
    setActionMenuProfileId,
  };
}
