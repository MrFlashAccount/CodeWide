import { readFileSync } from "node:fs";

export const projectPicker = readFileSync(
  new URL("../../src/features/projects/ProjectPickerSheet.tsx", import.meta.url),
  "utf8",
);
export const newChat = readFileSync(
  new URL("../../app/v1/V1WorkspaceRouteComposition.tsx", import.meta.url),
  "utf8",
);
export const newThreadServerSheet = readFileSync(
  new URL("../../src/features/projects/NewThreadServerSheet.tsx", import.meta.url),
  "utf8",
);
export const projectPickerContent = readFileSync(
  new URL("../../src/features/projects/ProjectPickerContent.tsx", import.meta.url),
  "utf8",
);
export const projectPickerRows = readFileSync(
  new URL("../../src/features/projects/projectPickerRows.ts", import.meta.url),
  "utf8",
);
export const projectPickerHeader = readFileSync(
  new URL("../../src/features/projects/ProjectPickerHeader.tsx", import.meta.url),
  "utf8",
);
export const projectWorkspaceAdapter = readFileSync(
  new URL("../../src/features/projects/workspaceAdapter.ts", import.meta.url),
  "utf8",
);
export const ownerNewChatSubmission = readFileSync(
  new URL("../../src/features/projects/newChatSubmission.ts", import.meta.url),
  "utf8",
);
