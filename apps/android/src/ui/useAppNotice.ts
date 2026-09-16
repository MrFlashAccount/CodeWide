import { useContext } from "react";

import { AppNoticeContext, type AppNoticeController } from "./appNoticeContext";

/** Returns the application notice controller. */
export function useAppNotice(): AppNoticeController {
  const value = useContext(AppNoticeContext);
  if (value === null) {
    throw new Error("useAppNotice must be used inside AppNoticeProvider");
  }
  return value;
}
