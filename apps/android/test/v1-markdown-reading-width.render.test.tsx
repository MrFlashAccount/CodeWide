import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet, View } from "react-native";

import { MarkdownDocumentView } from "../src/rendering/MarkdownDocumentView";

// One segments array, as a loaded preview keeps it: its blocks stay the same objects across renders.
const SEGMENTS = ["# Title\n\nFirst paragraph.\n\nSecond paragraph.\n"];

function documentView(maxWidth?: number) {
  return (
    <MarkdownDocumentView
      footer={null}
      onScroll={() => undefined}
      segments={SEGMENTS}
      target={null}
      textScale={1}
      {...(maxWidth === undefined ? {} : { maxWidth })}
    />
  );
}

/** The centered block frames of the mounted document. */
function blockWidths(view: ReturnType<typeof render>): unknown[] {
  return view
    .UNSAFE_getAllByType(View)
    .filter((node) => StyleSheet.flatten(node.props.style)?.alignSelf === "center")
    .map((node) => StyleSheet.flatten(node.props.style).maxWidth);
}

it("narrows every mounted block to the reading width and widens it back", () => {
  const view = render(documentView());
  const root = view.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  if (root === undefined) {
    throw new Error("Document viewport missing");
  }
  fireEvent(root, "layout", { nativeEvent: { layout: { height: 800, width: 900, x: 0, y: 0 } } });
  expect(blockWidths(view).length).toBeGreaterThan(1);
  expect(new Set(blockWidths(view))).toEqual(new Set([undefined]));

  view.rerender(documentView(560));
  expect(new Set(blockWidths(view))).toEqual(new Set([560]));

  view.rerender(documentView());
  expect(new Set(blockWidths(view))).toEqual(new Set([undefined]));
});
