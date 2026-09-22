import type { NativeCommandDelivery } from "../../src/native/native-transport-contract";
import { questionCommandId } from "../../src/data/questionAnswerIdentity";

export function questionAnswerDelivery(state: NativeCommandDelivery["state"] = "queued"): NativeCommandDelivery {
  return {
    attachments: [], attempts: 0, commandId: questionCommandId("question-thread", "question"),
    connectionId: "server", createdAt: 1, lastError: null, method: "turn/steer", state,
    targetCommandId: null, text: "Answer", threadId: "question-thread", updatedAt: 2,
  };
}
