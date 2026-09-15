import { type ReactNode } from "react";
import {
  incrementDiagnosticMetric,
  operationalDiagnosticsEnabled,
} from "../../data/operational-metrics";
import {
  isThreadNavigationActiveFor,
  recordThreadNavigationRowCommit,
} from "../../data/thread-navigation-metrics";
import { EveryCommitProbe } from "../../ui/CommitProbe";

export function ThreadRowCommitBoundary({ children }: { children: ReactNode }) {
  if (!operationalDiagnosticsEnabled()) return <>{children}</>;
  const onCommit = () => {
    incrementDiagnosticMetric("thread_row_commits");
  };
  return (
    <>
      {children}
      <EveryCommitProbe onCommit={onCommit} />
    </>
  );
}

export function ThreadNavigationRowCommitBoundary({
  connectionId,
  threadId,
  rowKey,
  children,
}: {
  connectionId: string;
  threadId: string;
  rowKey: string;
  children: ReactNode;
}) {
  if (!isThreadNavigationActiveFor(connectionId, threadId)) return <>{children}</>;
  return (
    <>
      {children}
      <EveryCommitProbe
        onCommit={() => recordThreadNavigationRowCommit(connectionId, threadId, rowKey)}
      />
    </>
  );
}
