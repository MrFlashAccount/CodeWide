import type { ReactNode } from "react";

import { ThreadListFabContext, useThreadListFabModelOwner } from "./threadListFabModel";

/** Owns one catalog's floating-action visibility across its list scopes. */
export function ThreadListFabProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const model = useThreadListFabModelOwner();
  return <ThreadListFabContext.Provider value={model}>{children}</ThreadListFabContext.Provider>;
}
