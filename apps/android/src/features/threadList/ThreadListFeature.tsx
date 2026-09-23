import { Suspense, type ComponentProps } from "react";
import { MobileThreadsHeader } from "./MobileThreadsHeader";
import { RecoverableRenderBoundary } from "../../ui/RecoverableRenderBoundary";
import { ThreadListSuspenseFallback } from "./ThreadListBoundary";
import { ThreadSidebar } from "./ThreadSidebar";
import { MobileThreads } from "./MobileThreads";
import type { ThreadSidebarProps } from "./ThreadSidebarContract";
import type { MobileThreadsProps } from "./MobileThreadsContract";

export { ThreadListSearchPullProvider } from "./ThreadListSearchPull";

type ThreadListView =
  | { mode: "desktop"; props: ThreadSidebarProps }
  | { mode: "mobile"; props: MobileThreadsProps };

/** Keeps the mobile catalog controls outside the animated list destinations. */
export function ThreadListHeader(
  props: ComponentProps<typeof MobileThreadsHeader>,
): React.JSX.Element | null {
  return <MobileThreadsHeader {...props} />;
}

/** The scoped list owns its recoverable and loading boundaries on both layouts. */
export function ThreadListFeature({
  onDismiss,
  scopeKey,
  view,
}: {
  onDismiss?: () => void;
  scopeKey: string;
  view: ThreadListView;
}): React.JSX.Element {
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
