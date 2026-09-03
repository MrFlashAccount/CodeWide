import type { V2Command } from "@codewide/sync-client/v2";

import type { QueueDeliveryMode } from "../../presentation/queue/queueTypes";

type TurnSubmitCommand = Extract<V2Command, { kind: "turn.submit" }>;

export interface DeliveryCommandInput {
  activeTurnId: string | null;
  mode: QueueDeliveryMode;
  submit: TurnSubmitCommand;
  threadRunning: boolean;
}

/** Maps one explicit composer activation to exactly one V2 protocol command. */
export function deliveryCommand(input: DeliveryCommandInput): V2Command {
  const { activeTurnId, mode, submit, threadRunning } = input;
  if (mode === "sendNow") {
    if (threadRunning) throw new Error("Send now is unavailable while this thread is running");
    return submit;
  }
  if (submit.threadId === null) {
    throw new Error("Queue and steer require an existing thread");
  }
  if (mode === "queue") {
    if (!threadRunning) throw new Error("Queue requires a running thread");
    return {
      kind: "queue.mutate",
      mutation: { input: submit.input, kind: "put", threadId: submit.threadId },
    };
  }
  if (activeTurnId === null) throw new Error("Steer requires an active turn");
  return {
    input: submit.input,
    kind: "turn.steer",
    threadId: submit.threadId,
    turnId: activeTurnId,
  };
}
