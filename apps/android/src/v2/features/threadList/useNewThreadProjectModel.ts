import type { V2QueryResult } from "@codewide/sync-client/v2";
import { useState, useSyncExternalStore } from "react";

import { useEvent } from "../../../react/useEvent";
import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import type { QueryResourceHandle } from "../../application/resources/queryResource";
import { ObservableResource } from "../../application/resources/resource";
import type { PersistedNewThreadDraft } from "../../application/ports/composerDraftStore";
import type { SavedServerId } from "../../domain/ids";
import type { ProjectPickerRow } from "../../presentation/navigation/ProjectPickerView";
import type { WorkspaceModeSelection } from "./NewThreadWorkspaceMode";
import { projectRow, projectRows } from "./newThreadProjects";

const EMPTY_RESOURCE = new ObservableResource<V2QueryResult | null>(null);

interface UseNewThreadProjectModelInput {
  initial: PersistedNewThreadDraft | null;
  openingError: string | null;
  resource: QueryResourceHandle | null;
  savedServerId: SavedServerId;
}

export interface NewThreadProjectModel {
  add(path: string): Promise<ProjectPickerRow>;
  closePicker(visible: boolean): void;
  loading: boolean;
  openPicker(): void;
  pickerVisible: boolean;
  pin(project: ProjectPickerRow): Promise<void>;
  projects: readonly ProjectPickerRow[];
  select(path: string | null): void;
  selectMode(selection: WorkspaceModeSelection): void;
  status: string | null;
  workspace: string | null;
  workspaceMode: WorkspaceModeSelection;
}

/** Owns project selection and project.add mutations for a New Thread draft. */
export function useNewThreadProjectModel(
  input: UseNewThreadProjectModelInput,
): NewThreadProjectModel {
  const runtime = useV2Runtime();
  const resource = input.resource ?? EMPTY_RESOURCE;
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const projects = projectRows(snapshot.value);
  const [selectedWorkspace, setSelectedWorkspace] = useState<string | null | undefined>(
    () => input.initial?.workspace,
  );
  const defaultProject = projects.find((project) => project.pinned) ?? projects[0];
  const workspace =
    selectedWorkspace === undefined ? (defaultProject?.path ?? null) : selectedWorkspace;
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceModeSelection>(
    () => input.initial?.workspaceMode ?? { kind: "current" },
  );
  const [pickerVisible, setPickerVisible] = useState(false);
  const select = useEvent((path: string | null): void => {
    setSelectedWorkspace(path);
    setWorkspaceMode({ kind: "current" });
  });
  const add = useEvent(async (path: string): Promise<ProjectPickerRow> => {
    if (input.resource?.actionable() !== true) {
      throw new Error("Wait for the current project list before changing projects");
    }
    const frame = await runtime.commandActivations.execute(input.savedServerId, {
      kind: "project.add",
      name: null,
      path,
      pinned: true,
    });
    if (frame.type !== "commandCompleted") throw new Error(frame.error.message);
    if (frame.result.kind !== "project.add")
      throw new Error("The server returned invalid project data.");
    await input.resource?.refresh();
    return projectRow(frame.result.project);
  });
  const pin = useEvent(async (project: ProjectPickerRow): Promise<void> => {
    if (input.resource?.actionable() !== true) {
      throw new Error("Wait for the current project list before changing projects");
    }
    const frame = await runtime.commandActivations.execute(input.savedServerId, {
      kind: "project.add",
      name: project.label,
      path: project.path,
      pinned: true,
    });
    if (frame.type !== "commandCompleted") throw new Error(frame.error.message);
    if (frame.result.kind !== "project.add")
      throw new Error("The server returned invalid project data.");
    await input.resource?.refresh();
  });
  const openPicker = useEvent(() => setPickerVisible(true));
  const closePicker = useEvent((visible: boolean) => setPickerVisible(visible));
  const selectMode = useEvent((selection: WorkspaceModeSelection) => setWorkspaceMode(selection));
  const status = input.openingError ?? (snapshot.status === "error" ? snapshot.message : null);
  return {
    add,
    closePicker,
    loading:
      status === null &&
      (input.resource === null || snapshot.status === "loading" || !input.resource.actionable()),
    openPicker,
    pickerVisible,
    pin,
    projects,
    select,
    selectMode,
    status,
    workspace,
    workspaceMode,
  };
}
