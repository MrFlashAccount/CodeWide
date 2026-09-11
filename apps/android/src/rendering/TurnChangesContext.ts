import { createContext } from "react";
import type { TurnChangedFile } from "./turn-changes";

export interface TurnChangesTarget {
  readonly connectionId: string;
  readonly threadId: string;
  readonly turnId: string;
}

/** Opens the recorded patches for one exact turn in the shared Changes workspace. */
export type PresentTurnChanges = (target: TurnChangesTarget, files: readonly TurnChangedFile[]) => void;
export const TurnChangesContext = createContext<PresentTurnChanges | null>(null);
