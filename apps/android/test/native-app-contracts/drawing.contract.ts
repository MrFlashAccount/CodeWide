import { expect, it } from "vitest";
import { ownerDrawingFeature } from "./drawing-sources";

it("preserves drawing integration contracts", () => {
  expect(ownerDrawingFeature).toContain('mode: editor?.mode ?? "image-annotation"');
});
