import type { BackgroundTaskOutput } from "../../../data/backgroundTaskOutput";

/** The output a task output view shows, as the reader publishes it. */
export type TaskOutputTerminalProps = {
  readonly output: Pick<BackgroundTaskOutput, "headOmitted" | "text" | "totalChars">;
};

/** Search operations owned by the rendered terminal rather than its React caller. */
export type TaskOutputTerminalHandle = {
  readonly clearSearch: () => Promise<void>;
  readonly findNext: (query: string) => Promise<boolean>;
  readonly findPrevious: (query: string) => Promise<boolean>;
};

/** The note that stands for the beginning of a long output. */
export const HEAD_OMITTED_NOTE = "Earlier output is not shown.";
