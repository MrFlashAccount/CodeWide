import { createContext, type ReactNode, useContext } from "react";

const RichContentWidthContext = createContext<number | null>(null);

/**
 * Supplies the concrete width owned by the surrounding pane. React Native
 * cannot resolve a percentage-width block through an intrinsic-width chat
 * bubble, so wide renderers must consume the pane measurement directly.
 */
export function RichContentWidthProvider({
  width,
  children,
}: {
  width: number | null;
  children: ReactNode;
}) {
  return <RichContentWidthContext.Provider value={width}>{children}</RichContentWidthContext.Provider>;
}

export function useRichContentWidth(): number | null {
  return useContext(RichContentWidthContext);
}
