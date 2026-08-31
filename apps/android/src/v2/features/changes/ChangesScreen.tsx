import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { ResourceListView } from "../../../presentation/resources/ResourceListView";
import { V2QueryBoundary } from "../shared/V2QueryBoundary";

interface ChangesScreenProps {
  owner: QualifiedThread;
}

export function ChangesScreen({ owner }: ChangesScreenProps): React.JSX.Element {
  return (
    <V2QueryBoundary
      query={{ kind: "thread.resources", scope: "session", threadId: owner.threadId }}
      savedServerId={owner.savedServerId}
      title="Changes"
    >
      {(result, refresh) => {
        if (result.kind !== "thread.resources") return null;
        return (
          <>
            <ActionPressable
              action={{ id: "refresh-changes", label: "Refresh changes", run: refresh }}
            />
            <ResourceListView
              empty="No file changes in this thread"
              rows={result.changes.map((change) => ({
                detail: `${change.change} · +${change.additions} −${change.deletions}`,
                id: change.path,
                label: change.path,
              }))}
            />
          </>
        );
      }}
    </V2QueryBoundary>
  );
}
