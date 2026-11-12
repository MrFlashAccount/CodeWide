import { observable, type Observable } from "@legendapp/state";
import { createContext, useContext } from "react";
import { useSharedValue, type SharedValue } from "react-native-reanimated";

import { useConstant } from "../../react/useConstant";
import {
  INITIAL_THREAD_LIST_FAB_VISIBILITY,
  type ThreadListFabVisibility,
} from "./threadListFabVisibility";

/**
 * One catalog's floating-action visibility. The UI thread owns `visibility`
 * and updates it from scroll events; `shown$` receives only the semantic
 * shown/hidden transition React needs for touch and accessibility state.
 */
export type ThreadListFabModel = {
  readonly shown$: Observable<boolean>;
  readonly visibility: SharedValue<ThreadListFabVisibility>;
};

/** Shares one model between the focused list, its New thread action and the catalog's voice action. */
export const ThreadListFabContext = createContext<ThreadListFabModel | null>(null);

/** Creates a component-lifetime model whose actions start shown. */
export function useThreadListFabModelOwner(): ThreadListFabModel {
  const visibility = useSharedValue(INITIAL_THREAD_LIST_FAB_VISIBILITY);
  return useConstant<ThreadListFabModel>(() => ({
    shown$: observable(true),
    visibility,
  }));
}

/** Returns the catalog model, or a list-local one when a list is rendered outside a catalog. */
export function useThreadListFabModel(): ThreadListFabModel {
  const local = useThreadListFabModelOwner();
  return useContext(ThreadListFabContext) ?? local;
}
