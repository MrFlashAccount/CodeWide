import type { ReactNode } from "react";
import {
  incrementDiagnosticMetric,
  operationalDiagnosticsEnabled,
} from "../../data/operational-metrics";
import {
  isThreadNavigationActiveFor,
  recordThreadNavigationRowCommit,
} from "../../data/thread-navigation-metrics";
import { EveryCommitProbe } from "../../ui/CommitProbe";

function recordThreadRowCommit(): void {
  incrementDiagnosticMetric("thread_row_commits");
}

export function ThreadRowCommitBoundary({ children }: { children: ReactNode }) {
  if (!operationalDiagnosticsEnabled()) {
    return <>{children}</>;
  }
  return (
    <>
      {children}
      <EveryCommitProbe onCommit={recordThreadRowCommit} />
    </>
  );
}

export function ThreadNavigationRowCommitBoundary({
  children,
  connectionId,
  rowKey,
  threadId,
}: {
  children: ReactNode;
  connectionId: string;
  rowKey: string;
  threadId: string;
}) {
  if (!isThreadNavigationActiveFor(connectionId, threadId)) {
    return <>{children}</>;
  }
  return (
    <>
      {children}
      <EveryCommitProbe
        onCommit={() => {
          recordThreadNavigationRowCommit(connectionId, threadId, rowKey);
        }}
      />
    </>
  );
}
