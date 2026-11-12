import { observable } from "@legendapp/state";
import type { ReactNode } from "react";
import { useSharedValue } from "react-native-reanimated";

import { useConstant } from "../../react/useConstant";
import {
  CatalogSearchPullContext,
  type CatalogSearchPullModel,
  type CatalogSearchPullPhase,
} from "./catalogSearchPullModel";

/** Shares one catalog's native pull progress with its fixed search trigger. */
export function CatalogSearchPullProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const distance = useSharedValue(0);
  const model = useConstant<CatalogSearchPullModel>(() => ({
    distance,
    phase$: observable<CatalogSearchPullPhase>("idle"),
  }));
  return (
    <CatalogSearchPullContext.Provider value={model}>{children}</CatalogSearchPullContext.Provider>
  );
}
