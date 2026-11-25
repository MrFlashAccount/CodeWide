import { useEffect, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { useEvent } from "../../react/useEvent";

/** One edge/layout intent continues until the measured list fills or its cursor is exhausted. */
class ThreadListViewportPaging {
  readonly scope: string;
  private contentHeight: number | null = null;
  private viewportHeight = 0;
  private pending: Promise<void> | null = null;
  private active = true;
  private exhausted = false;
  private failed = false;
  private endRequested = false;
  private readonly loadPage: () => Promise<boolean>;
  private readonly publishFailure: (scope: string, message: string | null) => void;

  constructor(
    scope: string,
    loadPage: () => Promise<boolean>,
    publishFailure: (scope: string, message: string | null) => void,
  ) {
    this.scope = scope;
    this.loadPage = loadPage;
    this.publishFailure = publishFailure;
  }

  setContentHeight(height: number): void {
    this.contentHeight = height;
    this.start(false);
  }

  setViewportHeight(height: number): void {
    this.viewportHeight = height;
    this.start(false);
  }

  reachEnd(): void {
    this.exhausted = false;
    this.failed = false;
    this.publishFailure(this.scope, null);
    if (this.pending !== null) {
      this.endRequested = true;
      return;
    }
    this.start(true);
  }

  retain(): () => void {
    this.active = true;
    return () => {
      this.active = false;
    };
  }

  private needsContent(): boolean {
    return (
      this.active &&
      !this.failed &&
      this.contentHeight !== null &&
      this.viewportHeight > 0 &&
      this.contentHeight <= this.viewportHeight
    );
  }

  private start(force: boolean): void {
    if (
      !this.active ||
      this.pending !== null ||
      (!force && (this.exhausted || !this.needsContent()))
    ) {
      return;
    }
    const operation = Promise.resolve()
      .then(async () => {
        do {
          if (!this.active) {
            return;
          }
          const hasNextPage = await this.loadPage();
          if (!hasNextPage) {
            this.exhausted = true;
            this.endRequested = false;
            return;
          }
          this.failed = false;
          this.publishFailure(this.scope, null);
          // Observe committed content measurements before deciding on another page.
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        } while (this.needsContent());
      })
      .catch((error: unknown) => {
        // A transient failure is not remote exhaustion. Keep automatic layout
        // callbacks quiet until a new explicit edge intent retries the read.
        this.failed = true;
        this.publishFailure(
          this.scope,
          error instanceof Error ? error.message : "Could not load more chats",
        );
      })
      .finally(() => {
        if (this.pending === operation) {
          this.pending = null;
        }
        if (this.active && !this.exhausted && this.endRequested) {
          this.endRequested = false;
          this.start(true);
        }
      });
    this.pending = operation;
  }
}

/** Binds native measurements and end reach to one retained pagination intent. */
export function useThreadListViewportPaging(
  scope: string,
  loadMore: () => Promise<boolean>,
): {
  failure: string | null;
  onContentSizeChange: (width: number, height: number) => void;
  onEndReached: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
  retry: () => void;
} {
  const loadPage = useEvent(loadMore);
  const [failure, setFailure] = useState<{ message: string; scope: string } | null>(null);
  const publishFailure = useEvent((failureScope: string, message: string | null) => {
    setFailure((current) => {
      if (message !== null) {
        return { message, scope: failureScope };
      }
      return current?.scope === failureScope ? null : current;
    });
  });
  const [paging, setPaging] = useState(
    () => new ThreadListViewportPaging(scope, loadPage, publishFailure),
  );
  if (paging.scope !== scope) {
    setPaging(new ThreadListViewportPaging(scope, loadPage, publishFailure));
  }
  useEffect(() => paging.retain(), [paging]);
  const onContentSizeChange = useEvent((_width: number, height: number) => {
    paging.setContentHeight(height);
  });
  const onEndReached = useEvent(() => {
    paging.reachEnd();
  });
  const onLayout = useEvent((event: LayoutChangeEvent) => {
    paging.setViewportHeight(event.nativeEvent.layout.height);
  });
  return {
    failure: failure?.scope === scope ? failure.message : null,
    onContentSizeChange,
    onEndReached,
    onLayout,
    retry: onEndReached,
  };
}
