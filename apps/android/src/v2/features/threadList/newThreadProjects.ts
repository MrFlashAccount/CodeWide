import type { V2QueryResult } from "@codewide/sync-client/v2";

import type { ProjectPickerRow } from "../../presentation/navigation/ProjectPickerView";

interface ProjectRecord {
  name: string;
  path: string;
  pinned: boolean;
}

export function projectRows(result: V2QueryResult | null): ProjectPickerRow[] {
  if (result?.kind !== "projects.list") return [];
  return result.projects.map(projectRow);
}

export function projectRow(project: ProjectRecord): ProjectPickerRow {
  return { id: project.path, label: project.name, path: project.path, pinned: project.pinned };
}
