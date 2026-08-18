import { createContext, useContext, type ReactNode } from "react";

export type OverlaySurface = "root" | "native-sheet" | "fullscreen-modal";

export type OverlaySurfaceContextValue = {
  surface: OverlaySurface;
  portalHostName?: string;
};

const ROOT_OVERLAY_SURFACE: OverlaySurfaceContextValue = { surface: "root" };
const OverlaySurfaceContext = createContext<OverlaySurfaceContextValue>(ROOT_OVERLAY_SURFACE);

export function OverlaySurfaceProvider({
  children,
  portalHostName,
  surface,
}: {
  children: ReactNode;
  portalHostName?: string;
  surface: OverlaySurface;
}) {
  return (
    <OverlaySurfaceContext.Provider value={{
      surface,
      ...(portalHostName === undefined ? {} : { portalHostName }),
    }}>
      {children}
    </OverlaySurfaceContext.Provider>
  );
}

export function useOverlaySurface(): OverlaySurfaceContextValue {
  return useContext(OverlaySurfaceContext);
}
