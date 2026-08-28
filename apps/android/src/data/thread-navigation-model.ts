import { observable, type Observable } from "@legendapp/state";

export type ThreadNavigationSelection = {
  id: string | null;
  generation: number;
};

export type ThreadNavigationModel = {
  selection$: Observable<ThreadNavigationSelection>;
  current(): ThreadNavigationSelection;
  select(id: string | null, reloadSelected?: boolean): ThreadNavigationSelection;
};

/**
 * Requested navigation identity is global model state. List rows subscribe to
 * one boolean; the conversation host commits the matching destination through
 * React state so Suspense navigation remains transition-aware.
 */
export function createThreadNavigationModel(): ThreadNavigationModel {
  const selection$ = observable<ThreadNavigationSelection>({ id: null, generation: 0 });
  return {
    selection$,
    current: () => selection$.peek(),
    select(id, reloadSelected = false) {
      const current = selection$.peek();
      if (current.id === id && !reloadSelected) return current;
      const next = { id, generation: current.generation + 1 };
      selection$.set(next);
      return next;
    },
  };
}
