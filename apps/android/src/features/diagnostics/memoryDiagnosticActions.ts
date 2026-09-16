import {
  resetRichMarkdownCache,
  richMarkdownCacheEstimatedBytes,
  richMarkdownCacheStats,
} from "@codewide/rendering-core";
import * as Clipboard from "expo-clipboard";
import { useRef, useState } from "react";
import {
  captureMemoryCheckpoint,
  captureMemoryReport,
  clearImageMemoryCache,
  clearNativeCodeMemoryCache,
  collectHermesGarbage,
  collectJavaGarbage,
  purgeNativeAllocator,
} from "../../native/performance-metrics";
import { useEvent } from "../../react/useEvent";
import {
  MEMORY_RECLAMATION_SETTLE_MS,
  type MemoryReclamationStage,
  collectMemoryReclamationStage,
  memoryCheckpointDelta,
  memoryStageDeltas,
} from "./memoryReclamation";
import { delay } from "./performanceDelay";

export function useMemoryDiagnosticActions(setError: (error: string | null) => void) {
  const [memoryReportCopyState, setMemoryReportCopyState] = useState<
    "idle" | "collecting" | "copied"
  >("idle");
  const [memoryExperimentState, setMemoryExperimentState] = useState<"idle" | "running" | "copied">(
    "idle",
  );
  const memoryReportInFlight = useRef(false);
  const memoryExperimentInFlight = useRef(false);
  const resetMemoryReportCopyState = useEvent(() => {
    setMemoryReportCopyState("idle");
  });
  const resetMemoryExperimentState = useEvent(() => {
    setMemoryExperimentState("idle");
  });
  const copyMemoryReport = useEvent(async () => {
    if (memoryReportInFlight.current) {
      return;
    }
    memoryReportInFlight.current = true;
    setMemoryReportCopyState("collecting");
    setError(null);
    try {
      await Clipboard.setStringAsync(await captureMemoryReport());
      setMemoryReportCopyState("copied");
      setTimeout(resetMemoryReportCopyState, 2000);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not copy memory report");
      setMemoryReportCopyState("idle");
    }
    memoryReportInFlight.current = false;
  });
  const runMemoryExperiment = useEvent(async () => {
    if (memoryExperimentInFlight.current) {
      return;
    }
    memoryExperimentInFlight.current = true;
    setMemoryExperimentState("running");
    setError(null);
    try {
      const stages: MemoryReclamationStage[] = [];
      stages.push({ action: null, checkpoint: await captureMemoryCheckpoint(), id: "baseline" });

      const markdownBefore = {
        ...richMarkdownCacheStats(),
        estimatedBytes: richMarkdownCacheEstimatedBytes(),
      };
      const markdownStartedAt = performance.now();
      resetRichMarkdownCache();
      const markdownDurationMs = performance.now() - markdownStartedAt;
      await delay(MEMORY_RECLAMATION_SETTLE_MS);
      stages.push({
        action: { durationMs: markdownDurationMs, performed: markdownBefore.entries > 0 },
        checkpoint: await captureMemoryCheckpoint(),
        id: "markdown-cache",
      });
      stages.push(
        await collectMemoryReclamationStage("native-code-cache", clearNativeCodeMemoryCache),
      );
      stages.push(await collectMemoryReclamationStage("fresco-image-cache", clearImageMemoryCache));
      stages.push(await collectMemoryReclamationStage("art-gc", collectJavaGarbage));
      stages.push(await collectMemoryReclamationStage("hermes-gc", collectHermesGarbage));
      stages.push(
        await collectMemoryReclamationStage("allocator-purge", async () =>
          purgeNativeAllocator(false),
        ),
      );
      const finalReclamationStage = await collectMemoryReclamationStage(
        "allocator-purge-all",
        async () => purgeNativeAllocator(true),
      );
      stages.push(finalReclamationStage);

      const fullReportEncoded = await captureMemoryReport();
      const fullReport: unknown = JSON.parse(fullReportEncoded);
      await delay(MEMORY_RECLAMATION_SETTLE_MS);
      const afterFullReport = await captureMemoryCheckpoint();
      const beforeFullReport = finalReclamationStage.checkpoint;
      await Clipboard.setStringAsync(
        JSON.stringify(
          {
            collectedAtMs: Date.now(),
            fullReport,
            fullReportProbe: {
              after: afterFullReport,
              before: beforeFullReport,
              delta: memoryCheckpointDelta(afterFullReport, beforeFullReport),
            },
            markdownCacheBefore: markdownBefore,
            settleMs: MEMORY_RECLAMATION_SETTLE_MS,
            stageDeltas: memoryStageDeltas(stages),
            stages,
            version: 1,
          },
          null,
          2,
        ),
      );
      setMemoryExperimentState("copied");
      setTimeout(resetMemoryExperimentState, 2000);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Memory experiment failed");
      setMemoryExperimentState("idle");
    }
    memoryExperimentInFlight.current = false;
  });
  return { copyMemoryReport, memoryExperimentState, memoryReportCopyState, runMemoryExperiment };
}
