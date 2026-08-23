import { useLayoutEffect } from "react";

import { useEvent } from "../react/useEvent";

type CommitCallback = () => void | (() => void);

/**
 * Runs external commit bookkeeping after every commit of the owner.
 *
 * This is deliberately a layout effect: frame/navigation telemetry and native
 * measurement must observe a committed tree, including in release builds.
 */
export function EveryCommitProbe({ onCommit }: { onCommit: CommitCallback }) {
  const commit = useEvent(onCommit);
  useLayoutEffect(() => commit());
  return null;
}

/** Runs external commit bookkeeping only when its semantic revision changes. */
export function CommitOnChangeProbe({
  scope,
  revision,
  onCommit,
}: {
  scope: string;
  revision: string | number | null;
  onCommit: CommitCallback;
}) {
  const commit = useEvent(onCommit);
  useLayoutEffect(() => commit(), [commit, scope, revision]);
  return null;
}
