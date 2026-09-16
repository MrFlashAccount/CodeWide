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
  onDismiss,
  scopeKey,
  view,
}: {
  onDismiss?: () => void;
  scopeKey: string;
  view: ThreadListView;
}) {
  return (
    <RecoverableRenderBoundary
      label="Chat list"
      resetKey={`${view.mode}-chat-list:${scopeKey}`}
      scope="surface"
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
