import { createContext } from "react";
import type { V1ThreadRouteParams } from "../../services/threads/threadRouteParams";

/** Injects one qualified browser-opening intent; pages receive no routing or workspace authority. */
export const BrowserTabsNavigationContext = createContext<
  ((thread: V1ThreadRouteParams) => void) | null
>(null);
