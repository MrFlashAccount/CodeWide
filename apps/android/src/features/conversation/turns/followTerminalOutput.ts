import {
  terminalOutputEvents,
  type TerminalCommandSnapshot,
  type TerminalOutputEvent,
} from "../../../data/terminalOutputEvents";
import { checkAborted } from "../../../native/check-aborted";
import { readCommandOutput } from "../../../rendering/command-output-resource";
import { followCommandOutput } from "../../../rendering/commandOutputFollow";
import type { TerminalOutputRequest } from "../../../services/content/terminalOutputRequest";
import type { TaskOutputTerminalProps } from "./TaskOutputTerminal.types";
import { terminalCompletionReader } from "./terminalCompletionReader";
import { TerminalOutputQueue } from "./terminalOutputQueue";

const MAX_LIVE_CHARS = 1_048_576;

/** One viewer's received tail, replaced by the canonical output on completion. */
export type TerminalOutputState = {
  readonly command: string;
  readonly output: TaskOutputTerminalProps["output"];
} & (
  | { readonly phase: "live"; readonly status: "running" }
  | { readonly phase: "complete"; readonly status: "finished" | "failed" | "declined" }
);

/** Opens with an honest partial-output marker, even before the next line arrives. */
export function initialTerminalOutput(command: string): TerminalOutputState {
  return {
    command,
    output: { headOmitted: true, text: "", totalChars: 0 },
    phase: "live",
    status: "running",
  };
}

type Follow = {
  readonly key: string;
  readonly publish: (state: TerminalOutputState) => void;
  readonly request: TerminalOutputRequest;
  readonly signal: AbortSignal;
};

/** Owns a visible viewer's subscription, ordered content reads and canonical completion repair. */
export async function followTerminalOutput(input: Follow): Promise<TerminalOutputState> {
  const { request } = input;
  const queue = new TerminalOutputQueue();
  const release = terminalOutputEvents.subscribe({
    connectionId: request.connectionId,
    emit: (event) => {
      queue.push(event);
    },
    itemId: request.itemId,
    threadId: request.threadId,
  });
  try {
    return await followEvents(input, queue);
  } finally {
    release();
  }
}

async function followEvents(
  input: Follow,
  queue: TerminalOutputQueue,
): Promise<TerminalOutputState> {
  const { request, signal } = input;
  let state = initialTerminalOutput(request.command);
  input.publish(state);
  const recover = terminalCompletionReader(request, signal);
  let event: TerminalOutputEvent | null = null;
  for (;;) {
    checkAborted(signal);
    if (event === null) {
      const completed = await recover();
      if (completed !== null) {
        return completeOutput(input, completed);
      }
    } else if (event.kind === "completed") {
      return completeOutput(input, event.snapshot);
    } else {
      const text = await readDelta(input, event);
      checkAborted(signal);
      state = {
        command: state.command,
        output: {
          headOmitted: true,
          text: (state.output.text + text).slice(-MAX_LIVE_CHARS),
          totalChars: state.output.totalChars + text.length,
        },
        phase: "live",
        status: "running",
      };
      input.publish(state);
    }
    event = await queue.next(signal);
  }
}

async function readDelta(
  { request, signal }: Follow,
  event: Extract<TerminalOutputEvent, { readonly kind: "delta" }>,
): Promise<string> {
  if (event.reference === null) {
    return event.text;
  }
  const result = await readCommandOutput(
    {
      byteLimit: event.reference.byteLength,
      getTransferAccess: request.getTransferAccess,
      references: [event.reference],
      scope: request.connectionId,
    },
    signal,
  );
  return result.text;
}

async function completeOutput(
  input: Follow,
  command: TerminalCommandSnapshot,
): Promise<TerminalOutputState> {
  const status = command.status === "completed" ? "finished" : command.status;
  const makeState = (output: TaskOutputTerminalProps["output"]): TerminalOutputState => ({
    command: command.command,
    output,
    phase: "complete",
    status,
  });
  if (command.references.length === 0) {
    return makeState({
      headOmitted: false,
      text: command.output,
      totalChars: command.output.length,
    });
  }
  const output = await followCommandOutput({
    getTransferAccess: input.request.getTransferAccess,
    key: `${input.key}:complete`,
    publish: (value) => {
      input.publish(makeState(value));
    },
    references: command.references,
    scope: input.request.connectionId,
    signal: input.signal,
  });
  checkAborted(input.signal);
  return makeState(output);
}
