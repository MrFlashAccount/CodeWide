/** Bounded diagnostic labels. Never derive a surface label from user content or a path. */
export type SheetPerformanceSurface =
  | "sheet"
  | "projects"
  | "folders"
  | "ports"
  | "skills"
  | "settings";
