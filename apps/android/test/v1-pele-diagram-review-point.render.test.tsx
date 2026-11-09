import { act, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactTestInstance } from "react-test-renderer";

import { PeleDiagramFullscreenSurface } from "../src/rendering/PeleDiagramSurface.native";
import { tapZoomViewport } from "./mocks/ZoomToolkit";

jest.mock("../src/rendering/peleDiagramWorker.native", () => {
  const { renderPeleDiagramSvg } = jest.requireActual<
    typeof import("../src/rendering/peleDiagramRenderer")
  >("../src/rendering/peleDiagramRenderer");
  return {
    peleDiagramKey: (source: string) => `pele:${source}`,
    renderPeleDiagram: async (source: string) => renderPeleDiagramSvg(source, 100_000),
  };
});

const VIEWPORT = { height: 800, width: 400 };

/** The element that measures the fullscreen viewport. */
function viewportOf(root: ReactTestInstance): ReactTestInstance {
  const measured = root.findAll(
    (node) => typeof node.type === "string" && typeof node.props.onLayout === "function",
  );
  const viewport = measured[0];
  if (viewport === undefined) {
    throw new Error("the viewport is not measured");
  }
  return viewport;
}

it("places a review point where the viewport tap lands on the fitted diagram", async () => {
  const onReviewPoint = jest.fn<undefined, [number, number]>();
  render(
    <PeleDiagramFullscreenSurface
      annotationEnabled
      enabled
      onReviewPoint={onReviewPoint}
      reviewPoints={[]}
      source={"erDiagram\n CUSTOMER ||--o{ ORDER : places"}
      zoomCommand={{ id: 0, kind: "reset" }}
    />,
  );
  const viewport = await waitFor(() => viewportOf(screen.root));
  act(() => {
    viewport.props.onLayout({ nativeEvent: { layout: { ...VIEWPORT, x: 0, y: 0 } } });
  });
  expect(screen.getByTestId("zoom-resumable")).toBeTruthy();

  // Anywhere in the viewport takes the gesture; its centre is the diagram's centre.
  act(() => {
    tapZoomViewport(VIEWPORT.width / 2, VIEWPORT.height / 2);
  });
  expect(onReviewPoint).toHaveBeenCalledTimes(1);
  const [x, y] = onReviewPoint.mock.calls[0] ?? [];
  expect(x).toBeCloseTo(0.5);
  expect(y).toBeCloseTo(0.5);

  // A tap on the empty viewport beside the fitted diagram places nothing.
  act(() => {
    tapZoomViewport(VIEWPORT.width / 2, 1);
  });
  expect(onReviewPoint).toHaveBeenCalledTimes(1);
});
