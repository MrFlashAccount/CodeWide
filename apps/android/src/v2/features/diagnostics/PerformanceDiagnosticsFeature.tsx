import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import { PerformanceDiagnostics } from "../../presentation/diagnostics/PerformanceDiagnostics";
import type { DiagnosticsSource, PerformanceExperimentId } from "./diagnosticsTypes";

interface PerformanceDiagnosticsFeatureProps {
  source: DiagnosticsSource;
}

export function PerformanceDiagnosticsFeature(
  props: PerformanceDiagnosticsFeatureProps,
): React.JSX.Element {
  const { source } = props;
  const snapshot = useSyncExternalStore(source.subscribe, source.snapshot, source.snapshot);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [runningExperiment, setRunningExperiment] = useState<PerformanceExperimentId | null>(null);
  const changeMonitoring = useEvent((enabled: boolean) => {
    setPending(true);
    setError(null);
    void source
      .setMonitoringEnabled(enabled)
      .catch((cause: unknown) =>
        setError(errorMessage(cause, "Could not change performance monitoring")),
      )
      .finally(() => setPending(false));
  });
  const copy = useEvent(() => {
    setPending(true);
    setError(null);
    void source
      .copySnapshot()
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch((cause: unknown) => setError(errorMessage(cause, "Could not copy diagnostics")))
      .finally(() => setPending(false));
  });
  const runExperiment = useEvent((id: PerformanceExperimentId) => {
    if (runningExperiment !== null) return;
    setRunningExperiment(id);
    setError(null);
    void source
      .runExperiment(id)
      .catch((cause: unknown) => setError(errorMessage(cause, "Performance experiment failed")))
      .finally(() => setRunningExperiment(null));
  });
  const reset = useEvent(() => {
    source.reset();
    setError(null);
  });
  const changeExperiment = useEvent((id: PerformanceExperimentId, enabled: boolean) => {
    source.setExperiment(id, enabled);
  });
  return (
    <PerformanceDiagnostics
      copied={copied}
      error={error}
      onCopy={copy}
      onExperimentChange={changeExperiment}
      onMonitoringChange={changeMonitoring}
      onReset={reset}
      onRunExperiment={runExperiment}
      pending={pending}
      runningExperiment={runningExperiment}
      snapshot={snapshot}
    />
  );
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}
