import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import { operationalMetricsSnapshot } from "../../data/operational-metrics";
import { performanceExperimentSnapshot } from "../../data/performance-experiments";
import type { usePerformanceMetrics } from "../../native/performance-metrics";
import { getWindowFrameReport } from "../../native/performance-metrics";
import { useEvent } from "../../react/useEvent";

export function useSnapshotDiagnosticAction(
  metrics: ReturnType<typeof usePerformanceMetrics>,
  setError: (error: string | null) => void,
) {
  const [snapshotCopied, setSnapshotCopied] = useState(false);
  const [copyPending, setCopyPending] = useState(false);
  const copyInFlight = useRef(false);
  const copySnapshot = useEvent(async () => {
    if (copyInFlight.current) {
      return;
    }
    copyInFlight.current = true;
    setCopyPending(true);
    setError(null);
    try {
      await Clipboard.setStringAsync(
        JSON.stringify(
          {
            collectedAt: new Date().toISOString(),
            experiments: performanceExperimentSnapshot(),
            frameReport: await getWindowFrameReport(),
            native: {
              available: metrics.available,
              current: metrics.current,
              enabled: metrics.enabled,
              historyCapacity: metrics.historyCapacity,
              historySamples: metrics.historySamples,
              peakCpuPercent: metrics.peakCpuPercent,
              peakPssBytes: metrics.peakPssBytes,
              sessionJankPercent: metrics.sessionJankPercent,
              totalDroppedFrameEstimate: metrics.totalDroppedFrameEstimate,
            },
            streaming: operationalMetricsSnapshot(),
            version: 1,
          },
          null,
          2,
        ),
      );
      setSnapshotCopied(true);
      setTimeout(() => {
        setSnapshotCopied(false);
      }, 2000);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not copy diagnostics");
    }
    // Both outcomes reach cleanup; React Compiler cannot lower a finally clause here.
    copyInFlight.current = false;
    setCopyPending(false);
  });
  return { copyPending, copySnapshot, snapshotCopied };
}
