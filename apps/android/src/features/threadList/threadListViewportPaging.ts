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
  private readonly loadPage: () => Promise<boolean>;

  constructor(scope: string, loadPage: () => Promise<boolean>) {
    this.scope = scope;
    this.loadPage = loadPage;
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
            return;
          }
          // Observe committed content measurements before deciding on another page.
          await new Promise<void>((resolve) => {
            requestAnimationFrame(() => {
              resolve();
            });
          });
        } while (this.needsContent());
      })
      .catch(() => {
        // A new explicit edge intent can retry; layout notifications must not spin
        // on a disconnected server or a rejected cursor.
        this.exhausted = true;
      })
      .finally(() => {
        if (this.pending === operation) {
          this.pending = null;
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
  onContentSizeChange: (width: number, height: number) => void;
  onEndReached: () => void;
  onLayout: (event: LayoutChangeEvent) => void;
} {
  const loadPage = useEvent(loadMore);
  const [paging, setPaging] = useState(() => new ThreadListViewportPaging(scope, loadPage));
  if (paging.scope !== scope) {
    setPaging(new ThreadListViewportPaging(scope, loadPage));
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
  return { onContentSizeChange, onEndReached, onLayout };
}
