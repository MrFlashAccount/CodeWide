import type { V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";

import type { QueryResourceHandle } from "../../application/resources/queryResource";
import { ObservableResource } from "../../application/resources/resource";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { SavedServerId } from "../../domain/ids";
import {
  WorkspaceModePickerView,
  type WorkspaceMode,
} from "../../presentation/navigation/WorkspaceModePickerView";
import { ProductText } from "../../presentation/text/ProductText";
import { ShimmerText } from "../../presentation/text/ShimmerText";
import { useEvent } from "../../../react/useEvent";

const EMPTY_QUERY_RESOURCE = new ObservableResource<V2QueryResult | null>(null);

type WorkspaceInspectResult = Extract<V2QueryResult, { kind: "workspace.inspect" }>;
type WorkspaceSupport = NonNullable<WorkspaceInspectResult["support"]>;

export type WorkspaceModeSelection =
  | { kind: "current" }
  | { kind: "isolated"; support: WorkspaceSupport };

interface NewThreadWorkspaceModeProps {
  disabled: boolean;
  onSelect(selection: WorkspaceModeSelection): void;
  savedServerId: SavedServerId;
  selection: WorkspaceModeSelection;
  workspace: string | null;
}

interface WorkspaceModeQueryProps extends Omit<NewThreadWorkspaceModeProps, "workspace"> {
  workspace: string;
}

export function NewThreadWorkspaceMode(
  props: NewThreadWorkspaceModeProps,
): React.JSX.Element | null {
  const { workspace } = props;
  if (workspace === null) return null;
  return <WorkspaceModeQuery key={workspace} {...props} workspace={workspace} />;
}

function WorkspaceModeQuery(props: WorkspaceModeQueryProps): React.JSX.Element | null {
  const { disabled, onSelect, savedServerId, selection, workspace } = props;
  const runtime = useV2Runtime();
  const [outer] = useState(() =>
    runtime.query(savedServerId, { kind: "workspace.inspect", path: workspace }),
  );
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  const resource: QueryResourceHandle | null = opened.value;
  const snapshot = useSyncExternalStore(
    resource?.subscribe ?? subscribeToNothing,
    resource?.snapshot ?? EMPTY_QUERY_RESOURCE.snapshot,
    resource?.snapshot ?? EMPTY_QUERY_RESOURCE.snapshot,
  );
  const support = workspaceSupport(snapshot.value);
  const select = useEvent((mode: WorkspaceMode) => {
    if (mode === "current") {
      onSelect({ kind: "current" });
      return;
    }
    if (support !== null) onSelect({ kind: "isolated", support });
  });
  if (opened.status === "error") {
    return (
      <ProductText accessibilityLiveRegion="polite" tone="danger">
        {opened.message}
      </ProductText>
    );
  }
  if (resource === null || snapshot.status === "loading") {
    return <ShimmerText text="Checking workspace modes…" widthPolicy="intrinsic" />;
  }
  if (snapshot.status === "error") {
    return (
      <ProductText accessibilityLiveRegion="polite" tone="danger">
        {snapshot.message}
      </ProductText>
    );
  }
  if (support === null || !support.canCreate) return null;
  return (
    <WorkspaceModePickerView
      disabled={disabled}
      mode={selection.kind}
      onSelect={select}
      provider={support.provider}
    />
  );
}

function workspaceSupport(value: V2QueryResult | null): WorkspaceSupport | null {
  return value?.kind === "workspace.inspect" ? value.support : null;
}

function subscribeToNothing(): () => void {
  return unsubscribeNothing;
}

function unsubscribeNothing(): void {}
