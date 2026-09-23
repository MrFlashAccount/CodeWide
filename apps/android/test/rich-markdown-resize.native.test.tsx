import { fireEvent, render } from "@testing-library/react-native";
import { View, StyleSheet, Text } from "react-native";
import { MarkdownDocumentView } from "../src/rendering/MarkdownDocumentView";
import { spacing } from "../src/theme";
import { NativeMarkup } from "../src/rendering/NativeMarkup";
import { RichMarkdown } from "../src/rendering/RichMarkdown";
import { RichContentWidthProvider } from "../src/rendering/RichContentLayout";

let consoleErrors: jest.SpyInstance;
beforeEach(() => {
  consoleErrors = jest.spyOn(console, "error");
});
afterEach(() => {
  try {
    expect(consoleErrors).not.toHaveBeenCalled();
  } finally {
    consoleErrors.mockRestore();
  }
});

const source = "| Name | Value |\n| --- | --- |\n| Alpha | One |";
const widths = [360, 720, 4, 360, 560, 280, 360];

it.each([false, true])(
  "resizes a mounted Markdown table without pinning its viewport (streaming=%s)",
  (streaming) => {
    const view = render(<RichMarkdown source={source} streaming={streaming} />);
    const viewport = view
      .UNSAFE_getAllByType(View)
      .find(
        (node) =>
          node.props.onLayout && StyleSheet.flatten(node.props.style)?.alignSelf === "stretch",
      );
    if (viewport === undefined) throw new Error("Table viewport missing");
    const cell = view.getByText("Alpha");
    for (const width of widths) {
      fireEvent(viewport, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width, height: 100 } },
      });
      // Parent layout must remain authoritative, even after a transient 4 dp allocation.
      expect(StyleSheet.flatten(viewport.props.style).width).toBe("100%");
      expect(view.getByText("Alpha")).toBe(cell);
      const cells = view
        .UNSAFE_getAllByType(Text)
        .filter((node) => StyleSheet.flatten(node.props.style)?.minWidth === 144);
      expect(cells).toHaveLength(4);
      for (const node of cells)
        expect(StyleSheet.flatten(node.props.style).width).toBe(Math.max(144, width / 2));
    }
  },
);

it.each([source, `> ${source.replaceAll("\n", "\n> ")}`, `- ${source.replaceAll("\n", "\n  ")}`])(
  "follows supplied pane widths for a document or inset table without remounting: %s",
  (markdown) => {
    const view = render(
      <RichContentWidthProvider width={360}>
        <RichMarkdown source={markdown} />
      </RichContentWidthProvider>,
    );
    const cell = view.getByText("Alpha");
    for (const width of [720, 360, 540, 280, 360]) {
      view.rerender(
        <RichContentWidthProvider width={width}>
          <RichMarkdown source={markdown} />
        </RichContentWidthProvider>,
      );
      const viewport = view
        .UNSAFE_getAllByType(View)
        .find(
          (node) =>
            node.props.onLayout && StyleSheet.flatten(node.props.style)?.alignSelf === "stretch",
        );
      if (viewport === undefined) throw new Error("Table viewport missing");
      const inset = markdown.startsWith(">") ? 10 : markdown.startsWith("-") ? 25 : 0;
      expect(StyleSheet.flatten(viewport.props.style).width).toBe(width - inset);
      expect(view.getByText("Alpha")).toBe(cell);
    }
  },
);

it("preserves table cells across a streaming append and resize with repeated row content", () => {
  const initial = `${source}\n| Repeat | Same |`;
  const view = render(
    <RichContentWidthProvider width={360}>
      <RichMarkdown source={initial} streaming />
    </RichContentWidthProvider>,
  );
  const first = view.getByText("Alpha");
  view.rerender(
    <RichContentWidthProvider width={720}>
      <RichMarkdown source={`${initial}\n| Repeat | Same |`} streaming />
    </RichContentWidthProvider>,
  );
  expect(view.getByText("Alpha")).toBe(first);
  expect(view.getAllByText("Repeat")).toHaveLength(2);
  view.rerender(
    <RichContentWidthProvider width={360}>
      <RichMarkdown source={`${initial}\n| Repeat | Same |`} />
    </RichContentWidthProvider>,
  );
  expect(view.getAllByText("Repeat")).toHaveLength(2);
  expect(view.getAllByText("Same")).toHaveLength(2);
});

const code = (source: string) => <Text>{source}</Text>;
const image = (source: string) => <Text>{source}</Text>;
const link = (href: string, children: React.ReactNode) => <Text>{children}</Text>;

it.each([false, true])(
  "resizes mounted HTML table columns and reflows measured rows (provider=%s)",
  (provided) => {
    const html =
      "<table><tr><th>Head</th><th>Other</th></tr><tr><td>Left</td><td>Right</td></tr></table>";
    const content = <NativeMarkup html={html} code={code} image={image} link={link} />;
    const renderContent = (width: number) =>
      provided ? (
        <RichContentWidthProvider width={width}>{content}</RichContentWidthProvider>
      ) : (
        content
      );
    const result = render(renderContent(360));
    const cell = result.getByTestId("markup-table-cell-1-0");
    for (const width of [360, 720, 4, 360, 540, 280, 360]) {
      result.rerender(renderContent(width));
      const viewport = result.getByTestId("markup-table-viewport");
      fireEvent(viewport, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width, height: 100 } },
      });
      expect(viewport).toHaveStyle({ width: provided ? width : "100%" });
      expect(result.getByTestId("markup-table-cell-1-0")).toBe(cell);
      expect(StyleSheet.flatten(cell.parent?.parent?.props.style)).toMatchObject({
        width: Math.max(120, width / 2),
      });
      const height = width < 400 ? 96 : 48;
      fireEvent(cell, "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: Math.max(120, width / 2), height } },
      });
      expect(StyleSheet.flatten(cell.parent?.parent?.props.style)).toMatchObject({ height });
    }
  },
);

it("propagates document viewport and reader width limits into an already mounted table", () => {
  const content = (maxWidth?: number) => (
    <MarkdownDocumentView
      footer={null}
      maxWidth={maxWidth}
      onScroll={() => undefined}
      segments={[source]}
      target={null}
      textScale={1}
    />
  );
  const view = render(content());
  const root = view.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
  if (root === undefined) throw new Error("Document viewport missing");
  for (const [width, maxWidth] of [
    [360, undefined],
    [720, undefined],
    [720, 500],
    [280, 500],
    [360, undefined],
  ] as const) {
    view.rerender(content(maxWidth));
    fireEvent(root, "layout", { nativeEvent: { layout: { x: 0, y: 0, width, height: 800 } } });
    const table = view
      .UNSAFE_getAllByType(View)
      .find(
        (node) =>
          node.props.onLayout && StyleSheet.flatten(node.props.style)?.alignSelf === "stretch",
      );
    if (table === undefined) throw new Error("Table viewport missing");
    expect(StyleSheet.flatten(table.props.style).width).toBe(
      Math.min(width, maxWidth ?? width) - spacing.md * 2,
    );
    expect(view.getAllByText("Alpha")).toHaveLength(1);
  }
});
