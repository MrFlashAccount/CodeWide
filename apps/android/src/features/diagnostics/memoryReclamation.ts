import {
  captureMemoryCheckpoint,
  type MemoryCheckpoint,
  type MemoryReclamationActionResult,
} from "../../native/performance-metrics";
import { delay } from "./performanceDelay";

export const MEMORY_RECLAMATION_SETTLE_MS = 400;

export type MemoryReclamationStage = {
  action: MemoryReclamationActionResult | null;
  checkpoint: MemoryCheckpoint;
  id: string;
};

export type MemoryCheckpointDelta = {
  graphicsPssBytes: number;
  javaHeapPssBytes: number;
  javaUsedBytes: number;
  nativeAllocatedBytes: number;
  nativeCommittedBytes: number;
  nativeFreeBytes: number;
  nativeHeapPssBytes: number;
  privateOtherPssBytes: number;
  procRssBytes: number | null;
  smapsPssBytes: number | null;
  totalPssBytes: number;
};

export async function collectMemoryReclamationStage(
  id: string,
  action: () => Promise<MemoryReclamationActionResult>,
): Promise<MemoryReclamationStage> {
  const result = await action();
  await delay(MEMORY_RECLAMATION_SETTLE_MS);
  return { action: result, checkpoint: await captureMemoryCheckpoint(), id };
}

export function memoryStageDeltas(stages: MemoryReclamationStage[]) {
  const baseline = stages[0]?.checkpoint;
  return stages.map((stage, index) => {
    const previous = stages[index - 1];
    return {
      fromBaseline:
        baseline === undefined ? null : memoryCheckpointDelta(stage.checkpoint, baseline),
      fromPrevious:
        previous === undefined
          ? null
          : memoryCheckpointDelta(stage.checkpoint, previous.checkpoint),
      id: stage.id,
    };
  });
}

export function memoryCheckpointDelta(
  current: MemoryCheckpoint,
  previous: MemoryCheckpoint,
): MemoryCheckpointDelta {
  return {
    graphicsPssBytes: current.graphicsPssBytes - previous.graphicsPssBytes,
    javaHeapPssBytes: current.javaHeapPssBytes - previous.javaHeapPssBytes,
    javaUsedBytes: current.javaUsedBytes - previous.javaUsedBytes,
    nativeAllocatedBytes: current.nativeAllocatedBytes - previous.nativeAllocatedBytes,
    nativeCommittedBytes: current.nativeCommittedBytes - previous.nativeCommittedBytes,
    nativeFreeBytes: current.nativeFreeBytes - previous.nativeFreeBytes,
    nativeHeapPssBytes: current.nativeHeapPssBytes - previous.nativeHeapPssBytes,
    privateOtherPssBytes: current.privateOtherPssBytes - previous.privateOtherPssBytes,
    procRssBytes: nullableDelta(current.procRssBytes, previous.procRssBytes),
    smapsPssBytes: nullableDelta(current.smapsPssBytes, previous.smapsPssBytes),
    totalPssBytes: current.totalPssBytes - previous.totalPssBytes,
  };
}

function nullableDelta(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}
