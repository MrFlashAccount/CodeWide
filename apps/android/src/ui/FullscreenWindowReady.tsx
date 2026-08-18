import { createContext, useContext, type ReactNode } from "react";

const FullscreenWindowReadyContext = createContext(false);

export function FullscreenWindowReadyProvider({ ready, children }: { ready: boolean; children: ReactNode }) {
  return <FullscreenWindowReadyContext.Provider value={ready}>{children}</FullscreenWindowReadyContext.Provider>;
}

export function useFullscreenWindowReady(): boolean {
  return useContext(FullscreenWindowReadyContext);
}
