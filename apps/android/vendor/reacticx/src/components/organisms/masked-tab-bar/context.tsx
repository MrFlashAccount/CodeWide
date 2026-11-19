import { createContext, useContext, type RefObject } from "react";
import type { View } from "react-native";

import type { IMaskedTabBarContext, TMaskedTabBarLayer } from "./types";

const MaskedTabBarContext = createContext<IMaskedTabBarContext | null>(null);

function useMaskedTabBar(part: string): IMaskedTabBarContext {
  const ctx = useContext(MaskedTabBarContext);
  if (!ctx) {
    throw new Error(`<${part}> must be rendered inside <MaskedTabBar>`);
  }
  return ctx;
}

const MaskedTabLayerContext = createContext<TMaskedTabBarLayer>("base");

function useMaskedTabLayer(): TMaskedTabBarLayer {
  return useContext(MaskedTabLayerContext);
}

/** The base row the triggers lay out in, which a re-measure measures them against. */
const MaskedTabRowContext = createContext<RefObject<View | null> | null>(null);

export {
  MaskedTabBarContext,
  MaskedTabRowContext,
  MaskedTabLayerContext,
  useMaskedTabBar,
  useMaskedTabLayer,
};
