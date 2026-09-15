import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { operationalMetricsSnapshot } from "../../data/operational-metrics";
import { performanceExperimentSnapshot } from "../../data/performance-experiments";
import { getWindowFrameReport, usePerformanceMetrics } from "../../native/performance-metrics";
import { useEvent } from "../../react/useEvent";
export function useSnapshotDiagnosticAction(
  metrics: ReturnType<typeof usePerformanceMetrics>,
  setError: (error: string | null) => void,
) {
  const [snapshotCopied, setSnapshotCopied] = useState(false);
  const [copyPending, setCopyPending] = useState(false);
  const copyInFlight = useRef(false);
  const copySnapshot = useEvent(async () => {
    if (copyInFlight.current) return;
    copyInFlight.current = true;
    setCopyPending(true);
    setError(null);
    try {
      await Clipboard.setStringAsync(
        JSON.stringify(
          {
            version: 1,
            collectedAt: new Date().toISOString(),
            native: {
              available: metrics.available,
              enabled: metrics.enabled,
              current: metrics.current,
              peakCpuPercent: metrics.peakCpuPercent,
              peakPssBytes: metrics.peakPssBytes,
              sessionJankPercent: metrics.sessionJankPercent,
              totalDroppedFrameEstimate: metrics.totalDroppedFrameEstimate,
              historySamples: metrics.historySamples,
              historyCapacity: metrics.historyCapacity,
            },
            streaming: operationalMetricsSnapshot(),
            experiments: performanceExperimentSnapshot(),
            frameReport: await getWindowFrameReport(),
          },
          null,
          2,
        ),
      );
      setSnapshotCopied(true);
      setTimeout(() => setSnapshotCopied(false), 2_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not copy diagnostics");
    }
    // Both outcomes reach cleanup; React Compiler cannot lower a finally clause here.
    copyInFlight.current = false;
    setCopyPending(false);
  });
  return { snapshotCopied, copyPending, copySnapshot };
}
