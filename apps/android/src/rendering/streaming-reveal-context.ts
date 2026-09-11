import { createContext, useContext } from "react";

/** Stable message identity shared by text paint and atomic rich-content reveals. */
export const StreamingRevealContext = createContext<string | null>(null);

/** Null keeps historical and standalone markup static. */
export function useStreamingRevealKey(): string | null {
  return useContext(StreamingRevealContext);
}
