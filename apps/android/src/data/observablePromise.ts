import { observable, type Observable } from "@legendapp/state";

/** Adapts Legend's runtime Promise unwrapping to the resolved observable contract used by Suspense. */
export function observablePromise<Value>(promise: Promise<Value>): Observable<Value> {
  const pending: unknown = observable(promise);
  // WHY: Legend resolves Promise observables before publishing their value, but its overload exposes the unresolved Promise type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return pending as Observable<Value>;
}
