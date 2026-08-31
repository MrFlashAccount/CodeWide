import { createContext, useContext, type PropsWithChildren } from "react";

import type { V2Runtime } from "../v2Runtime";

const RuntimeContext = createContext<V2Runtime | null>(null);

export function V2RuntimeProvider({
  children,
  runtime,
}: PropsWithChildren<{ runtime: V2Runtime }>): React.JSX.Element {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}

export function useV2Runtime(): V2Runtime {
  const runtime = useContext(RuntimeContext);
  if (runtime === null) {
    throw new Error("V2Application is not mounted");
  }
  return runtime;
}
