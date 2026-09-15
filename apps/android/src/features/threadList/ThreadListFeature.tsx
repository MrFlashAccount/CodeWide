import { Suspense } from "react";
import { RecoverableRenderBoundary } from "../../ui/RecoverableRenderBoundary";
import { ThreadListSuspenseFallback } from "./ThreadListBoundary";
import { ThreadSidebar } from "./ThreadSidebar";
import { MobileThreads } from "./MobileThreads";
import type { ThreadSidebarProps } from "./ThreadSidebarContract";
import type { MobileThreadsProps } from "./MobileThreadsContract";

type ThreadListView =
  | { mode: "desktop"; props: ThreadSidebarProps }
  | { mode: "mobile"; props: MobileThreadsProps };

/** The scoped list owns its recoverable and loading boundaries on both layouts. */
export function ThreadListFeature({
  view,
  scopeKey,
  onDismiss,
}: {
  view: ThreadListView;
  scopeKey: string;
  onDismiss?: () => void;
}) {
  return (
    <RecoverableRenderBoundary
      scope="surface"
      label="Chat list"
      resetKey={`${view.mode}-chat-list:${scopeKey}`}
      {...(onDismiss === undefined ? {} : { onDismiss })}
    >
      <Suspense fallback={<ThreadListSuspenseFallback />}>
        {view.mode === "desktop" ? (
          <ThreadSidebar {...view.props} />
        ) : (
          <MobileThreads {...view.props} />
        )}
      </Suspense>
    </RecoverableRenderBoundary>
  );
}
