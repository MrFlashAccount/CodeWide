import { useState } from "react";

/** Creates one component-lifetime value without manual render memoization. */
export function useConstant<Value>(create: () => Value): Value {
  // WHY: The value is an explicit component-lifetime owner and is never replaced, so exposing a setter would create an invalid state transition.
  // oxlint-disable-next-line react/hook-use-state
  const [value] = useState(create);
  return value;
}
