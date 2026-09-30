/** Product-safe presentation for a raw remote operation failure. */
export type UserFacingRemoteError = {
  kind: "conversationOpenElsewhere" | "generic";
  message: string;
};

const CONVERSATION_OPEN_ELSEWHERE_MESSAGE =
  "This conversation is open in another app. Close it there, then try again here.";

/** Keeps App Server diagnostics out of product copy for errors we can explain. */
export function userFacingRemoteError(message: string): UserFacingRemoteError {
  const normalized = message.trim().toLowerCase();
  const conversationOpenElsewhere =
    normalized.includes("conversation is open in another app") ||
    normalized.includes("conversation is already open in another app") ||
    normalized.includes("thread is open elsewhere") ||
    normalized.includes("thread is already open elsewhere");

  return conversationOpenElsewhere
    ? { kind: "conversationOpenElsewhere", message: CONVERSATION_OPEN_ELSEWHERE_MESSAGE }
    : { kind: "generic", message };
}
