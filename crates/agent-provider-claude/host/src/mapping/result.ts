/**
 * Pure mapping of a Claude `result` frame to a neutral turn outcome.
 *
 * `aborted_*` terminal reasons are interruptions. A `success` subtype with
 * `is_error`, any `error_*` subtype, or an authentication failure is a failed
 * turn with user-facing text. `[ede_diagnostic]` lines are internal and never
 * reach the user. Rate limits are never reported as an error here.
 */

import type { TurnError, TurnStatus } from "../protocol.js";
import type { ClaudeFrame } from "./frames.js";

type ResultFrame = Extract<ClaudeFrame, { kind: "result" }>;

export type TurnOutcome =
  | { readonly status: "completed" }
  | { readonly status: "interrupted" }
  | { readonly error: TurnError; readonly status: "failed" };

export const AUTHENTICATION_MESSAGE =
  "Claude is not signed in on this host. Run `claude auth login` on the host, then try again.";
export const PROCESS_EXITED_MESSAGE = "Claude process exited unexpectedly";
export const LOST_SESSION_MARKER = "No conversation found with session ID";

const BACKGROUND_SESSION_PATTERN = /That session is running in the background \(([0-9a-f]+)\)/;

/**
 * User-facing failure of a Claude process that exited during a turn. A session
 * already running as a `claude --bg` background agent cannot be resumed by a
 * second process; the CLI names its short id in stderr.
 */
export function processExitedError(cause: Error): TurnError {
  const background = BACKGROUND_SESSION_PATTERN.exec(cause.message);
  if (background === null) {
    return { kind: "processExited", message: PROCESS_EXITED_MESSAGE };
  }
  const shortId = background[1] ?? "";
  return {
    kind: "processExited",
    message:
      `This Claude session is running in the background in another Claude process. ` +
      `Wait for it to finish or run \`claude stop ${shortId}\` on the host, then try again.`,
  };
}

export function isInterruption(frame: ResultFrame): boolean {
  return frame.terminalReason !== null && frame.terminalReason.startsWith("aborted");
}

export function isLostSession(frame: ResultFrame): boolean {
  return frame.errors.some((error) => error.includes(LOST_SESSION_MARKER));
}

function looksLikeAuthentication(text: string): boolean {
  return /\b401\b|authenticat|not logged in|invalid api key/i.test(text);
}

/** `assistantError` is the `error` of the turn's last assistant frame, if any. */
export function turnOutcome(frame: ResultFrame, assistantError: string | null): TurnOutcome {
  if (isInterruption(frame)) {
    return { status: "interrupted" };
  }
  if (frame.subtype === "success" && !frame.isError && assistantError === null) {
    return { status: "completed" };
  }
  return failedOutcome(frame, assistantError);
}

/** User-facing failure text: the result and every error except internal diagnostics. */
function failureText(frame: ResultFrame): string {
  const parts = [
    frame.result ?? "",
    ...frame.errors.filter((error) => !error.includes("[ede_diagnostic]")),
  ];
  return parts.filter((part) => part.length > 0).join("\n");
}

function failedOutcome(frame: ResultFrame, assistantError: string | null): TurnOutcome {
  const text = failureText(frame);
  if (assistantError === "authentication_failed" || looksLikeAuthentication(text)) {
    return { error: { kind: "authentication", message: AUTHENTICATION_MESSAGE }, status: "failed" };
  }
  return {
    error: {
      kind: "provider",
      message: text.length > 0 ? text : `Claude turn failed (${frame.subtype})`,
    },
    status: "failed",
  };
}

export const statusOf = (outcome: TurnOutcome): TurnStatus => outcome.status;
