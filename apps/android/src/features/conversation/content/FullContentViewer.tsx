/** V1 full-content opener: routes viewer requests through the conversation navigation. */
import type { ReactNode } from "react";
import { useEvent } from "../../../react/useEvent";
import { useConversationRouteNavigation } from "../conversationRouteNavigation";
import { LargeContentViewerContext, type LargeContentViewerRequest } from "./contentViewerContext";

export async function nextRenderFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

export function LargeContentViewerHost({ children }: { children: ReactNode }) {
  const navigation = useConversationRouteNavigation();
  const open = useEvent((request: LargeContentViewerRequest) => {
    navigation.openContent(request);
  });
  return (
    <LargeContentViewerContext.Provider value={open}>{children}</LargeContentViewerContext.Provider>
  );
}
