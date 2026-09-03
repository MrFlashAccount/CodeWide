import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ResourceStateView } from "../../presentation/feedback/ResourceStateView";
import { PagedTextViewer } from "../../presentation/output/PagedTextViewer";
import { ThreadChangeOutputResource, type ThreadChangeScope } from "./threadChangeOutputResource";

interface ThreadChangeOutputScreenProps {
  copyText(value: string): Promise<void>;
  onClose(): void;
  owner: QualifiedThread;
  path: string;
  scope: ThreadChangeScope;
}

/** Owns initial loading and recovery for one exact full-diff route. */
export function ThreadChangeOutputScreen(props: ThreadChangeOutputScreenProps): React.JSX.Element {
  const { copyText, onClose, owner, path, scope } = props;
  const runtime = useV2Runtime();
  const [resource] = useState(
    () => new ThreadChangeOutputResource({ owner, path, queries: runtime.queries, scope }),
  );
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const retry = useEvent(() => resource.refresh());
  const loadPage = useEvent((cursor: string) => resource.loadPage(cursor));
  if (snapshot.value === null) {
    return (
      <ResourceStateView
        message={snapshot.status === "error" ? snapshot.message : "Opening full diff…"}
        onRetry={retry}
        status={snapshot.status === "error" ? "error" : "loading"}
      />
    );
  }
  return (
    <PagedTextViewer
      contentName="diff"
      copyText={copyText}
      emptyLabel="No diff output."
      initialPage={snapshot.value}
      loadPage={loadPage}
      onClose={onClose}
      title="Full diff"
    />
  );
}
