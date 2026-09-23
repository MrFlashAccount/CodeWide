import { observable } from "@legendapp/state";
import type { ReactNode } from "react";
import { useSharedValue } from "react-native-reanimated";

import { useConstant } from "../../react/useConstant";
import {
  ThreadListSearchPullContext,
  type ThreadListSearchPullPhase,
} from "./threadListSearchPull";

/** Shares gesture progress between the catalog viewport and its fixed search row. */
export function ThreadListSearchPullProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const distance = useSharedValue(0);
  const model = useConstant(() => ({
    distance,
    phase$: observable<ThreadListSearchPullPhase>("idle"),
  }));
  return (
    <ThreadListSearchPullContext.Provider value={model}>
      {children}
    </ThreadListSearchPullContext.Provider>
  );
}
