import { readFileSync } from "node:fs";

export const drawingWorkspace = readFileSync(
  new URL("../../src/features/drawing/DrawingWorkspace.tsx", import.meta.url),
  "utf8",
);
export const ownerDrawingFeature = readFileSync(
  new URL("../../src/features/drawing/DrawingFeature.tsx", import.meta.url),
  "utf8",
);
