import type { BackgroundTaskOutput } from "../../../data/backgroundTaskOutput";

/** The output a task output view shows, as the reader publishes it. */
export type TaskOutputTerminalProps = {
  readonly output: Pick<BackgroundTaskOutput, "headOmitted" | "text" | "totalChars">;
};

/** The note that stands for the beginning of a long output. */
export const HEAD_OMITTED_NOTE = "Earlier output is not shown.";
