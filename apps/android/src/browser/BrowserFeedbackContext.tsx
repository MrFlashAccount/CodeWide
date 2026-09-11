import { createContext, useContext } from "react";
import type { BrowserFeedbackCapability } from "./feedback";

/** Browser presentation only receives a send capability, never a connection store. */
export const BrowserFeedbackContext = createContext<BrowserFeedbackCapability | null>(null);
export function useBrowserFeedback(): BrowserFeedbackCapability | null { return useContext(BrowserFeedbackContext); }
