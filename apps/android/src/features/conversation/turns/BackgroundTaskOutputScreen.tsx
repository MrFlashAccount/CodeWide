import type { ReactElement } from "react";
import {
  followBackgroundTaskOutput,
  type BackgroundTaskOutput,
  type BackgroundTaskOutputPage,
} from "../../../data/backgroundTaskOutput";
import { useEphemeralAsyncResource } from "../../../rendering/async-resource-store";
import { stripTerminalControlSequences } from "../../../rendering/native-code-block";
import type { TaskOutputRouteRequest } from "../../../services/backgroundTasks/taskOutputRouteSession";
import { CommandOutputScreen, type CommandOutputStatus } from "./CommandOutputScreen";

const STATUS: Record<BackgroundTaskOutputPage["status"], CommandOutputStatus> = {
  completed: "finished",
  failed: "failed",
  killed: "stopped",
  lost: "lost",
  running: "running",
  stopped: "stopped",
  unknown: "unknown",
};

/** The exit line Claude appends to a finished background command's output. */
const EXIT_LINE = /\[exited with code (-?\d+)\]\s*$/u;
/** A text's resident weight: two bytes per UTF-16 unit. */
const BYTES_PER_UNIT = 2;

/**
 * A background task's output on the command output screen, titled with the
 * task's name. The screen reads the output by itself and follows a running
 * task until it closes.
 */
export function BackgroundTaskOutputScreen({
  onClose,
  opening,
  request,
}: {
  readonly onClose: () => void;
  /** Names this opening, so reopening the same task reads it afresh. */
  readonly opening: string;
  readonly request: TaskOutputRouteRequest;
}): ReactElement {
  // The screen owns the reading: it stops when the screen closes.
  const resource = useEphemeralAsyncResource<BackgroundTaskOutput>(
    `background-task-output:${opening}`,
    0,
    async (publish, signal) =>
      followBackgroundTaskOutput({ first: request.first, publish, read: request.read, signal }),
    (output) => output.text.length * BYTES_PER_UNIT,
  );
  // The first page shows until the reader publishes; it always does at once.
  const output = resource.value ?? firstOutput(request.first);
  const exit = EXIT_LINE.exec(stripTerminalControlSequences(output.text))?.[1];
  return (
    <CommandOutputScreen
      command={request.first.command}
      error={
        resource.error ?? (exit === undefined || exit === "0" ? null : `Exited with code ${exit}`)
      }
      loading={false}
      onClose={onClose}
      output={output}
      outputSource={opening}
      status={STATUS[output.status]}
      title={request.name}
    />
  );
}

function firstOutput(first: BackgroundTaskOutputPage): BackgroundTaskOutput {
  return {
    headOmitted: false,
    nextOffset: first.nextOffset ?? first.sizeBytes,
    sizeBytes: first.sizeBytes,
    status: first.status,
    text: first.text,
    totalChars: first.text.length,
  };
}
