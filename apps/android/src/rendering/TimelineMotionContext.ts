import { createContext } from "react";

/** Only the visible, idle live tail may animate layout; history keeps its scroll anchor. */
export const TimelineMotionContext = createContext(false);
