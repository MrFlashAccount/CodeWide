import {
  captureMemoryCheckpoint,
  type MemoryCheckpoint,
  type MemoryReclamationActionResult,
} from "../../native/performance-metrics";
import { delay } from "./performanceDelay";

export const MEMORY_RECLAMATION_SETTLE_MS = 400;

export type MemoryReclamationStage = {
  id: string;
  action: MemoryReclamationActionResult | null;
  checkpoint: MemoryCheckpoint;
};

export type MemoryCheckpointDelta = {
  totalPssBytes: number;
  procRssBytes: number | null;
  smapsPssBytes: number | null;
  javaUsedBytes: number;
  nativeAllocatedBytes: number;
  nativeCommittedBytes: number;
  nativeFreeBytes: number;
  javaHeapPssBytes: number;
  nativeHeapPssBytes: number;
  graphicsPssBytes: number;
  privateOtherPssBytes: number;
};

export async function collectMemoryReclamationStage(
  id: string,
  action: () => Promise<MemoryReclamationActionResult>,
): Promise<MemoryReclamationStage> {
  const result = await action();
  await delay(MEMORY_RECLAMATION_SETTLE_MS);
  return { id, action: result, checkpoint: await captureMemoryCheckpoint() };
}

export function memoryStageDeltas(stages: MemoryReclamationStage[]) {
  const baseline = stages[0]?.checkpoint;
  return stages.map((stage, index) => {
    const previous = stages[index - 1];
    return {
      id: stage.id,
      fromPrevious:
        previous === undefined
          ? null
          : memoryCheckpointDelta(stage.checkpoint, previous.checkpoint),
      fromBaseline:
        baseline === undefined ? null : memoryCheckpointDelta(stage.checkpoint, baseline),
    };
  });
}

export function memoryCheckpointDelta(
  current: MemoryCheckpoint,
  previous: MemoryCheckpoint,
): MemoryCheckpointDelta {
  return {
    totalPssBytes: current.totalPssBytes - previous.totalPssBytes,
    procRssBytes: nullableDelta(current.procRssBytes, previous.procRssBytes),
    smapsPssBytes: nullableDelta(current.smapsPssBytes, previous.smapsPssBytes),
    javaUsedBytes: current.javaUsedBytes - previous.javaUsedBytes,
    nativeAllocatedBytes: current.nativeAllocatedBytes - previous.nativeAllocatedBytes,
    nativeCommittedBytes: current.nativeCommittedBytes - previous.nativeCommittedBytes,
    nativeFreeBytes: current.nativeFreeBytes - previous.nativeFreeBytes,
    javaHeapPssBytes: current.javaHeapPssBytes - previous.javaHeapPssBytes,
    nativeHeapPssBytes: current.nativeHeapPssBytes - previous.nativeHeapPssBytes,
    graphicsPssBytes: current.graphicsPssBytes - previous.graphicsPssBytes,
    privateOtherPssBytes: current.privateOtherPssBytes - previous.privateOtherPssBytes,
  };
}

function nullableDelta(current: number | null, previous: number | null): number | null {
  return current === null || previous === null ? null : current - previous;
}
