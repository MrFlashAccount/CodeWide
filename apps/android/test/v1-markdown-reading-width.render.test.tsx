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

/** The width limit of the column the document's rows are laid into. */
function columnMaxWidth(view: ReturnType<typeof render>): unknown {
  const list = view.UNSAFE_getAllByType(View).find((node) => node.props.contentContainerStyle);
  if (list === undefined) {
    throw new Error("Document list missing");
  }
  return StyleSheet.flatten(list.props.contentContainerStyle).maxWidth;
}

it("narrows the document column to the reading width and widens it back", () => {
  const view = render(documentView());
  const root = view.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  if (root === undefined) {
    throw new Error("Document viewport missing");
  }
  fireEvent(root, "layout", { nativeEvent: { layout: { height: 800, width: 900, x: 0, y: 0 } } });
  expect(columnMaxWidth(view)).toBeUndefined();

  view.rerender(documentView(560));
  expect(columnMaxWidth(view)).toBe(560);

  view.rerender(documentView());
  expect(columnMaxWidth(view)).toBeUndefined();
});
