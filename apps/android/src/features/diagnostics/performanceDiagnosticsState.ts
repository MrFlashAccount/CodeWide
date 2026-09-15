import { useEffect, useRef, useState } from "react";
import { operationalMetricsSnapshot } from "../../data/operational-metrics";
import {
  performanceExperimentSnapshot,
  setPerformanceExperiment,
  usePerformanceExperiments,
  type PerformanceExperimentId,
} from "../../data/performance-experiments";
import {
  setPerformanceMonitoringEnabled,
  usePerformanceMetrics,
} from "../../native/performance-metrics";
import { useEvent } from "../../react/useEvent";
import { useMemoryDiagnosticActions } from "./memoryDiagnosticActions";
import { type ExperimentResult, collectExperiment } from "./performanceExperiment";
import { useSnapshotDiagnosticAction } from "./snapshotDiagnosticAction";

export function usePerformanceDiagnosticsState() {
  const metrics = usePerformanceMetrics();
  const experiments = usePerformanceExperiments();
  const [error, setError] = useState<string | null>(null);
  const { memoryReportCopyState, memoryExperimentState, copyMemoryReport, runMemoryExperiment } =
    useMemoryDiagnosticActions(setError);
  const { snapshotCopied, copyPending, copySnapshot } = useSnapshotDiagnosticAction(
    metrics,
    setError,
  );
  const [, setDiagnosticRevision] = useState(0);
  const [runningExperiment, setRunningExperiment] = useState<PerformanceExperimentId | null>(null);
  const [experimentResult, setExperimentResult] = useState<ExperimentResult | null>(null);
  const runGeneration = useRef(0);
  const runningRestore = useRef<{ id: PerformanceExperimentId; enabled: boolean } | null>(null);
  const current = metrics.current;
  useEffect(() => {
    if (!metrics.enabled) return;
    const timer = setInterval(() => setDiagnosticRevision((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [metrics.enabled]);
  useEffect(
    () => () => {
      runGeneration.current += 1;
      const restore = runningRestore.current;
      if (restore !== null) setPerformanceExperiment(restore.id, restore.enabled);
    },
    [],
  );
  const operational = operationalMetricsSnapshot();
  const toggle = useEvent(async (enabled: boolean) => {
    setError(null);
    if (!enabled && runningRestore.current !== null) {
      runGeneration.current += 1;
      setPerformanceExperiment(runningRestore.current.id, runningRestore.current.enabled);
      runningRestore.current = null;
      setRunningExperiment(null);
    }
    try {
      await setPerformanceMonitoringEnabled(enabled);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change performance monitoring");
    }
  });
  const runExperiment = useEvent(async (id: PerformanceExperimentId) => {
    if (runningExperiment !== null) return;
    const generation = runGeneration.current + 1;
    runGeneration.current = generation;
    const previous = performanceExperimentSnapshot()[id];
    runningRestore.current = { id, enabled: previous };
    setRunningExperiment(id);
    setExperimentResult(null);
    setError(null);
    const outcome = await collectExperiment(id, () => runGeneration.current === generation).then(
      (result) => ({ status: "ok" as const, result }),
      (cause: unknown) => ({
        status: "error" as const,
        error: cause instanceof Error ? cause.message : "Performance experiment failed",
      }),
    );
    if (runGeneration.current !== generation) return;
    if (outcome.status === "error") setError(outcome.error);
    else if (outcome.result !== null) setExperimentResult(outcome.result);
    if (runGeneration.current === generation) {
      setPerformanceExperiment(id, previous);
      runningRestore.current = null;
      setRunningExperiment(null);
    }
  });
  return {
    metrics,
    toggle,
    copyPending,
    copySnapshot,
    snapshotCopied,
    memoryReportCopyState,
    copyMemoryReport,
    memoryExperimentState,
    runMemoryExperiment,
    error,
    current,
    setExperimentResult,
    setDiagnosticRevision,
    runningExperiment,
    runExperiment,
    experiments,
    operational,
    experimentResult,
  };
}
