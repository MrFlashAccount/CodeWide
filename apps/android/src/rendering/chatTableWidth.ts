import type { ObservableComputed } from "@legendapp/state";
import { createContext } from "react";

/** Last pane allocation for full-width chat tables, available across row recycling. */
export const ChatTableWidthContext = createContext<ObservableComputed<number | null> | null>(null);
