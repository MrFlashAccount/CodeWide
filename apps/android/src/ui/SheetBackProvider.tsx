import type { ReactNode } from "react";

import { SheetBackContext, type SheetBackRegistration } from "./sheetBackNavigation";

/** Scopes nested Back handlers to the sheet that owns their local navigation. */
export function SheetBackProvider({
  children,
  register,
}: {
  readonly children: ReactNode;
  readonly register: SheetBackRegistration;
}): React.JSX.Element {
  return <SheetBackContext.Provider value={register}>{children}</SheetBackContext.Provider>;
}
