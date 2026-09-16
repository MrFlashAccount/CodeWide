import { createContext, useContext, type ReactNode } from "react";

export type OverlaySurface = "root" | "native-sheet" | "fullscreen-modal";

export type OverlaySurfaceContextValue = {
  surface: OverlaySurface;
};

const ROOT_OVERLAY_SURFACE: OverlaySurfaceContextValue = { surface: "root" };
const OverlaySurfaceContext = createContext<OverlaySurfaceContextValue>(ROOT_OVERLAY_SURFACE);

export function OverlaySurfaceProvider({
  children,
  surface,
}: {
  children: ReactNode;
  surface: OverlaySurface;
}) {
  return (
    <OverlaySurfaceContext.Provider value={{ surface }}>{children}</OverlaySurfaceContext.Provider>
  );
}

export function useOverlaySurface(): OverlaySurfaceContextValue {
  return useContext(OverlaySurfaceContext);
}
