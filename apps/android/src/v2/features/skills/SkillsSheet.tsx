import type { V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QueryResourceHandle } from "../../application/resources/queryResource";
import type { ResourceSnapshot } from "../../application/resources/resource";
import type { SkillCatalogEntry } from "../../application/skills/skillSelection";
import type { SavedServerId } from "../../domain/ids";
import { SkillsSheetView } from "../../presentation/skills/SkillsSheetView";

interface SkillsSheetProps {
  onClose(): void;
  onSelect(skill: SkillCatalogEntry): void;
  savedServerId: SavedServerId;
  workspace: string;
}

/** Owns the live, workspace-scoped skill catalog without copying it into React state. */
export function SkillsSheet(props: SkillsSheetProps): React.JSX.Element {
  const { onClose, onSelect, savedServerId, workspace } = props;
  const runtime = useV2Runtime();
  const [outer] = useState(() =>
    runtime.query(savedServerId, { forceReload: false, kind: "skills.list", workspace }),
  );
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  if (opened.value === null) {
    return (
      <SkillsSheetView
        actionable={false}
        error={opened.status === "error" ? opened.message : null}
        loading={opened.status === "loading"}
        onClose={onClose}
        onSelect={onSelect}
        skills={[]}
        workspaceLabel={workspace}
      />
    );
  }
  return (
    <LoadedSkillsSheet
      onClose={onClose}
      onSelect={onSelect}
      resource={opened.value}
      workspace={workspace}
    />
  );
}

interface LoadedSkillsSheetProps {
  onClose(): void;
  onSelect(skill: SkillCatalogEntry): void;
  resource: QueryResourceHandle;
  workspace: string;
}

function LoadedSkillsSheet(props: LoadedSkillsSheetProps): React.JSX.Element {
  const { onClose, onSelect, resource, workspace } = props;
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const select = useEvent((skill: SkillCatalogEntry) => {
    if (!resource.actionable()) return;
    onSelect(skill);
    onClose();
  });
  return (
    <SkillsSheetView
      actionable={resource.actionable()}
      error={snapshot.status === "error" ? snapshot.message : null}
      loading={snapshot.status === "loading"}
      onClose={onClose}
      onSelect={select}
      skills={skillsFromSnapshot(snapshot, workspace)}
      workspaceLabel={workspace}
    />
  );
}

function skillsFromSnapshot(
  snapshot: ResourceSnapshot<V2QueryResult | null>,
  expectedWorkspace: string,
): SkillCatalogEntry[] {
  const value = snapshot.value;
  if (value === null || value.kind !== "skills.list" || value.workspace !== expectedWorkspace) {
    return [];
  }
  return value.skills;
}
