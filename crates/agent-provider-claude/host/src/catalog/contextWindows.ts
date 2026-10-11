/**
 * Context windows of Claude models, used for live context fill before the
 * SDK has reported a window for the thread (it does so only in a result).
 */

import { canonicalModelId } from "./prices.js";

/** Every current Claude model has a 1M window except those listed below. */
const DEFAULT_WINDOW = 1_000_000;
const HAIKU_4_5_WINDOW = 200_000;

const WINDOWS: Readonly<Record<string, number>> = {
  "claude-haiku-4-5": HAIKU_4_5_WINDOW,
};

/** The window of a canonical model id; `null` when the id is not a Claude model. */
export function contextWindowOf(model: string | null): number | null {
  if (model === null) {
    return null;
  }
  const id = canonicalModelId(model);
  if (!id.startsWith("claude-")) {
    return null;
  }
  return Object.hasOwn(WINDOWS, id) ? (WINDOWS[id] ?? DEFAULT_WINDOW) : DEFAULT_WINDOW;
}
